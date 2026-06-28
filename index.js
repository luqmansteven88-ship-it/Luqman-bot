const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const express = require("express");

const BOT_NAME = "𓊈𒆜꯭𝆭̽ 𝐋ʋ̽զϻ̈̐𝛂ƞ̄ 𝛅͜𝐉»ً𒆜꧂";
const OWNER_NAME = "𝙇𝙐𝙌𝙈𝘼𝙉 𝙎𝙅";
const OWNER_NUMBER = "255678716839";

let PREFIX = ".";
let MODE = "public";

let antilink = {};
let antisticker = {};
let mute = {};
let anticall = {};
let sudo = [];
let linkWarnings = {};
let stickerWarnings = {};

function wm(text) {
  return `_${text}_\n\n_— luqman on fire 🔥_`;
}

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

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "connecting") {
      console.log("🔄 Connecting...");
    }

    if (connection === "open") {
      console.log(`✅ ${BOT_NAME} connected successfully`);
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;

      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻️ Reconnecting...");
        startBot();
      } else {
        console.log("🚪 Logged out.");
      }
    }
  });

  if (!state.creds.registered) {
    await delay(5000);
    const code = await sock.requestPairingCode(OWNER_NUMBER);
    console.log(`🔑 Pairing Code: ${code}`);
  }

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

    await sock.sendPresenceUpdate("composing", from);
    await sock.sendPresenceUpdate("recording", from);

    // ANTI LINK
    if (isGroup && antilink[from] && body.includes("https://")) {
      const key = `${from}_${sender}`;
      linkWarnings[key] = (linkWarnings[key] || 0) + 1;

      try {
        await sock.sendMessage(from, { delete: msg.key });
      } catch {}

      if (linkWarnings[key] >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        delete linkWarnings[key];

        await sock.sendMessage(from, {
          text: wm("☠️ Link violations reached 3. User kicked.")
        });
        return;
      }

      await sock.sendMessage(from, {
        text: wm(`⚠️ Link deleted (${linkWarnings[key]}/3)`)
      });
      return;
    }

    // ANTI STICKER
    if (isGroup && antisticker[from] && msg.message.stickerMessage) {
      const key = `${from}_${sender}`;
      stickerWarnings[key] = (stickerWarnings[key] || 0) + 1;

      try {
        await sock.sendMessage(from, { delete: msg.key });
      } catch {}

      if (stickerWarnings[key] >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        delete stickerWarnings[key];

        await sock.sendMessage(from, {
          text: wm("☠️ Sticker spam reached 3. User kicked.")
        });
        return;
      }

      await sock.sendMessage(from, {
        text: wm(`⚠️ Sticker deleted (${stickerWarnings[key]}/3)`)
      });
      return;
    }

    if (mute[from] && !isOwner && !isSudo) return;
    if (MODE === "private" && !isOwner && !isSudo) return;
    if (!body.startsWith(PREFIX)) return;

    const args = body.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
      switch (command) {
        case "menu":
          await sock.sendMessage(from, {
            text: wm(`
╭━━━〔 ☠️ *LUQMAN MD* ☠️ 〕━━━⬣
┃ 👑 *Owner:* ${OWNER_NAME}
┃ 🤖 *Bot:* ${BOT_NAME}
┃ ⚡ *Prefix:* ${PREFIX}
┃ 🌍 *Mode:* ${MODE}
┃ 🔥 *Sudo:* ${sudo.length}
╰━━━━━━━━━━━━━━━━━━━━⬣

╭─〔 💀 *GROUP MENU* 〕─⬣
┃ ➤ .tagall      ➤ .hidetag
┃ ➤ .kick        ➤ .add
┃ ➤ .promote     ➤ .demote
┃ ➤ .group       ➤ .setname
┃ ➤ .setdesc     ➤ .admins
┃ ➤ .ginfo       ➤ .linkgc
╰━━━━━━━━━━━━━━━━━━━━⬣

╭─〔 🛡 *PROTECTION* 〕─⬣
┃ ➤ .antilink on/off
┃ ➤ .antisticker on/off
┃ ➤ .anticall on/off
┃ ➤ .mute on/off
┃ ➤ .warn        ➤ .warnings
┃ ➤ .unwarn
╰━━━━━━━━━━━━━━━━━━━━⬣

╭─〔 🎨 *CONVERT MENU* 〕─⬣
┃ ➤ .tosticker   ➤ .toimg
┃ ➤ .vv          ➤ .getdp
┃ ➤ .togroupstatus
╰━━━━━━━━━━━━━━━━━━━━⬣

╭─〔 👑 *OWNER MENU* 〕─⬣
┃ ➤ .alive       ➤ .ping
┃ ➤ .owner       ➤ .restart
┃ ➤ .setprefix   ➤ .mode
┃ ➤ .addsudo     ➤ .delsudo
┃ ➤ .listsudo
╰━━━━━━━━━━━━━━━━━━━━⬣

╭─〔 ☠️ *SYSTEM* 〕─⬣
┃ ➤ AutoTyping : ON
┃ ➤ AutoRecord : ON
┃ ➤ Runtime    : HEROKU
╰━━━━━━━━━━━━━━━━━━━━⬣

╰─➤ *LUQMAN ON FIRE* 🔥
`)
          });
          break;

        case "alive":
          await sock.sendMessage(from, { text: wm("🤖 Bot is alive.") });
          break;

        case "ping":
          await sock.sendMessage(from, { text: wm("⚡ Ultra fast.") });
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
          if (!args[0]) return;
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

        case "tagall":
        case "hidetag":
        case "kick":
        case "add":
        case "promote":
        case "demote":
        case "group":
        case "setname":
        case "setdesc":
        case "admins":
        case "ginfo":
        case "linkgc":
        case "warn":
        case "warnings":
        case "unwarn":
        case "vv":
        case "getdp":
        case "tosticker":
        case "toimg":
        case "togroupstatus":
        case "restart":
          await sock.sendMessage(from, {
            text: wm(`✅ Command ${command} received.`)
          });
          break;

        default:
          await sock.sendMessage(from, {
            text: wm("❌ Unknown command. Use .menu")
          });
      }
    } catch (err) {
      console.log(err);
      await sock.sendMessage(from, {
        text: wm("⚠️ Error executing command.")
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
