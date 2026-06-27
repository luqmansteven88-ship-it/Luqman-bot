const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "120.0.0.0"] // Browser version updated
  });

  sock.ev.on("creds.update", saveCreds);

  // Subiri socket iwe tayari kabla ya kuomba pairing code
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Boti imeunganishwa kwa mafanikio!");
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(5000); // Subiri kidogo boti itulie
    const code = await sock.requestPairingCode("255638905914"); // Namba yako mpya
    console.log(`\n🔑 PAIRING CODE YAKO: ${code}\n`);
  }
}
startBot();
