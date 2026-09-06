"use strict";

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const path = require("path");

// =====================================================
// LUQMAN MD - CONFIG
// =====================================================

global.ownerNumber = "255678716839";
global.ownerName = "LUQMAN SJ";
global.botName = "LUQMAN MD";
global.prefix = ".";

const AUTH_DIR = path.join(__dirname, "auth_session");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// =====================================================
// LOGGER
// =====================================================

const logger = P({
  level: "silent"
});

// =====================================================
// BOT STATE
// =====================================================

let sock = null;
let reconnectTimer = null;
let pairingRequested = false;
let shuttingDown = false;

const warnings = new Map();
const antiLinkGroups = new Set();
const antiStickerGroups = new Set();
const mutedGroups = new Set();

const messageCache = new Map();

const MAX_CACHE = 300;

// =====================================================
// HELPERS
// =====================================================

function jidNumber(jid = "") {
  return jid.split("@")[0].split(":")[0];
}

function normalizeNumber(number = "") {
  return number
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function isOwner(sender) {
  const senderNumber = normalizeNumber(jidNumber(sender));
  const ownerNumber = normalizeNumber(global.ownerNumber);

  return senderNumber === ownerNumber;
}

function isGroup(jid = "") {
  return jid.endsWith("@g.us");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getWarnKey(group, user) {
  return `${group}:${user}`;
}

function getWarnings(group, user) {
  return warnings.get(getWarnKey(group, user)) || 0;
}

function setWarnings(group, user, amount) {
  warnings.set(getWarnKey(group, user), amount);
}

function saveMessage(msg) {
  try {
    if (!msg || !msg.key || !msg.key.id) return;

    messageCache.set(msg.key.id, msg);

    if (messageCache.size > MAX_CACHE) {
      const firstKey = messageCache.keys().next().value;
      messageCache.delete(firstKey);
    }
  } catch (e) {
    console.log("Cache error:", e.message);
  }
}

function getMessageText(message) {
  if (!message) return "";

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ""
  );
}

function getMessageType(message) {
  if (!message) return "";

  if (message.conversation) return "text";
  if (message.extendedTextMessage) return "text";
  if (message.imageMessage) return "image";
  if (message.videoMessage) return "video";
  if (message.stickerMessage) return "sticker";
  if (message.audioMessage) return "audio";
  if (message.documentMessage) return "document";

  return "";
}

function containsLink(text = "") {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|instagram\.com\/|facebook\.com\/)/i.test(
    text
  );
}

// =====================================================
// GROUP ADMIN CHECK
// =====================================================

async function getGroupInfo(groupJid) {
  try {
    return await sock.groupMetadata(groupJid);
  } catch (e) {
    return null;
  }
}

function findParticipant(metadata, jid) {
  if (!metadata || !metadata.participants) return null;

  const number = jidNumber(jid);

  return metadata.participants.find(p => {
    return jidNumber(p.id) === number;
  });
}

async function isAdmin(groupJid, userJid) {
  const metadata = await getGroupInfo(groupJid);
  if (!metadata) return false;

  const participant = findParticipant(metadata, userJid);

  return !!(
    participant &&
    (participant.admin === "admin" || participant.admin === "superadmin")
  );
}

async function isBotAdmin(groupJid) {
  if (!sock?.user?.id) return false;

  return await isAdmin(groupJid, sock.user.id);
}

// =====================================================
// SEND HELPERS
// =====================================================

async function sendText(jid, text, quoted = null) {
  try {
    return await sock.sendMessage(
      jid,
      { text },
      quoted ? { quoted } : {}
    );
  } catch (e) {
    console.log("Send error:", e.message);
  }
}

async function react(msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: {
        text: emoji,
        key: msg.key
      }
    });
  } catch {}
}

// =====================================================
// PAIRING
// =====================================================

async function requestPairingCode() {
  if (!sock) return;
  if (pairingRequested) return;
  if (!sock.authState) return;

  if (sock.authState.creds?.registered) {
    return;
  }

  pairingRequested = true;

  try {
    console.log("");
    console.log("==============================================");
    console.log("       🔥 LUQMAN MD PAIRING CODE");
    console.log("==============================================");
    console.log("");

    const phone = normalizeNumber(global.ownerNumber);

    if (!phone) {
      throw new Error("Owner phone number is invalid.");
    }

    await delay(2500);

    const code = await sock.requestPairingCode(phone);

    console.log("");
    console.log(`🔥 PAIRING CODE: ${code}`);
    console.log("");
    console.log(
      "WhatsApp > Linked Devices > Link a device > Link with phone number"
    );
    console.log("");

  } catch (error) {
    pairingRequested = false;

    console.log("");
    console.log("❌ Pairing code error:", error?.message || error);
    console.log("");

    // Don't immediately spam WhatsApp with pairing requests.
    await delay(10000);

    if (
      sock &&
      sock.authState &&
      !sock.authState.creds?.registered &&
      !shuttingDown
    ) {
      requestPairingCode().catch(() => {});
    }
  }
}

// =====================================================
// CONNECTION
// =====================================================

async function startLuqmanBot() {
  if (shuttingDown) return;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version;

    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;

      console.log(
        `📡 WhatsApp Web version: ${version.join(".")}`
      );
    } catch (e) {
      console.log(
        "⚠️ Could not fetch latest WhatsApp version. Using Baileys default."
      );
    }

    const options = {
      auth: state,
      logger,

      // Use the library's canonical browser identity.
      browser: Browsers.ubuntu("Chrome"),

      printQRInTerminal: false,

      markOnlineOnConnect: false,

      syncFullHistory: false,

      generateHighQualityLinkPreview: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 25000
    };

    if (version) {
      options.version = version;
    }

    sock = makeWASocket(options);

    // IMPORTANT:
    // expose auth state for pairing helper
    sock.authState = {
      creds: state.creds
    };

    // =================================================
    // SAVE SESSION
    // =================================================

    sock.ev.on("creds.update", saveCreds);

    // =================================================
    // CONNECTION UPDATE
    // =================================================

    sock.ev.on("connection.update", async update => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {
        console.log("📱 QR received, but LUQMAN MD uses pairing code.");
      }

      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === "open") {
        pairingRequested = true;

        console.log("");
        console.log("==============================================");
        console.log("        ✅ LUQMAN MD CONNECTED");
        console.log("==============================================");
        console.log("");

        if (sock.user) {
          console.log(
            `👤 Number: ${jidNumber(sock.user.id)}`
          );
        }

        console.log(`🤖 Bot: ${global.botName}`);
        console.log(`👑 Owner: ${global.ownerName}`);
        console.log("");
      }

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        const errorMessage =
          lastDisconnect?.error?.message ||
          "Connection closed";

        console.log("");
        console.log("==============================================");
        console.log("        ⚠️ CONNECTION CLOSED");
        console.log("==============================================");
        console.log(`Code: ${statusCode || "unknown"}`);
        console.log(`Reason: ${errorMessage}`);
        console.log("");

        // Logged out
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            "❌ WhatsApp logged out. Delete auth_session and pair again."
          );
          return;
        }

        // Bad session
        if (statusCode === 401) {
          console.log(
            "❌ Authentication failed. The session is invalid."
          );
          return;
        }

        // 405 is handled carefully.
        // Do not create endless pairing attempts.
        if (statusCode === 405) {
          console.log("");
          console.log("⚠️ WhatsApp rejected the connection (405).");
          console.log(
            "⚠️ LUQMAN MD will not spam reconnect attempts."
          );
          console.log("");
          return;
        }

        if (shuttingDown) return;

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;

          if (!shuttingDown) {
            pairingRequested = false;
            startLuqmanBot().catch(err => {
              console.log(
                "❌ Restart error:",
                err.message
              );
            });
          }
        }, 7000);

        console.log("🔄 Reconnecting in 7 seconds...");
      }
    });

    // =================================================
    // REQUEST PAIRING AFTER SOCKET IS READY
    // =================================================

    if (!state.creds.registered) {
      console.log("");
      console.log("📲 No WhatsApp session found.");
      console.log("📲 Pairing code will be requested...");
      console.log("");

      // Wait until connection starts instead of requesting
      // immediately after makeWASocket().
      const waitForConnection = setInterval(() => {
        if (shuttingDown) {
          clearInterval(waitForConnection);
          return;
        }

        if (
          sock &&
          sock.ws &&
          sock.ws.isOpen
        ) {
          clearInterval(waitForConnection);

          requestPairingCode().catch(err => {
            console.log(
              "❌ Pairing request failed:",
              err.message
            );
          });
        }
      }, 1000);

      // Safety fallback
      setTimeout(() => {
        clearInterval(waitForConnection);

        if (
          !shuttingDown &&
          sock &&
          !state.creds.registered &&
          !pairingRequested
        ) {
          requestPairingCode().catch(() => {});
        }
      }, 8000);
    }

    // =================================================
    // MESSAGES
    // =================================================

    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const msg = messages?.[0];

        if (!msg) return;
        if (!msg.message) return;
        if (msg.key?.remoteJid === "status@broadcast") return;

        saveMessage(msg);

        await handleMessage(msg);
      } catch (error) {
        console.log(
          "Message handler error:",
          error.message
        );
      }
    });

  } catch (error) {
    console.log("");
    console.log("❌ STARTUP ERROR:", error.message);
    console.log("");

    if (!shuttingDown) {
      setTimeout(() => {
        startLuqmanBot().catch(() => {});
      }, 10000);
    }
  }
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

async function handleMessage(msg) {
  const jid = msg.key.remoteJid;

  if (!jid) return;

  const sender =
    msg.key.participant ||
    msg.key.remoteJid;

  const text = getMessageText(msg.message).trim();

  const type = getMessageType(msg.message);

  // ================================================
  // ANTI STICKER
  // ================================================

  if (
    isGroup(jid) &&
    type === "sticker" &&
    antiStickerGroups.has(jid)
  ) {
    const botAdmin = await isBotAdmin(jid);

    if (botAdmin && !isOwner(sender)) {
      try {
        await sock.sendMessage(jid, {
          delete: msg.key
        });

        const count = getWarnings(jid, sender) + 1;
        setWarnings(jid, sender, count);

        await sendText(
          jid,
          `⚠️ @${jidNumber(sender)} sticker haziruhusiwi.\n\nWarning: ${count}/3`,
          {
            mentions: [sender]
          }
        );

        if (count >= 3) {
          const admin = await isAdmin(jid, sender);

          if (!admin) {
            await sock.groupParticipantsUpdate(
              jid,
              [sender],
              "remove"
            );

            setWarnings(jid, sender, 0);

            await sendText(
              jid,
              `🚫 @${jidNumber(sender)} ameondolewa baada ya kufikisha warnings 3.`,
              {
                mentions: [sender]
              }
            );
          }
        }
      } catch (e) {
        console.log(
          "Anti-sticker error:",
          e.message
        );
      }
    }

    return;
  }

  // ================================================
  // EMPTY / NON COMMAND
  // ================================================

  if (!text) return;

  // ================================================
  // ANTI LINK
  // ================================================

  if (
    isGroup(jid) &&
    antiLinkGroups.has(jid) &&
    containsLink(text) &&
    !isOwner(sender)
  ) {
    const botAdmin = await isBotAdmin(jid);

    if (botAdmin) {
      const senderAdmin = await isAdmin(jid, sender);

      if (!senderAdmin) {
        try {
          await sock.sendMessage(jid, {
            delete: msg.key
          });

          const count = getWarnings(jid, sender) + 1;
          setWarnings(jid, sender, count);

          await sendText(
            jid,
            `🚫 LINK IMEZUIWA!\n\n@${jidNumber(sender)}\n⚠️ Warning: ${count}/3`,
            {
              mentions: [sender]
            }
          );

          if (count >= 3) {
            await sock.groupParticipantsUpdate(
              jid,
              [sender],
              "remove"
            );

            setWarnings(jid, sender, 0);

            await sendText(
              jid,
              `👢 @${jidNumber(sender)} ameondolewa kwa kufikisha warnings 3.`,
              {
                mentions: [sender]
              }
            );
          }

          return;
        } catch (e) {
          console.log(
            "Anti-link error:",
            e.message
          );
        }
      }
    }
  }

  // ================================================
  // PREFIX
  // ================================================

  if (!text.startsWith(global.prefix)) return;

  const body = text.slice(global.prefix.length).trim();

  if (!body) return;

  const args = body.split(/\s+/);
  const command = args.shift().toLowerCase();

  // ================================================
  // GROUP ADMIN HELPER
  // ================================================

  const groupCommand = async () => {
    if (!isGroup(jid)) {
      await sendText(
        jid,
        "❌ Command hii inatumika kwenye group tu."
      );
      return false;
    }

    const admin = await isAdmin(jid, sender);

    if (!admin && !isOwner(sender)) {
      await sendText(
        jid,
        "❌ Admin only."
      );
      return false;
    }

    return true;
  };

  // ================================================
  // MENU
  // ================================================

  if (command === "menu" || command === "help") {
    const menu = `
╭━━━〔 🔥 ${global.botName} 〕━━━╮
┃
┃ 👑 Owner: ${global.ownerName}
┃ ⚡ Prefix: ${global.prefix}
┃
┣━━〔 🤖 GENERAL 〕━━
┃ ${global.prefix}menu
┃ ${global.prefix}alive
┃ ${global.prefix}ping
┃ ${global.prefix}owner
┃ ${global.prefix}id
┃
┣━━〔 👥 GROUP 〕━━
┃ ${global.prefix}tagall
┃ ${global.prefix}hidetag
┃ ${global.prefix}admins
┃ ${global.prefix}ginfo
┃ ${global.prefix}linkgc
┃ ${global.prefix}kick
┃ ${global.prefix}add
┃ ${global.prefix}promote
┃ ${global.prefix}demote
┃
┣━━〔 🛡️ SECURITY 〕━━
┃ ${global.prefix}antilink on/off
┃ ${global.prefix}antisticker on/off
┃ ${global.prefix}warn
┃ ${global.prefix}warnings
┃ ${global.prefix}unwarn
┃
┣━━〔 🔧 TOOLS 〕━━
┃ ${global.prefix}echo
┃ ${global.prefix}calc
┃
╰━━〔 🔥 LUQMAN MD 〕━━╯
    `.trim();

    await sendText(jid, menu);
    return;
  }

  // ================================================
  // ALIVE
  // ================================================

  if (command === "alive") {
    await sendText(
      jid,
      `🔥 ${global.botName} is alive!\n\n⚡ Status: Online\n👑 Owner: ${global.ownerName}`
    );
    return;
  }

  // ================================================
  // PING
  // ================================================

  if (command === "ping") {
    const start = Date.now();

    const sent = await sock.sendMessage(jid, {
      text: "🏓 Testing..."
    });

    const speed = Date.now() - start;

    await sock.sendMessage(jid, {
      text: `🏓 Pong!\n⚡ ${speed} ms`,
      edit: sent.key
    });

    return;
  }

  // ================================================
  // OWNER
  // ================================================

  if (command === "owner") {
    await sendText(
      jid,
      `👑 OWNER\n\nName: ${global.ownerName}\nNumber: +${global.ownerNumber}`
    );
    return;
  }

  // ================================================
  // ID
  // ================================================

  if (command === "id") {
    await sendText(
      jid,
      `🆔 Your ID:\n${sender}`
    );
    return;
  }

  // ================================================
  // ECHO
  // ================================================

  if (command === "echo") {
    if (!args.length) {
      await sendText(
        jid,
        `Usage: ${global.prefix}echo hello`
      );
      return;
    }

    await sendText(
      jid,
      args.join(" ")
    );

    return;
  }

  // ================================================
  // CALCULATOR
  // ================================================

  if (command === "calc" || command === "math") {
    if (!args.length) {
      await sendText(
        jid,
        `Usage: ${global.prefix}calc 25+25`
      );
      return;
    }

    const expression = args.join(" ");

    // Basic calculator only.
    if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
      await sendText(
        jid,
        "❌ Tafadhali tumia namba na operators: + - * / % ( )"
      );
      return;
    }

    try {
      const result = Function(
        `"use strict"; return (${expression})`
      )();

      await sendText(
        jid,
        `🧮 ${expression} = ${result}`
      );
    } catch {
      await sendText(
        jid,
        "❌ Calculation error."
      );
    }

    return;
  }

  // ================================================
  // GROUP INFO
  // ================================================

  if (command === "ginfo") {
    if (!isGroup(jid)) {
      await sendText(
        jid,
        "❌ Group only."
      );
      return;
    }

    const metadata = await getGroupInfo(jid);

    if (!metadata) {
      await sendText(
        jid,
        "❌ Failed to get group information."
      );
      return;
    }

    const admins = metadata.participants.filter(
      p =>
        p.admin === "admin" ||
        p.admin === "superadmin"
    );

    await sendText(
      jid,
      `╭━━〔 GROUP INFO 〕━━╮
┃
┃ 📛 Name: ${metadata.subject}
┃ 👥 Members: ${metadata.participants.length}
┃ 👑 Admins: ${admins.length}
┃
╰━━━━━━━━━━━━━━━━╯`
    );

    return;
  }

  // ================================================
  // ADMINS
  // ================================================

  if (command === "admins") {
    if (!isGroup(jid)) {
      await sendText(
        jid,
        "❌ Group only."
      );
      return;
    }

    const metadata = await getGroupInfo(jid);

    if (!metadata) return;

    const admins = metadata.participants.filter(
      p =>
        p.admin === "admin" ||
        p.admin === "superadmin"
    );

    let output = "👑 GROUP ADMINS\n\n";

    for (const admin of admins) {
      output += `• @${jidNumber(admin.id)}\n`;
    }

    await sendText(jid, output, {
      mentions: admins.map(a => a.id)
    });

    return;
  }

  // ================================================
  // TAG ALL
  // ================================================

  if (command === "tagall") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const metadata = await getGroupInfo(jid);

    if (!metadata) return;

    const members = metadata.participants;

    let message =
      args.length
        ? args.join(" ") + "\n\n"
        : "📢 Attention everyone!\n\n";

    const mentions = [];

    for (const member of members) {
      mentions.push(member.id);
      message += `@${jidNumber(member.id)} `;
    }

    await sock.sendMessage(jid, {
      text: message,
      mentions
    });

    return;
  }

  // ================================================
  // HIDETAG
  // ================================================

  if (command === "hidetag") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const metadata = await getGroupInfo(jid);

    if (!metadata) return;

    const mentions = metadata.participants.map(
      p => p.id
    );

    await sock.sendMessage(jid, {
      text: args.length
        ? args.join(" ")
        : "📢 Attention!",
      mentions
    });

    return;
  }

  // ================================================
  // KICK
  // ================================================

  if (command === "kick") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const botAdmin = await isBotAdmin(jid);

    if (!botAdmin) {
      await sendText(
        jid,
        "❌ Bot lazima awe admin."
      );
      return;
    }

    let target = null;

    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
      target =
        msg.message.extendedTextMessage.contextInfo
          .mentionedJid[0];
    }

    if (!target && msg.message?.extendedTextMessage?.contextInfo?.participant) {
      target =
        msg.message.extendedTextMessage.contextInfo
          .participant;
    }

    if (!target) {
      await sendText(
        jid,
        `❌ Mention user.\n\n${global.prefix}kick @user`
      );
      return;
    }

    if (isOwner(target)) {
      await sendText(
        jid,
        "❌ Huwezi kumtoa owner."
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [target],
        "remove"
      );

      await sendText(
        jid,
        `👢 @${jidNumber(target)} removed.`,
        {
          mentions: [target]
        }
      );
    } catch (e) {
      await sendText(
        jid,
        `❌ Kick failed: ${e.message}`
      );
    }

    return;
  }

  // ================================================
  // ADD
  // ================================================

  if (command === "add") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const botAdmin = await isBotAdmin(jid);

    if (!botAdmin) {
      await sendText(
        jid,
        "❌ Bot lazima awe admin."
      );
      return;
    }

    const number = normalizeNumber(args[0] || "");

    if (!number) {
      await sendText(
        jid,
        `Usage: ${global.prefix}add 2557XXXXXXXX`
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [`${number}@s.whatsapp.net`],
        "add"
      );

      await sendText(
        jid,
        `✅ Attempted to add +${number}`
      );
    } catch (e) {
      await sendText(
        jid,
        `❌ Add failed: ${e.message}`
      );
    }

    return;
  }

  // ================================================
  // PROMOTE
  // ================================================

  if (command === "promote") {
    const allowed = await groupCommand();
    if (!allowed) return;

    if (!(await isBotAdmin(jid))) {
      await sendText(
        jid,
        "❌ Bot lazima awe admin."
      );
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0];

    if (!target) {
      await sendText(
        jid,
        `❌ Mention user.\n${global.prefix}promote @user`
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [target],
        "promote"
      );

      await sendText(
        jid,
        `👑 @${jidNumber(target)} amekuwa admin.`,
        {
          mentions: [target]
        }
      );
    } catch (e) {
      await sendText(
        jid,
        `❌ Promote failed: ${e.message}`
      );
    }

    return;
  }

  // ================================================
  // DEMOTE
  // ================================================

  if (command === "demote") {
    const allowed = await groupCommand();
    if (!allowed) return;

    if (!(await isBotAdmin(jid))) {
      await sendText(
        jid,
        "❌ Bot lazima awe admin."
      );
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0];

    if (!target) {
      await sendText(
        jid,
        `❌ Mention user.\n${global.prefix}demote @user`
      );
      return;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [target],
        "demote"
      );

      await sendText(
        jid,
        `⬇️ @${jidNumber(target)} ameondolewa admin.`,
        {
          mentions: [target]
        }
      );
    } catch (e) {
      await sendText(
        jid,
        `❌ Demote failed: ${e.message}`
      );
    }

    return;
  }

  // ================================================
  // LINKGC
  // ================================================

  if (command === "linkgc") {
    const allowed = await groupCommand();
    if (!allowed) return;

    if (!(await isBotAdmin(jid))) {
      await sendText(
        jid,
        "❌ Bot lazima awe admin."
      );
      return;
    }

    try {
      const code = await sock.groupInviteCode(jid);

      await sendText(
        jid,
        `🔗 GROUP LINK\n\nhttps://chat.whatsapp.com/${code}`
      );
    } catch (e) {
      await sendText(
        jid,
        `❌ Failed: ${e.message}`
      );
    }

    return;
  }

  // ================================================
  // ANTILINK
  // ================================================

  if (command === "antilink") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const option = args[0]?.toLowerCase();

    if (option === "on") {
      antiLinkGroups.add(jid);

      await sendText(
        jid,
        "🛡️ Anti-link: ON"
      );
      return;
    }

    if (option === "off") {
      antiLinkGroups.delete(jid);

      await sendText(
        jid,
        "🛡️ Anti-link: OFF"
      );
      return;
    }

    await sendText(
      jid,
      `Usage:\n${global.prefix}antilink on\n${global.prefix}antilink off`
    );

    return;
  }

  // ================================================
  // ANTISTICKER
  // ================================================

  if (command === "antisticker") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const option = args[0]?.toLowerCase();

    if (option === "on") {
      antiStickerGroups.add(jid);

      await sendText(
        jid,
        "🛡️ Anti-sticker: ON"
      );
      return;
    }

    if (option === "off") {
      antiStickerGroups.delete(jid);

      await sendText(
        jid,
        "🛡️ Anti-sticker: OFF"
      );
      return;
    }

    await sendText(
      jid,
      `Usage:\n${global.prefix}antisticker on\n${global.prefix}antisticker off`
    );

    return;
  }

  // ================================================
  // WARN
  // ================================================

  if (command === "warn") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const target =
      msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0];

    if (!target) {
      await sendText(
        jid,
        `❌ Mention user.\n${global.prefix}warn @user`
      );
      return;
    }

    const count = getWarnings(jid, target) + 1;

    setWarnings(jid, target, count);

    await sendText(
      jid,
      `⚠️ @${jidNumber(target)}\n\nWarning: ${count}/3`,
      {
        mentions: [target]
      }
    );

    if (count >= 3) {
      if (await isBotAdmin(jid)) {
        if (!isOwner(target)) {
          await sock.groupParticipantsUpdate(
            jid,
            [target],
            "remove"
          );

          setWarnings(jid, target, 0);

          await sendText(
            jid,
            `🚫 @${jidNumber(target)} ameondolewa baada ya warnings 3.`,
            {
              mentions: [target]
            }
          );
        }
      }
    }

    return;
  }

  // ================================================
  // WARNINGS
  // ================================================

  if (command === "warnings") {
    if (!isGroup(jid)) {
      await sendText(
        jid,
        "❌ Group only."
      );
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0] ||
      sender;

    const count = getWarnings(jid, target);

    await sendText(
      jid,
      `⚠️ @${jidNumber(target)} ana warnings ${count}/3`,
      {
        mentions: [target]
      }
    );

    return;
  }

  // ================================================
  // UNWARN
  // ================================================

  if (command === "unwarn") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const target =
      msg.message?.extendedTextMessage?.contextInfo
        ?.mentionedJid?.[0];

    if (!target) {
      await sendText(
        jid,
        `❌ Mention user.`
      );
      return;
    }

    setWarnings(jid, target, 0);

    await sendText(
      jid,
      `✅ Warnings za @${jidNumber(target)} zimefutwa.`,
      {
        mentions: [target]
      }
    );

    return;
  }

  // ================================================
  // UNKNOWN COMMAND
  // ================================================

  await react(msg, "❓");
}

// =====================================================
// PROCESS HANDLING
// =====================================================

process.on("uncaughtException", error => {
  console.log(
    "⚠️ Uncaught Exception:",
    error.message
  );
});

process.on("unhandledRejection", error => {
  console.log(
    "⚠️ Unhandled Rejection:",
    error?.message || error
  );
});

process.on("SIGTERM", () => {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  console.log("🛑 LUQMAN MD shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  console.log("🛑 LUQMAN MD stopped.");
  process.exit(0);
});

// =====================================================
// START
// =====================================================

console.log("");
console.log("==============================================");
console.log("          🔥 LUQMAN MD STARTING");
console.log("==============================================");
console.log("");

startLuqmanBot().catch(error => {
  console.log(
    "❌ Fatal startup error:",
    error.message
  );
});
