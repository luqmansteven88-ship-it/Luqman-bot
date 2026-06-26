const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");

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
    browser: ["LUQMAN MD", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing code generation
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(OWNER_NUMBER);

        console.log("=================================");
        console.log("🔑 YOUR PAIRING CODE:");
        console.log(code);
        console.log("📱 Open WhatsApp > Linked Devices");
        console.log("➡ Link with phone number");
        console.log("=================================");
      } catch (err) {
        console.log("Pairing Error:", err.message);
      }
    }, 5000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
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
      "";

    if (MODE === "private" && !isOwner) return;
    if (!body.startsWith(PREFIX)) return;

    const command = body.slice(1).trim().split(/ +/)[0].toLowerCase();

    await sock.sendPresenceUpdate("recording", from);
    await sock.sendPresenceUpdate("composing", from);

    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "⚡ Pong!"
      });
    }

    if (command === "menu") {
      await sock.sendMessage(from, {
        text: `🤖 ${BOT_NAME}\n👑 Owner: ${OWNER_NAME}\n⚙ Mode: ${MODE}`
      });
    }
  });
}

startBot();
