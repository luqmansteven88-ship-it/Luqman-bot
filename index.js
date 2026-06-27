const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");

const BOT_NAME = "꧁𒆜𝑺𝑻𝑨𝑹 𝑿 𝑺𝑱𒆜꧂🪀";
const OWNER_NAME = "𝙇𝙐𝙌𝙈𝘼𝙉 𝙎𝙅";
const OWNER_NUMBER = "255678716839";

let PREFIX = "+";
let MODE = "private";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["STAR-X", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
      console.log("🔄 Inaunganisha...");

      if (!sock.authState.creds.registered) {
        await delay(3000);
        try {
          const code = await sock.requestPairingCode(OWNER_NUMBER);
          console.log(`\n🔑 PAIRING CODE YAKO: ${code}\n`);
        } catch (err) {
          console.log("❌ Pairing failed:", err.message);
        }
      }
    }

    if (connection === "open") {
      console.log(`✅ ${BOT_NAME} imeunganishwa kikamilifu!`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Inajaribu ku reconnect...");
        startBot();
      } else {
        console.log("🚪 Session ime logout. Futa session u-pair upya.");
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

      let menu = `
╭━━━━━━━〔 *ＬＵＱＭＡＮ • ＭＤ* 〕━━━━━━━⬣
┃ ☠️🔪 Ｗｅｌｃｏｍｅ ｔｏ ｔｈｅ Ｂｏｔ ☠️🔪
┃
┃ 👤 *User:* @Kiongozi
┃ 🤖 *Bot:* ${BOT_NAME}
┃ 👑 *Creator:* ${OWNER_NAME}
┃ 🕰️ *Time:* ${time}
┃ 📅 *Date:* ${date}
┃ ⚙️ *Prefix:* [ ${PREFIX} ]
┃ 🌍 *Mode:* ${MODE.toUpperCase()}
┃ 📡 *Server:* RENDER CLOUD 99.9% UP
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *📥 DOWNLOADER MENU* 〕━━━⬣
┣ 🪀 .tiktok [url]
┣ 🪀 .ig [url]
┣ 🪀 .fb [url]
┣ 🪀 .play [song name]
┣ 🪀 .video [video name]
┣ 🪀 .spotify [url]
┣ 🪀 .twitter [url]
┣ 🪀 .apk [app name]
┣ 🪀 .gdrive [url]
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🛠️ GROUP COMMANDS* 〕━━━⬣
┣ 🪀 .tagall
┣ 🪀 .hidetag
┣ 🪀 .kick @user
┣ 🪀 .add +number
┣ 🪀 .promote @user
┣ 🪀 .demote @user
┣ 🪀 .group open/close
┣ 🪀 .setname [text]
┣ 🪀 .setdesc [text]
┣ 🪀 .antilink on/off
┣ 🪀 .antispam on/off
┣ 🪀 .antifake on/off
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🎨 STICKER & MAKER* 〕━━━⬣
┣ 🪀 .sticker
┣ 🪀 .qc
┣ 🪀 .take
┣ 🪀 .toimg
┣ 🪀 .tomp4
┣ 🪀 .logo
┣ 🪀 .neon
┣ 🪀 .glitch
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🔍 SEARCH & STALK* 〕━━━⬣
┣ 🪀 .google
┣ 🪀 .yts
┣ 🪀 .pinterest
┣ 🪀 .igstalk
┣ 🪀 .tiktokstalk
┣ 🪀 .githubstalk
┣ 🪀 .weather
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🤖 AI & TOOLS* 〕━━━⬣
┣ 🪀 .ai
┣ 🪀 .chatgpt
┣ 🪀 .dalle
┣ 🪀 .translate
┣ 🪀 .tts
┣ 🪀 .calculate
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *👑 🤘OWNER MENU* 〕━━━⬣
┣ 🪀 .alive
┣ 🪀 .ping
┣ 🪀 .owner
┣ 🪀 .broadcast
┣ 🪀 .setprefix
┣ 🪀 .mode public/private
┣ 🪀 .restart
┣ 🪀 .ban
┣ 🪀 .unban
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

> *Acha mzaha na maisha. LUQMAN SJ ndo mwamba!* 🔥
`;

      await sock.sendMessage(from, { text: menu });
    }

    if (command === "alive") {
      await sock.sendMessage(from, {
        text: "🤖 *LUQMAN MD* is fully active and running on Render Cloud 🔥"
      });
    }

    if (command === "ping") {
      await sock.sendMessage(from, {
        text: "⚡ *Pong!* Speed: Ultra Fast"
      });
    }

    if (command === "owner") {
      await sock.sendMessage(from, {
        text: `👑 *Owner:* ${OWNER_NAME}\n📞 *Number:* ${OWNER_NUMBER}\n🌍 *Location:* Mwanza, Tanzania`
      });
    }
  });

  const app = express();
  const PORT = process.env.PORT || 10000;

  app.get("/", (req, res) => {
    res.send(`${BOT_NAME} Web Server is Active!`);
  });

  app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
  });
}

startBot();
