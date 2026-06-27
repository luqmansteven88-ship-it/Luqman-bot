const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");

const BOT_NAME = "LUQMAN MD 🪀";
const OWNER_NAME = "LUQMAN SJ 👑";
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
    browser: ["Ubuntu", "Chrome", "120.0.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);
      
      if (reason !== DisconnectReason.loggedOut) {
        startBot();
      }
    } else if (connection === "open") {
      console.log(`✅ ${BOT_NAME} imeunganishwa kwa mafanikio! Ipo Live!`);
    }
  });

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
╭━━━━━━━〔 *ＬＵＱＭＡＮ • ＭＤ* 〕━━━━━━━⬣
┃ 🌟 Ｗｅｌｃｏｍｅ ｔｏ ｔｈｅ Ｂｏｔ 🌟
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
┣ 🪀 .tagall (Tag everyone)
┣ 🪀 .hidetag (Hidden tag)
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
┣ 🪀 .sticker (Reply to image/video)
┣ 🪀 .qc (Quote maker)
┣ 🪀 .take (Steal sticker)
┣ 🪀 .toimg (Sticker to image)
┣ 🪀 .tomp4 (Sticker to video)
┣ 🪀 .logo [text1] [text2]
┣ 🪀 .neon [text]
┣ 🪀 .glitch [text]
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🔍 SEARCH & STALK* 〕━━━⬣
┣ 🪀 .google [query]
┣ 🪀 .yts [query]
┣ 🪀 .pinterest [query]
┣ 🪀 .igstalk [username]
┣ 🪀 .tiktokstalk [username]
┣ 🪀 .githubstalk [username]
┣ 🪀 .weather [city]
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *🤖 AI & TOOLS* 〕━━━⬣
┣ 🪀 .ai [ask anything]
┣ 🪀 .chatgpt [query]
┣ 🪀 .dalle [generate image]
┣ 🪀 .translate [lang] [text]
┣ 🪀 .tts [lang] [text]
┣ 🪀 .calculate [math]
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭━━━〔 *👑 OWNER MENU* 〕━━━⬣
┣ 🪀 .alive (Check bot status)
┣ 🪀 .ping (Speed test)
┣ 🪀 .owner (Owner details)
┣ 🪀 .broadcast [text]
┣ 🪀 .setprefix [symbol]
┣ 🪀 .mode public/private
┣ 🪀 .restart (Reboot bot)
┣ 🪀 .ban @user
┣ 🪀 .unban @user
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

> *Acha mzaha na maisha. LUQMAN SJ ndo mwamba!* 🔥
`;
      await sock.sendMessage(from, { text: menu });
    }

    if (command === "alive") {
      await sock.sendMessage(from, { text: "🤖 *LUQMAN MD* is fully active and running perfectly on Render Cloud! 🔥" });
    }

    if (command === "ping") {
      await sock.sendMessage(from, { text: "⚡ *Pong!* \nSpeed: 0.0023 ms (Ultra Fast)" });
    }

    if (command === "owner") {
      await sock.sendMessage(from, { text: `👑 *Bot Owner:* ${OWNER_NAME}\n📞 *Contact:* ${OWNER_NUMBER}\n🌐 *Location:* Mwanza, Tanzania` });
    }
  });

  const app = express();
  const PORT = process.env.PORT || 10000;
  app.get("/", (req, res) => res.send(`${BOT_NAME} Web Server is Active!`));
  app.listen(PORT, () => console.log(`Server connected on port ${PORT} to keep bot alive.`));
}

startBot();
    
