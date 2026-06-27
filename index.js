const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");

const BOT_NAME = "꧁𒆜𝑺𝑻𝑨𝑹 𝑿 𝑺𝑱𒆜꧂🪀";
const OWNER_NAME = "𝙇𝙐𝙌𝙈𝘼𝙉 𝙎𝙅";
const OWNER_NUMBER = "255678716839";

let PREFIX = ".";
let MODE = "public";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["STAR-X", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📌 Scan QR code from Render logs");
    }

    if (connection === "connecting") {
      console.log("🔄 Connecting...");
    }

    if (connection === "open") {
      console.log(`✅ ${BOT_NAME} connected successfully!`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting...");
        startBot();
      } else {
        console.log("🚪 Logged out. Delete session and scan again.");
      }
    }
  });

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

    await sock.sendPresenceUpdate("recording", from);
    await sock.sendPresenceUpdate("composing", from);

    if (command === "menu") {
      const date = new Date().toLocaleDateString();
      const time = new Date().toLocaleTimeString();

      const menu = `
╭━━━━━━━〔 *ＬＵＱＭＡＮ • ＭＤ* 〕━━━━━━━⬣
┃ 🌟 Welcome to the Bot 🌟
┃ 👤 User: @Kiongozi
┃ 🤖 Bot: ${BOT_NAME}
┃ 👑 Creator: ${OWNER_NAME}
┃ 🕰️ Time: ${time}
┃ 📅 Date: ${date}
┃ ⚙️ Prefix: ${PREFIX}
┃ 🌍 Mode: ${MODE.toUpperCase()}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *MAIN MENU* 〕━━━⬣
┣ 🪀 .menu
┣ 🪀 .alive
┣ 🪀 .ping
┣ 🪀 .owner
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

> *LUQMAN SJ ndo mwamba!* 🔥
`;

      await sock.sendMessage(from, { text: menu });
    }

    if (command === "alive") {
      await sock.sendMessage(from, {
        text: "🤖 Bot is active and running on Render."
      });
    }

    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "⚡ Pong! Speed: Ultra Fast"
      });
    }

    if (command === "owner") {
      await sock.sendMessage(from, {
        text: `👑 Owner: ${OWNER_NAME}\n📞 ${OWNER_NUMBER}`
      });
    }
  });

  const app = express();
  const PORT = process.env.PORT || 10000;

  app.get("/", (req, res) => {
    res.send(`${BOT_NAME} is running`);
  });

  app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
  });
}

startBot();
