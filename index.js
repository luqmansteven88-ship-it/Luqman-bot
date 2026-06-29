const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");
const qrcode = require("qrcode-terminal");

const BOT_NAME = "𓊈𒆜꯭𝆭̽ 𝐋ʋ̽զϻ̈̐𝛂ƞ̄ 𝛅͜𝐉»ً𒆜꧂";
const OWNER_NAME = "𝙇𝙐𝙌𝙈𝘼𝙉 𝙎𝙅";
const OWNER_NUMBER = "255678716839";

let PREFIX = ".";
let MODE = "public";

let antilink = {};
let antisticker = {};
let mute = {};
let sudo = [];
let linkWarnings = {};
let stickerWarnings = {};

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

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

    if (qr) {
      console.log("📷 SCAN THIS QR CODE:");
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
      console.log(`❌ Connection closed: ${reason}`);

      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting in 5 seconds...");
        setTimeout(() => startBot(), 5000);
      } else {
        console.log("🚪 Session logged out.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
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

    // Anti-link
    if (isGroup && antilink[from] && body.includes("https://")) {
      const key = `${from}_${sender}`;
      linkWarnings[key] = (linkWarnings[key] || 0) + 1;

      if (linkWarnings[key] >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        delete linkWarnings[key];
        return await sock.sendMessage(from, {
          text: wm("☠️ Link warning limit reached. User kicked.")
        });
      }

      return await sock.sendMessage(from, {
        text: wm(`⚠️ Link detected (${linkWarnings[key]}/3)`)
      });
    }

    // Anti-sticker
    if (isGroup && antisticker[from] && msg.message.stickerMessage) {
      const key = `${from}_${sender}`;
      stickerWarnings[key] = (stickerWarnings[key] || 0) + 1;

      if (stickerWarnings[key] >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        delete stickerWarnings[key];
        return await sock.sendMessage(from, {
          text: wm("☠️ Sticker spam reached limit. User kicked.")
        });
      }

      return await sock.sendMessage(from, {
        text: wm(`⚠️ Sticker warning (${stickerWarnings[key]}/3)`)
      });
    }

    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
      case "menu":
        await sock.sendMessage(from, {
          text: wm(`
╭┈┈┄⊰ LUQMAN MD MENU ⊱┄┄┄◈

┋ 🤖 Bot: ${BOT_NAME}
┋ 👑 Owner: ${OWNER_NAME}
┋ 🎛️ Mode: ${MODE.toUpperCase()}
┋ 💬 Prefix: ${PREFIX}

┋ 🔰 GENERAL
┋ ⭐ .alive
┋ ⭐ .ping
┋ ⭐ .menu
┋ ⭐ .owner

┋ 🔧 TOOLS
┋ ⭐ .vv
┋ ⭐ .getpp
┋ ⭐ .tosticker
┋ ⭐ .toimg

┋ 👥 GROUP
┋ ⭐ .kick
┋ ⭐ .tagall
┋ ⭐ .antilink on/off
┋ ⭐ .antisticker on/off
┋ ⭐ .mute on/off

┋ ⚙️ OWNER
┋ ⭐ .setprefix
┋ ⭐ .mode public/private
┋ ⭐ .addsudo
┋ ⭐ .delsudo
┋ ⭐ .listsudo

╰┄┄┄┄┄┈┈┈┈┄┄┄◈
> Acha mzaha na maisha
`)
        });
        break;

      case "alive":
        await sock.sendMessage(from, { text: wm("🤖 Bot is alive.") });
        break;

      case "ping":
        await sock.sendMessage(from, { text: wm("⚡ Ultra fast response.") });
        break;

      case "owner":
        await sock.sendMessage(from, {
          text: wm(`👑 ${OWNER_NAME}\n📞 ${OWNER_NUMBER}`)
        });
        break;

      case "setprefix":
        if (!isOwner) return;
        PREFIX = args[0] || ".";
        await sock.sendMessage(from, {
          text: wm(`Prefix changed to ${PREFIX}`)
        });
        break;

      case "mode":
        if (!isOwner) return;
        MODE = args[0] || "public";
        await sock.sendMessage(from, {
          text: wm(`Mode changed to ${MODE}`)
        });
        break;

      case "antilink":
        antilink[from] = args[0] === "on";
        await sock.sendMessage(from, {
          text: wm(`Antilink ${args[0]}`)
        });
        break;

      case "antisticker":
        antisticker[from] = args[0] === "on";
        await sock.sendMessage(from, {
          text: wm(`Antisticker ${args[0]}`)
        });
        break;

      case "mute":
        mute[from] = args[0] === "on";
        await sock.sendMessage(from, {
          text: wm(`Mute ${args[0]}`)
        });
        break;

      case "addsudo":
        if (!isOwner) return;
        sudo.push(args[0]);
        await sock.sendMessage(from, {
          text: wm(`Added sudo ${args[0]}`)
        });
        break;

      case "delsudo":
        if (!isOwner) return;
        sudo = sudo.filter(x => x !== args[0]);
        await sock.sendMessage(from, {
          text: wm(`Removed sudo ${args[0]}`)
        });
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
  const PORT = process.env.PORT || 8080;

  app.get("/", (req, res) => {
    res.send(`${BOT_NAME} running`);
  });

  app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
  });
}

startBot();
