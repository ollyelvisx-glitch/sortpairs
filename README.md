# OLLY MD

A fresh OLLY MD implementation using the WhatsApp Web multi-device library Baileys. It takes inspiration from the publicly documented feature set of JAWAD-MD (pairing dashboard, multi-device bot, command menu, AI/media/group features), but this folder contains a new, smaller implementation rather than a copy of JAWAD-MD's obfuscated source files.

**Credit:** Feature inspiration and project reference: [JAWAD-MD by JawadTechX](https://github.com/JawadTechXD/JAWAD-MD). This project is not an official fork and is not affiliated with JawadTechX or WhatsApp.

## Included now
- WhatsApp multi-device connection
- QR pairing dashboard
- Phone-number pairing code dashboard
- Persistent Baileys auth folder (when deployed with a persistent disk)
- `.ping`, `.alive`, `.menu`, `.settings`, `.owner`
- `.save` for ordinary quoted media only
- Basic health endpoint

The `.vv2` / `.vv` commands intentionally do not retrieve View Once media. They explain that the sender should share a normal copy instead. This bot does not bypass WhatsApp's View Once privacy controls.

## Run locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set a long random `DASHBOARD_TOKEN` and your `OWNER_NUMBER` (digits with country code).
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`, enter the dashboard token, then use QR or pairing code.

## Deploy on Render
1. Push this folder to a new GitHub repository.
2. Create a Render **Web Service** from that repository.
3. Build command: `npm install`; Start command: `npm start`.
4. Add a persistent disk mounted at `/var/data` and set `DATA_DIR=/var/data`.
5. Set `DASHBOARD_TOKEN` to a strong secret, `OWNER_NUMBER` to your number, and optionally `BOT_NAME=OLLY MD`.
6. Open the deployed dashboard URL and enter the dashboard token.

Do not share your dashboard token or the `data/auth_info_baileys` session files. Anyone with access to the linked WhatsApp session may be able to control the account. Keep one running instance for this single-session starter.

## Important
This is a starter project, not a claim that every feature in JAWAD-MD has been ported. It currently includes the connection/pairing foundation and basic commands. Downloader integrations, AI provider credentials, full moderation, stickers, anti-delete, and multi-user hosting are not included yet. WhatsApp may restrict or ban accounts for automation; use responsibly and follow WhatsApp's terms.
