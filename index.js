const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  usePairingCode
} = require("@whiskeysockets/baileys");

const pino = require("pino");

const OWNER_NUMBER = "255678716839";

let MODE = "public";
let PREFIX = ".";

async function startBot(sessionName) {

  const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionName}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["LUQMAN MD", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // 🔥 PAIRING CODE SYSTEM
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(OWNER_NUMBER);

      console.log(`\n🔑 PAIRING CODE FOR ${sessionName}: ${code}\n`);

      // send to owner number
      await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, {
        text: `🔑 Pairing Code (${sessionName}): *${code}*`
      }).catch(() => {});
    }, 3000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        startBot(sessionName);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;

    let body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // MENU SIMPLE TEST
    if (command === "menu") {
      await sock.sendMessage(from, {
        text: `🤖 LUQMAN MD MENU\nMode: ${MODE}`
      });
    }

  });
}

// 🔥 RUN 2 SESSIONS (QR2 STILL SAFE INSIDE SESSION STORAGE)
startBot("session1");
startBot("session2");
