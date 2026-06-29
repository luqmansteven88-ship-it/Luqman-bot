const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");

const BOT_NAME = "LUQMAN MD";
const OWNER_NAME = "LUQMAN SJ";
const OWNER_NUMBER = "255678716839";

let PREFIX = ".";
let MODE = "public";

let antilink = {};
let antisticker = {};
let mute = {};
let sudo = [];

function wm(text) {
  return `_${text}_\n\n_Acha mzaha na maisha_`;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["LUQMAN-MD", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {

    if (qr) {
      console.clear();
      console.log("╔════════════════════════════╗");
      console.log("║ 📲 SCAN QR TO CONNECT BOT ║");
      console.log("╚════════════════════════════╝");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "connecting") {
      console.log("🔄 Connecting...");
    }

    if (connection === "open") {
      console.log(`✅ ${BOT_NAME} connected successfully`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting...");
        startBot();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const senderNum = sender.split("@")[0];
    const isOwner = sender === `${OWNER_NUMBER}@s.whatsapp.net`;
    const isSudo = sudo.includes(senderNum);

    let body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (mute[from] && !isOwner && !isSudo) return;
    if (MODE === "private" && !isOwner && !isSudo) return;
    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {

      case "menu":
        await sock.sendMessage(from, {
          text: `
╔══════════════════════════════╗
║       🤖 *LUQMAN MD* 🤖
╠══════════════════════════════╣
║ 👑 Owner : ${OWNER_NAME}
║ ⚙ Prefix : ${PREFIX}
║ 🌍 Mode   : ${MODE}
║ 🔥 Bot    : ${BOT_NAME}
╚══════════════════════════════╝

╔════════ *⭐ GENERAL* ════════╗
║ ➤ .menu 📜
║ ➤ .alive 🤖
║ ➤ .ping ⚡
║ ➤ .owner 👑
║ ➤ .uptime ⏰
║ ➤ .repo 💻
║ ➤ .runtime 🛠
╚══════════════════════════════╝

╔════════ *👥 GROUP MENU* ═════╗
║ ➤ .open 🔓
║ ➤ .close 🔒
║ ➤ .kick 👢
║ ➤ .add ➕
║ ➤ .promote ⬆️
║ ➤ .demote ⬇️
║ ➤ .tagall 📢
║ ➤ .hidetag 🕶
║ ➤ .admins 🛡
║ ➤ .linkgc 🔗
║ ➤ .ginfo 📋
║ ➤ .setname 📝
║ ➤ .setdesc 📄
╚══════════════════════════════╝

╔═══════ *🛡 PROTECTION* ══════╗
║ ➤ .antilink on/off 🚫🔗
║ ➤ .antisticker on/off 🚫🖼
║ ➤ .antimedia on/off 🚫🎥
║ ➤ .warn ⚠️
║ ➤ .warnings 📊
║ ➤ .unwarn ♻️
║ ➤ .anticall on/off 📵
║ ➤ .antigroupstatusmention 🚷
╚══════════════════════════════╝

╔════════ *🎨 MEDIA TOOLS* ════╗
║ ➤ .tosticker 🖼➡️🎭
║ ➤ .toimg 🎭➡️🖼
║ ➤ .vv 👁
║ ➤ .getpp 📸
║ ➤ .save 💾
║ ➤ .vvinbox 📥
╚══════════════════════════════╝

╔════════ *👑 OWNER MENU* ═════╗
║ ➤ .setprefix ⚙
║ ➤ .mode 🌍
║ ➤ .restart 🔄
║ ➤ .addsudo ➕👤
║ ➤ .delsudo ➖👤
║ ➤ .listsudo 📜
║ ➤ .block 🚫
║ ➤ .unblock ♻️
║ ➤ .broadcast 📢
║ ➤ .join 🔗
║ ➤ .leave 🚪
╚══════════════════════════════╝

╔═══════ *🤖 AUTOMATION* ══════╗
║ ➤ .autoreply 💬
║ ➤ .autoview 👀
║ ➤ .autosave 💾
║ ➤ .alwaysonline 🟢
║ ➤ .autobio 📝
║ ➤ .newsletter 📰
╚══════════════════════════════╝

╔════════ *⚡ EXTRA TOOLS* ════╗
║ ➤ .sticker 🎭
║ ➤ .trash 🗑
║ ➤ .getmenupic 🖼
║ ➤ .prefixinfo ℹ️
║ ➤ .channelid 📡
║ ➤ .myid 🆔
╚══════════════════════════════╝

╔══════════════════════════════╗
║   _Acha mzaha na maisha_ 🔥
╚══════════════════════════════╝
`
        });
        break;

      case "alive":
        await sock.sendMessage(from, { text: wm("🤖 Bot is alive.") });
        break;

      case "ping":
        await sock.sendMessage(from, { text: wm("⚡ Pong!") });
        break;

      case "owner":
        await sock.sendMessage(from, {
          text: wm(`👑 ${OWNER_NAME}\n📞 ${OWNER_NUMBER}`)
        });
        break;

      case "setprefix":
        if (!isOwner) return;
        PREFIX = args[0] || ".";
        await sock.sendMessage(from, { text: wm(`Prefix changed to ${PREFIX}`) });
        break;

      case "mode":
        if (!isOwner) return;
        MODE = args[0] || "public";
        await sock.sendMessage(from, { text: wm(`Mode changed to ${MODE}`) });
        break;

      case "antilink":
        antilink[from] = args[0] === "on";
        await sock.sendMessage(from, { text: wm(`Antilink ${args[0]}`) });
        break;

      case "antisticker":
        antisticker[from] = args[0] === "on";
        await sock.sendMessage(from, { text: wm(`Antisticker ${args[0]}`) });
        break;

      case "mute":
        mute[from] = args[0] === "on";
        await sock.sendMessage(from, { text: wm(`Mute ${args[0]}`) });
        break;

      case "addsudo":
        if (!isOwner) return;
        sudo.push(args[0]);
        await sock.sendMessage(from, { text: wm(`Added sudo ${args[0]}`) });
        break;

      case "delsudo":
        if (!isOwner) return;
        sudo = sudo.filter(x => x !== args[0]);
        await sock.sendMessage(from, { text: wm(`Removed sudo ${args[0]}`) });
        break;

      case "listsudo":
        await sock.sendMessage(from, {
          text: wm(sudo.length ? sudo.join("\n") : "No sudo users")
        });
        break;

      default:
        await sock.sendMessage(from, {
          text: wm("❌ Unknown command. Use .menu")
        });
    }
  });

  const app = express();
  const PORT = process.env.PORT || 10000;

  app.get("/", (req, res) => {
    res.send(`${BOT_NAME} running`);
  });

  app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
  });
}

startBot();
