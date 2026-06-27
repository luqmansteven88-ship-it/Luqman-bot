const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express"); // Muhimu kwa Render

const BOT_NAME = "LUQMAN MD";
const OWNER_NAME = "LUQMAN SJ";
const OWNER_NUMBER = "255638905914";

let PREFIX = ".";
let MODE = "public";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "120.0.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);
      
      if (reason !== DisconnectReason.loggedOut) {
        startBot(); // Boti itajiwasha yenyewe ikikatika
      }
    } else if (connection === "open") {
      console.log(`✅ ${BOT_NAME} imeunganishwa kwa mafanikio! Ipo Live!`);
    }
  });

  // Mfumo wa kuomba code (haitafanya kazi sasa kwa kuwa umeshalink, lakini ni nzuri kuwepo)
  if (!state.creds.registered) {
    await delay(5000);
    try {
      const code = await sock.requestPairingCode(OWNER_NUMBER);
      console.log(`\n🔑 PAIRING CODE YAKO: ${code}\n`);
    } catch (err) {
      console.log("PAIR ERROR:", err.message);
    }
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isOwner = sender === `${OWNER_NUMBER}@s.whatsapp.net`;

    let body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (MODE === "private" && !isOwner) return;
    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // AUTO RECORD + TYPING
    await sock.sendPresenceUpdate("recording", from);
    await sock.sendPresenceUpdate("composing", from);

    if (command === "menu") {
      const date = new Date().toLocaleDateString();
      const time = new Date().toLocaleTimeString();

      let menu = `
╭━━━〔 *LUQMAN MD MENU* 〕━━━⬣

┋ 🤖 Bot: ${BOT_NAME}
┋ 👑 Owner: ${OWNER_NAME}
┋ ⚙️ Mode: ${MODE.toUpperCase()}
┋ 📅 Date: ${date}
┋ 🕐 Time: ${time}

╭━━〔 *GENERAL* 〕━━⬣
┋ ⭐ .alive
┋ ⭐ .menu
┋ ⭐ .ping
┋ ⭐ .owner

╰━━━〔 *Acha mzaha na maisha* 〕━━⬣
`;
      await sock.sendMessage(from, { text: menu });
    }

    if (command === "alive") {
      await sock.sendMessage(from, { text: "🤖 LUQMAN MD is online 🔥" });
    }

    if (command === "ping") {
      await sock.sendMessage(from, { text: "⚡ Pong!" });
    }

    if (command === "owner") {
      await sock.sendMessage(from, { text: `👑 Owner: ${OWNER_NAME}\n📞 ${OWNER_NUMBER}` });
    }
  });

  // HII NDIO INAYOZUIA ERROR YA "Port scan timeout" KULE RENDER
  const app = express();
  const PORT = process.env.PORT || 10000;
  app.get("/", (req, res) => res.send(`${BOT_NAME} Web Server is Active and Running!`));
  app.listen(PORT, () => console.log(`Server connected on port ${PORT} to keep bot alive.`));
}

startBot();
