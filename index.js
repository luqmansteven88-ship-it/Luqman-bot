const baileys = require("@whiskeysockets/baileys");
const {
  default: makeWASocket,
  useMultiFileAuthState
} = baileys;

const fs = require("fs");

const BOT_NAME = "LUQMAN X MD";
const PREFIX = ".";

// Owner number
const ADMIN_NUMBERS = [
  "255678716839@s.whatsapp.net"
];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // Pairing code
  if (!sock.authState.creds.registered) {
    const phoneNumber = "255678716839";

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);

        console.log("================================");
        console.log("PAIRING CODE:", code);
        console.log("================================");
      } catch (error) {
        console.log("Pairing error:", error);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      console.log("Connection closed, reconnecting...");
      startBot();
    }

    if (connection === "open") {
      console.log(`${BOT_NAME} connected successfully`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];

    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const messageType = Object.keys(msg.message)[0];

    let body = "";

    if (messageType === "conversation") {
      body = msg.message.conversation;
    } else if (messageType === "extendedTextMessage") {
      body = msg.message.extendedTextMessage.text;
    }

    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const isOwner = ADMIN_NUMBERS.includes(sender);

    // Ping command
    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "Bot ipo hewani"
      });
    }

    // Eval command
    if (command === "eval") {
      if (!isOwner) {
        return sock.sendMessage(from, {
          text: "Hii command ni ya owner tu"
        });
      }

      try {
        let result = eval(args.join(" "));
        if (typeof result !== "string") {
          result = require("util").inspect(result);
        }

        await sock.sendMessage(from, {
          text: result
        });
      } catch (err) {
        await sock.sendMessage(from, {
          text: String(err)
        });
      }
    }
  });
}

startBot();
