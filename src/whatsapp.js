const path = require('path');
const fs = require('fs');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, downloadMediaMessage } = baileys;

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const authDir = path.join(dataDir, 'auth_info_baileys');
fs.mkdirSync(authDir, { recursive: true });

let sock = null;
let qr = null;
let connected = false;
let connecting = false;
let reconnectTimer = null;
let lastError = null;
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const prefix = process.env.PREFIX || '.';
const botName = process.env.BOT_NAME || 'OLLY MD';
const ownerNumber = String(process.env.OWNER_NUMBER || '').replace(/\D/g, '');

// 🧠 In-Memory Message Store Cache (Remembers recent incoming messages to retrieve view-once keys)
const messageStore = new Map();

function unwrapMessage(message) {
  let current = message;
  while (current) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else if (current.viewOnceMessage || current.viewOnceMessageV2 || current.viewOnceMessageV2Extension) return current;
    else break;
  }
  return current || {};
}
function getText(message) {
  const m = unwrapMessage(message);
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}
function getQuoted(message) {
  const m = unwrapMessage(message);
  return m?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}
function isViewOnce(message) {
  if (!message) return false;
  return Boolean(message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension || message.imageMessage?.viewOnce || message.videoMessage?.viewOnce);
}
function jidNumber(jid = '') { return jid.split('@')[0].split(':')[0].replace(/\D/g, ''); }

async function sendText(jid, text, quoted) {
  if (!sock) return;
  await sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
}

async function handleMessage(m) {
  if (!m?.message || m.key?.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid || jid === 'status@broadcast') return;
  
  // Cache the incoming message in our store
  if (m.key && m.key.id) {
    messageStore.set(m.key.id, m);
    if (messageStore.size > 500) {
      const firstKey = messageStore.keys().next().value;
      messageStore.delete(firstKey);
    }
  }

  const text = getText(m.message).trim();
  if (!text.startsWith(prefix)) return;
  const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
  const command = (rawCommand || '').toLowerCase();
  const query = args.join(' ');
  const quoted = getQuoted(m.message);
  const sender = m.key.participant || jid;
  const senderNum = jidNumber(sender);
  const isOwner = ownerNumber && senderNum === ownerNumber;

  try {
    if (command === 'ping') return sendText(jid, 'Pong! OLLY MD is online 🟢', m);
    if (command === 'alive') return sendText(jid, `🤖 *${botName} is alive!*\nPrefix: ${prefix}\nStatus: Connected 🟢`, m);
    if (command === 'menu' || command === 'help') {
      return sendText(jid,
        `╭━━━〔 *${botName}* 〕━━━╮\n` +
        `┃ ${prefix}ping – Check response\n┃ ${prefix}alive – Bot status\n┃ ${prefix}menu – Show commands\n┃ ${prefix}save – Save ordinary quoted media\n┃ ${prefix}sticker – Make sticker from image/video\n┃ ${prefix}vv2 – Anti-View Once retrieve\n╰━━━━━━━━━━━━━━━━━━╯\n` +
        `More commands will be added in later versions.`, m);
    }
    if (command === 'settings' || command === 'setting') {
      return sendText(jid, `⚙️ *${botName} SETTINGS*\nPrefix: ${prefix}\nMode: Single linked WhatsApp account\nConnection: ${connected ? 'Online 🟢' : 'Offline 🔴'}`, m);
    }
    
    // 🔓 Full Anti-View Once (.vv2 / .vv) Handler
    if (command === 'vv2' || command === 'vv') {
      const contextInfo = m.message?.extendedTextMessage?.contextInfo;
      const quotedId = contextInfo?.stanzaId;

      if (!quotedId) {
        return sendText(jid, '❌ Please reply to an unopened View-Once message with .vv2', m);
      }

      // Look up original raw message in our memory cache
      const originalMessage = messageStore.get(quotedId);
      if (!originalMessage) {
        return sendText(jid, '❌ Original message not found in bot cache. Try replying to a newer view-once message.', m);
      }

      const quotedMsgContainer = originalMessage.message;
      const viewOnceObj = quotedMsgContainer?.viewOnceMessage || quotedMsgContainer?.viewOnceMessageV2 || quotedMsgContainer?.viewOnceMessageV2Extension;
      const innerMsg = viewOnceObj?.message;

      if (!innerMsg || (!innerMsg.imageMessage && !innerMsg.videoMessage)) {
        return sendText(jid, '❌ The replied message is not a valid View-Once media container.', m);
      }

      try {
        const buffer = await downloadMediaMessage(
          originalMessage,
          'buffer',
          {},
          { logger, reuploadRequest: sock.updateMediaMessage }
        );

        const myNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const targetJid = isOwner ? myNumber : jid; // Sends to owner or chat

        if (innerMsg.videoMessage) {
          await sock.sendMessage(targetJid, {
            video: buffer,
            caption: `🔓 *Unlocked View-Once Video* via .vv2`
          });
        } else if (innerMsg.imageMessage) {
          await sock.sendMessage(targetJid, {
            image: buffer,
            caption: `🔓 *Unlocked View-Once Image* via .vv2`
          });
        }
        if (targetJid !== jid) {
          await sendText(jid, '✅ View-Once media successfully decrypted and sent to your chat!', m);
        }
      } catch (err) {
        console.error('[.vv2 Download Error]:', err);
        return sendText(jid, `❌ Download Error: ${err.message}`, m);
      }
      return;
    }

    if (command === 'save') {
      if (!quoted) return sendText(jid, `Reply to a normal image, video, audio or document with ${prefix}save.`, m);
      if (isViewOnce(quoted)) return sendText(jid, 'Please use .vv2 for View Once media.', m);
      const q = unwrapMessage(quoted);
      if (!q || !['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].some(k => q[k])) return sendText(jid, 'The quoted message is not a supported ordinary media file.', m);
      const quotedMessage = { key: { remoteJid: jid, id: m.message.extendedTextMessage?.contextInfo?.stanzaId, participant: m.message.extendedTextMessage?.contextInfo?.participant }, message: q };
      const buffer = await downloadMediaMessage(quotedMessage, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const type = q.imageMessage ? 'image' : q.videoMessage ? 'video' : q.audioMessage ? 'audio' : 'document';
      const payload = type === 'image' ? { image: buffer, caption: 'Saved with OLLY MD.' }
        : type === 'video' ? { video: buffer, caption: 'Saved with OLLY MD.' }
        : type === 'audio' ? { audio: buffer, mimetype: q.audioMessage.mimetype || 'audio/mpeg' }
        : { document: buffer, mimetype: q.documentMessage.mimetype || 'application/octet-stream', fileName: q.documentMessage.fileName || 'download' };
      return sock.sendMessage(jid, payload, { quoted: m });
    }
    if (command === 'owner') {
      return sendText(jid, ownerNumber ? `Bot owner: wa.me/${ownerNumber}` : 'Owner contact has not been configured.', m);
    }
    if (command === 'restart') {
      if (!isOwner) return sendText(jid, 'Owner-only command.', m);
      await sendText(jid, 'Restarting OLLY MD…', m);
      return restartBot();
    }
  } catch (err) {
    console.error(`[Command ${command}]`, err);
    await sendText(jid, '❌ Something went wrong while running that command. Check the server logs.', m).catch(() => {});
  }
}

async function startBot() {
  if (connecting || (sock && connected)) return;
  connecting = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, logger, printQRInTerminal: false, auth: state, browser: [botName, 'Chrome', '1.0.0'], markOnlineOnConnect: true });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', update => {
      const { connection, lastDisconnect, qr: nextQr } = update;
      if (nextQr) { qr = nextQr; console.log('[OLLY MD] QR code is ready.'); }
      if (connection === 'open') { connected = true; qr = null; lastError = null; console.log('[OLLY MD] WhatsApp connected.'); }
      if (connection === 'close') {
        connected = false;
        const status = lastDisconnect?.error?.output?.statusCode;
        lastError = lastDisconnect?.error?.message || 'Connection closed';
        if (status === DisconnectReason.loggedOut) {
          console.error('[OLLY MD] Logged out. Clear the saved session and pair again.');
          sock = null;
        } else {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => startBot().catch(console.error), 5000);
        }
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const message of messages) await handleMessage(message);
    });
  } finally { connecting = false; }
}

async function requestPairingCode(phone) {
  if (connected) throw new Error('WhatsApp is already connected.');
  if (!sock) await startBot();
  if (!sock?.requestPairingCode) throw new Error('Pairing is not ready. Wait a few seconds and try again.');
  const code = await sock.requestPairingCode(phone);
  qr = null;
  return code;
}
async function restartBot() {
  clearTimeout(reconnectTimer);
  if (sock) { try { sock.end(undefined); } catch {} }
  sock = null; connected = false; qr = null;
  await new Promise(resolve => setTimeout(resolve, 1000));
  return startBot();
}
async function logoutBot() {
  clearTimeout(reconnectTimer);
  if (sock) { try { await sock.logout(); } catch {} }
  sock = null; connected = false; qr = null;
  fs.rmSync(authDir, { recursive: true, force: true });
  fs.mkdirSync(authDir, { recursive: true });
}
function getBotState() { return { connected, qrAvailable: Boolean(qr), lastError, botName }; }
function getCurrentQr() { return qr; }
module.exports = { startBot, getBotState, getCurrentQr, requestPairingCode, restartBot, logoutBot };