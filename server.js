require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { startBot, getBotState, getCurrentQr, requestPairingCode, restartBot, logoutBot } = require('./whatsapp');

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireDashboardToken(req, res, next) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return res.status(503).json({ success: false, error: 'Set DASHBOARD_TOKEN in the environment before using the dashboard API.' });
  const supplied = req.get('x-dashboard-token') || req.body?.token;
  if (supplied !== expected) return res.status(401).json({ success: false, error: 'Invalid dashboard token.' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, name: process.env.BOT_NAME || 'OLLY MD', time: new Date().toISOString() }));
app.get('/api/status', requireDashboardToken, (_req, res) => res.json({ success: true, ...getBotState() }));
app.get('/api/qr', requireDashboardToken, async (_req, res) => {
  const state = getBotState();
  const currentQr = getCurrentQr();
  if (!currentQr) return res.status(404).json({ success: false, error: state.connected ? 'WhatsApp is already connected.' : 'QR is not ready yet. Wait a few seconds and refresh.' });
  try { res.json({ success: true, qrImage: await QRCode.toDataURL(currentQr) }); }
  catch { res.status(500).json({ success: false, error: 'Could not render QR code.' }); }
});
app.post('/api/pair', requireDashboardToken, async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return res.status(400).json({ success: false, error: 'Enter a valid phone number with country code, numbers only.' });
  try {
    const code = await requestPairingCode(phone);
    res.json({ success: true, code, message: 'On WhatsApp, open Linked Devices → Link a Device → Link with phone number instead, then enter this code.' });
  } catch (err) { res.status(400).json({ success: false, error: err.message || 'Could not generate pairing code.' }); }
});
app.post('/api/restart', requireDashboardToken, async (_req, res) => {
  try { await restartBot(); res.json({ success: true, message: 'Bot is restarting.' }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/logout', requireDashboardToken, async (_req, res) => {
  try { await logoutBot(); res.json({ success: true, message: 'WhatsApp session logged out.' }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`OLLY MD dashboard listening on port ${port}`);
  startBot().catch(err => console.error('[OLLY MD] Startup error:', err));
});
