const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");

const BOT_NAME = "LUQMAN MD";
const OWNER_NAME = "LUQMAN SJ";
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
    printQRInTerminal: false,
    // BROWSER FINGERPRINT IMARA ZAIDI
    browser: ["Mac OS", "Chrome", "10.15.7"]
  });

  sock.ev.on("creds.update", saveCreds);

  // MFUMO MPYA WA PAIRING CODE (Nje ya Connection Update kwa uhakika)
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(OWNER_NUMBER);
        console.log("\n=================================");
        console.log("🔑 YOUR PAIRING CODE:");
        console.log(code);
        console.log("Paste on WhatsApp > Linked Devices > Link with phone number");
        console.log("=================================\n");
      } catch (err) {
        console.log("PAIR ERROR:", err.message);
      }
    }, 4000); // Inasubiri sekunde 4 kisha inakupa code kwa nguvu
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(`✅ ${BOT_NAME} connected successfully`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        startBot();
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

╭━━〔 *TOOLS* 〕━━⬣
┋ ⭐ .getpp
┋ ⭐ .vv

╭━━〔 *GROUP* 〕━━⬣
┋ ⭐ .open
┋ ⭐ .close
┋ ⭐ .kick
┋ ⭐ .warn
┋ ⭐ .antilink on/off
┋ ⭐ .antisticker on/off
┋ ⭐ .antimedia on/off

╭━━〔 *OWNER* 〕━━⬣
┋ ⭐ .setprefix
┋ ⭐ .mode public/private
┋ ⭐ .restart

╰━━━〔 *Acha mzaha na maisha* 〕━━⬣
`;
      await sock.sendMessage(from, { text: menu });
    }

    if (command === "alive") {
      await sock.sendMessage(from, {
        text: "🤖 LUQMAN MD is online 🔥"
      });
    }

    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "⚡ Pong!"
      });
    }

    if (command === "owner") {
      await sock.sendMessage(from, {
        text: `👑 Owner: ${OWNER_NAME}\n📞 ${OWNER_NUMBER}`
      });
    }

    if (command === "mode" && isOwner) {
      if (args[0] === "public" || args[0] === "private") {
        MODE = args[0];
        await sock.sendMessage(from, {
          text: `⚙️ Mode changed to ${MODE}`
        });
      }
    }

    if (command === "setprefix" && isOwner) {
      PREFIX = args[0];
      await sock.sendMessage(from, {
        text: `🔣 Prefix changed to ${PREFIX}`
      });
    }

    if (command === "restart" && isOwner) {
      await sock.sendMessage(from, {
        text: "🔄 Restarting bot..."
      });
      process.exit(0);
    }
  });

  // SEVA YA EXPRESS KUZUIA Boti KUZIMWA NA RENDER
  const app = express();
  const PORT = process.env.PORT || 10000;
  app.get("/", (req, res) => res.send(`${BOT_NAME} Web Server is Active!`));
  app.listen(PORT, () => console.log(`Server connected on port ${PORT} to keep bot alive.`));
}

startBot();
