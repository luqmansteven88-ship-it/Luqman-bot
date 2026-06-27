const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express"); // Nimeongeza hii kwa ajili ya Render port binding

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
    // MAREKEBISHO YA BROWSER: Muundo wa kweli unaokubaliwa na WhatsApp bila block
    browser: ["Mac OS", "Chrome", "10.15.7"]
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing Code System
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(OWNER_NUMBER);
        console.log(`\n========================================\n`);
        console.log(`🔑 YOUR PAIRING CODE: ${code}`);
        console.log(`\n========================================\n`);
      } catch (err) {
        console.log("Pairing error:", err.message);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(`${BOT_NAME} connected successfully`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed:", reason);

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

    // Auto presence
    await sock.sendPresenceUpdate("recording", from);
    await sock.sendPresenceUpdate("composing", from);

    // MENU
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

    // ALIVE
    if (command === "alive") {
      await sock.sendMessage(from, {
        text: "🤖 LUQMAN MD is online 🔥"
      });
    }

    // PING
    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "⚡ Pong!"
      });
    }

    // OWNER
    if (command === "owner") {
      await sock.sendMessage(from, {
        text: `👑 Owner: ${OWNER_NAME}\n📞 ${OWNER_NUMBER}`
      });
    }

    // MODE (owner only)
    if (command === "mode" && isOwner) {
      if (args[0] === "public" || args[0] === "private") {
        MODE = args[0];
        await sock.sendMessage(from, {
          text: `⚙️ Mode changed to ${MODE}`
        });
      }
    }

    // PREFIX (owner only)
    if (command === "setprefix" && isOwner) {
      PREFIX = args[0];
      await sock.sendMessage(from, {
        text: `🔣 Prefix changed to ${PREFIX}`
      });
    }

    // RESTART (owner only)
    if (command === "restart" && isOwner) {
      await sock.sendMessage(from, {
        text: "🔄 Restarting..."
      });
      process.exit(0);
    }
  });

  // Hapa chini nimeongeza Server ya Express ili boti isife ikiwa Render (Port Binding)
  const app = express();
  const PORT = process.env.PORT || 10000;
  app.get("/", (req, res) => res.send("LUQMAN MD Web Server Active"));
  app.listen(PORT, () => console.log(`Server connected on port ${PORT}`));
}

startBot();
      
