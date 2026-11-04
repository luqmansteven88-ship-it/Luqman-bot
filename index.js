```js
/* ===========================================================
 * LUQMAN MD – ENHANCED
 * =========================================================== */

"use strict";

/* ========== IMPORTS ====================================== */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay          // from Baileys
} = require("@whiskeysockets/baileys");
const P = require("pino");
const fs = require("fs");
const path = require("path");
const { Server } = require("ws");          // websocket API
const sqlite = require("better-sqlite3");   // persistence
const dotenv = require("dotenv");           // for .env
dotenv.config();

/* ========== GLOBAL CONFIG =============================== */
global.ownerNumber = "255678716839";
global.ownerName   = "LUQMAN SJ";
global.botName     = "LUQMAN MD";
global.prefix      = ".";

/* ========== AUTH STATE ==================================== */
const AUTH_DIR = path.join(__dirname, "auth_session");
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

/* ========== LOGGER ======================================= */
const logger = P({ level: "silent" });

/* ========== DATABASE ------------------------------------- */
const db = sqlite(process.env.BOT_DB || "./data/bot.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS user_levels (
    jid TEXT PRIMARY KEY,
    level INTEGER NOT NULL DEFAULT 0,
    last_cmd TEXT,
    lock_until INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT,
    messageId TEXT,
    author TEXT,
    content TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
const stmUserGet  = db.prepare("SELECT * FROM user_levels WHERE jid = ?");
const stmUserIns  = db.prepare(`INSERT OR IGNORE INTO user_levels (jid) VALUES (?)`);
const stmUserUpd  = db.prepare("UPDATE user_levels SET level = ?, last_cmd = ?, lock_until = ? WHERE jid = ?");
const stmLogIns   = db.prepare("INSERT INTO logs (jid, messageId, author, content) VALUES (?,?,?,?)");

/* ========== GLOBAL STATE =============================== */
let sock = null;
let reconnectTimer = null;
let pairingRequested = false;
let shuttingDown = false;

const warnings = new Map();                // in‑memory warnings cache
const antiLinkGroups   = new Set();
const antiStickerGroups = new Set();
const mutedGroups     = new Set();
const messageCache = new Map();
const MAX_CACHE = 300;

/* ========== HELPERS ===================================== */
function jidNumber(jid = "") { return jid.split("@")[0].split(":")[0]; }
function normalizeNumber(n = "") { return n.replace(/\D/g,'').replace(/^0+/, ''); }
function isOwner(sender) { return normalizeNumber(jidNumber(sender)) === normalizeNumber(global.ownerNumber); }
function isGroup(jid = "")   { return jid.endsWith("@g.us"); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function getWarnKey(g,u){ return `${g}:${u}`; }
function getWarnings(g,u){ return warnings.get(getWarnKey(g,u)) || 0; }
function setWarnings(g,u,v){ warnings.set(getWarnKey(g,u), v); }

function getMessageText(msg){
  if (!msg) return "";
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    msg.message.documentMessage?.caption ||
    msg.message.buttonsResponseMessage?.selectedButtonId ||
    msg.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.message.templateButtonReplyMessage?.selectedId ||
    ""
  );
}
function getMessageType(msg){
  if (!msg) return "";
  if (msg.message.conversation) return "text";
  if (msg.message.extendedTextMessage) return "text";
  if (msg.message.imageMessage) return "image";
  if (msg.message.videoMessage) return "video";
  if (msg.message.stickerMessage) return "sticker";
  if (msg.message.audioMessage) return "audio";
  if (msg.message.documentMessage) return "document";
  return "";
}
function containsLink(text = ""){ return /https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|instagram\.com\/|facebook\.com\//i.test(text); }

/* ========== WS API ------------------------------------- */
const wss = new Server({ port: process.env.BOT_WSPORT || 8080 });
wss.on('connection', ws=>{
  ws.on('message', msg=>{
    // only local API – simple JSON payload
    try{
      const { cmd, payload } = JSON.parse(msg);
      switch(cmd){
        case "status":
          ws.send(JSON.stringify({ status:"OK", users: Array.from(wss.clients).length }));
          break;
        case "restart":
          reinitializeBot();
          ws.send(JSON.stringify({ status:"RESTARTED" }));
          break;
        case "broadcast":
          if(payload.text){
             broadcast(payload.text);
          }
          break;
        default:
          ws.send(JSON.stringify({ err:"unknown cmd" }));
      }
    }catch(e){
      ws.send(JSON.stringify({err:e.message}));
    }
  });
});

/* ========== RECONNECT LOGIC =========================== */
async function reinitializeBot(){
  if(sock) sock.disconnect();
  connect();
}

/* ========== PAIRING CODE -------------------------------- */
async function requestPairingCode(){
  if(!sock || pairingRequested || !sock.authState) return;
  if(sock.authState.creds?.registered) return;
  pairingRequested = true;
  const phone = normalizeNumber(global.ownerNumber.replace(/[^\d]/g,""));
  try{
    await delay(2500);
    const code = await sock.requestPairingCode(phone);
    console.log("\n==== PAIRING CODE ====\n"+code+"\n=====================\n");
  }catch(e){
    console.log("Pair```js
  } catch (e) {
    pairingRequested = false;
    console.log("\n❌ Pairing code error:", e?.message || e);
    console.log("");
    // Don't spam WhatsApp with immediate re‑tries.
    await delay(10000);
    if (sock && !sock.authState.creds?.registered && !shuttingDown) {
      requestPairingCode().catch(() => {});
    }
  }
}
``````js
function broadcast(text){
  for (const client of wss.clients){
    if(client.readyState === 1){
      client.send(JSON.stringify({ type:"broadcast", text }));
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
      console.log(`📡 WhatsApp Web version: ${version.join(".")}`);
    } catch (e) {
      console.log("⚠️ Could not fetch latest WhatsApp version. Using Baileys default.");
    }

    const options = {
      auth: state,
      logger,
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
    sock.authState = { creds: state.creds };

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async update => {
      const { connection, lastDisconnect, qr } = update;

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
          console.log(`👤 Number: ${jidNumber(sock.user.id)}`);
        }

        console.log(`🤖 Bot: ${global.botName}`);
        console.log(`👑 Owner: ${global.ownerName}`);
        console.log("");
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Connection closed";

        console.log("");
        console.log("=============================================="```js
console.log("        ⚠️ CONNECTION CLOSED");
        console.log("==============================================");
        console.log(`Code: ${statusCode || "unknown"}`);
        console.log(`Reason: ${errorMessage}`);
        console.log("");

        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            "❌ WhatsApp logged out. Delete auth_session and pair again."
          );
          return;
        }

        if (statusCode === 401) {
          console.log("❌ Authentication failed. The session is invalid.");
          return;
        }

        if (statusCode === 405) {
          console.log("");
          console.log("⚠️ WhatsApp rejected the connection (405).");
          console.log("⚠️ LUQMAN MD will not spam reconnect attempts.");
          console.log("");
          return;
        }

        if (shuttingDown) return;

        if (reconnectTimer) clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!shuttingDown) {
            pairingRequested = false;
            startLuqmanBot().catch(err => {
              console.log("❌ Restart error:", err.message);
            });
          }
        }, 7000);

        console.log("🔄 Reconnecting in 7 seconds...");
      }
    });

    if (!state.creds.registered) {
      console.log("");
      console.log("📲 No WhatsApp session found.");
      console.log("📲 Pairing code will be requested...");
      console.log("");

      const waitForConnection = setInterval(() => {
        if (shuttingDown) {
          clearInterval(waitForConnection);
          return;
        }

        if (sock && sock.ws && sock.ws.isOpen) {
          clearInterval(waitForConnection);
          requestPairingCode().catch(err => {
            console.log("❌ Pairing request failed:", err.message);
          });
        }
      }, 1000);

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

    sock.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const msg = messages?.[0];

        if (!msg) return;
        if (!msg.message) return;
        if (msg.key?.remoteJid === "status@broadcast") return;

        saveMessage(msg);
        await handleMessage(msg);
      } catch (error) {
        console.log("Message handler error:", error.message);
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

  const sender = msg.key.participant || msg.key.remoteJid;
  const text = getMessageText(msg.message).trim();
  const type = getMessageType(msg.message);

  const stmRow = stmUserGet.get(sender);

  if (!stmRow) {
    stmUserIns.run(sender);
    stmUserUpd.run(0, new Date().toISOString(), 0, sender);
  }

  const lockUntil = stmRow?.lock_until || 0;
  const now = Date.now();

  if (lockUntil > now) {
    const remaining = Math.ceil((lockUntil - now) / 1000);
    if (text.startsWith(global.prefix)) {
      await sendText(jid, `⏳ Bot locked. Try again in ${remaining}s.`);
    }
    return;
  }

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
        await sock.sendMessage(jid, { delete: msg.key });

        const count = getWarnings(jid, sender) + 1;
        setWarnings(jid, sender, count);

        await sendText(
          jid,
          `⚠️ @${jidNumber(sender)} sticker haziruhusiwi.\n\nWarning: ${count}/3`,
          { mentions: [sender] }
        );

        if (count >= 3) {
          const admin = await isAdmin(jid, sender);

          if (!admin && !isOwner(sender)) {
            await sock.groupParticipantsUpdate(jid, [sender], "remove");
            setWarnings(jid, sender, 0);

            await sendText(
              jid,
              `🚫 @${jidNumber(sender)} ameondolewa baada ya kufikisha warnings 3.`,
              { mentions: [sender] }
            );
          }
        }
      } catch (e) {
        console.log("Anti-sticker error:", e.message);
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
          await sock.sendMessage(jid, { delete: msg.key });

          const count = getWarnings(jid, sender) + 1;
          setWarnings(jid, sender, count);

          await sendText(
            jid,
            `🚫 LINK IMEZUIWA!\n\n@${jidNumber(sender)}\n⚠️ Warning: ${count}/3`,
            { mentions: [sender] }
          );

          if (count >= 3) {
            await sock.groupParticipantsUpdate(jid, [sender], "remove");
            setWarnings(jid, sender, 0);

            await sendText(
              jid,
              `👢 @${jidNumber(sender)} ameondolewa kwa kufikisha warnings 3.`,
              { mentions: [sender] }
            );
          }

          return;
        } catch (e) {
          console.log("Anti-link error:", e.message);
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
      await sendText(jid, "❌ Command hii inatumika kwenye group tu.");
      return false;
    }

    const admin = await isAdmin(jid, sender);

    if (!admin && !isOwner(sender)) {
      await sendText(jid, "❌ Admin only.");
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
┃ ${global.prefix}lock
┃ ${global.prefix}unlock
┃ ${global.prefix}stats
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

    const sent = await sock.sendMessage(jid, { text: "🏓 Testing..." });

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
    await sendText(jid, `🆔 Your ID:\n${sender}`);
    return;
  }

  // ================================================
  // ECHO
  // ================================================

  if (command === "echo") {
    if (!args.length) {
      await sendText(jid, `Usage: ${global.prefix}echo hello`);
      return;
    }

    await sendText(jid, args.join(" "));
    return;
  }

  // ================================================
  // CALCULATOR
  // ================================================

  if (command === "calc" || command === "math") {
    if (!args.length) {
      await sendText(jid, `Usage: ${global.prefix}calc 25+25`);
      return;
    }

    const expression = args.join(" ");

    if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
      await sendText(jid, "❌ Tafadhali tumia namba na operators: + - * / % ( )");
      return;
    }

    try {
      const result = Function(`"use strict"; return (${expression})`)();
      await sendText(jid, `🧮 ${expression} = ${result}`);
    } catch {
      await sendText(jid, "❌ Calculation error.");
    }

    return;
  }

  // ================================================
  // GROUP INFO
  // ================================================

  if (command === "ginfo") {
    if (!isGroup(jid)) {
      await sendText(jid, "❌ Group only.");
      return;
    }

    const metadata = await getGroupInfo(jid);

    if (!metadata) {
      await sendText(jid, "❌ Failed to get group information.");
      return;
    }

    const admins = metadata.participants.filter(
      p => p.admin === "admin" || p.admin === "superadmin"
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
      await sendText(jid, "❌ Group only.");
      return;
    }

    const metadata = await getGroupInfo(jid);

    if (!metadata) return;

    const admins = metadata.participants.filter(
      p => p.admin === "admin" || p.admin === "superadmin"
    );

    let output = "👑 GROUP ADMINS\n\n";

    for (const admin of admins) {
      output += `• @${jidNumber(admin.id)}\n`;
    }

    await sendText(jid, output, { mentions: admins.map(a => a.id) });
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

    let message = args.length
      ? args.join(" ") + "\n\n"
      : "📢 Attention everyone!\n\n";

    const mentions = [];

    for (const member of members) {
      mentions.push(member.id);
      message += `@${jidNumber(member.id)} `;
    }

    await sock.sendMessage(jid, { text: message, mentions });
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

    const mentions = metadata.participants.map(p => p.id);

    await sock.sendMessage(jid, {
      text: args.length ? args.join(" ") : "📢 Attention!",
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
      await sendText(jid, "❌ Bot lazima awe admin.");
      return;
    }

    let target = null;

    if (
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length
    ) {
      target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }

    if (!target && msg.message?.extendedTextMessage?.contextInfo?.participant) {
      target = msg.message.extendedTextMessage.contextInfo.participant;
    }

    if (!target) {
      await sendText(jid, `❌ Mention user.\n\n${global.prefix}kick @user`);
      return;
    }

    if (isOwner(target)) {
      await sendText(jid, "❌ Huwezi kumtoa owner.");
      return;
    }

    try {
      await sock.groupParticipantsUpdate(jid, [target], "remove");

      await sendText(jid, `👢 @${jidNumber(target)} removed.`, { mentions: [target] });
    } catch (e) {
      await sendText(jid, `❌ Kick failed: ${e.message}`);
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
      await sendText(jid, "❌ Bot lazima awe admin.");
      return;
    }

    const number = normalizeNumber(args[0] || "");

    if (!number) {
      await sendText(jid, `Usage: ${global.prefix}add 2557XXXXXXXX`);
      return;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [`${number}@s.whatsapp.net`],
        "add"
      );

      await sendText(jid, `✅ Attempted to add +${number}`);
    } catch (e) {
      await sendText(jid, `❌ Add failed: ${e.message}`);
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
      await sendText(jid, "❌ Bot lazima awe admin.");
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
      await sendText(jid, `❌ Mention user.\n${global.prefix}promote @user`);
      return;
    }

    try {
      await sock.groupParticipantsUpdate(jid, [target], "promote");

      await sendText(jid, `👑 @${jidNumber(target)} amekuwa admin.`, { mentions: [target] });
    } catch (e) {
      await sendText(jid, `❌ Promote failed: ${e.message}`);
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
      await sendText(jid, "❌ Bot lazima awe admin.");
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
      await sendText(jid, `❌ Mention user.\n${global.prefix}demote @user`);
      return;
    }

    try {
      await sock.groupParticipantsUpdate(jid, [target], "demote");

      await sendText(jid, `⬇️ @${jidNumber(target)} ameondolewa admin.`, { mentions: [target] });
    } catch (e) {
      await sendText(jid, `❌ Demote failed: ${e.message}`);
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
      await sendText(jid, "❌ Bot lazima awe admin.");
      return;
    }

    try {
      const code = await sock.groupInviteCode(jid);

      await sendText(jid, `🔗 GROUP LINK\n\nhttps://chat.whatsapp.com/${code}`);
    } catch (e) {
      await sendText(jid, `❌ Failed: ${e.message}`);
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
      await sendText(jid, "🛡️ Anti-link: ON");
      return;
    }

    if (option === "off") {
      antiLinkGroups.delete(jid);
      await sendText(jid, "🛡️ Anti-link: OFF");
      return;
    }

    await sendText(jid, `Usage:\n${global.prefix}antilink on\n${global.prefix}antilink off`);
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
      await sendText(jid, "🛡️ Anti-sticker: ON");
      return;
    }

    if (option === "off") {
      antiStickerGroups.delete(jid);
      await sendText(jid, "🛡️ Anti-sticker: OFF");
      return;
    }

    await sendText(jid, `Usage:\n${global.prefix}antisticker on\n${global.prefix}antisticker off`);
    return;
  }

  // ================================================
  // WARN
  // ================================================

  if (command === "warn") {
    const allowed = await groupCommand();
    if (!allowed) return;

    const target =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
      await sendText(jid, `❌ Mention user.\n${global.prefix}warn @user`);
      return;
    }

    const count = getWarnings(jid, target) + 1;

    setWarnings(jid, target, count);

    await sendText(
      jid,
      `⚠️ @${jidNumber(target)}\n\nWarning: ${count}/3`,
      { mentions: [target] }
    );

    if (count >= 3) {
      if (await isBotAdmin(jid)) {
        if (!isOwner(target)) {
          await sock.groupParticipantsUpdate(jid, [target], "remove");
          setWarnings(jid, target, 0);

          await sendText(
            jid,
            `🚫 @${jidNumber(target)} ameondolewa baada ya warnings 3.`,
            { mentions: [target] }
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
      await sendText(jid, "❌ Group only.");
      return;
    }

    const target =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
      sender;

    const count = getWarnings(jid, target);

    await sendText(
      jid,
      `⚠️ @${jidNumber(target)} ana warnings ${count}/3`,
      { mentions: [target] }
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
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

    if (!target) {
      await sendText(jid, `❌ Mention user.`);
      return;
    }

    setWarnings(jid, target, 0);

    await sendText(
      jid,
      `✅ Warnings za @${jidNumber(target)} zimefutwa.`,
      { mentions: [target] }
    );

    return;
  }

  // ================================================
  // LOCK / UNLOCK (owner only)
  // ================================================

  if (command === "lock") {
    if (!isOwner(sender)) {
      await sendText(jid, "❌ Owner only.");
      return;
    }

    const duration = parseInt(args[0] || "60");
    const lockUntil = Date.now() + duration * 1000;

    stmUserUpd.run(0, new Date().toISOString(), lockUntil, sender);

    await sendText(jid, `🔒 Bot locked for ${duration}s.`);
    return;
  }

  if (command === "unlock") {
    if (!isOwner(sender)) {
      await sendText(jid, "❌ Owner only.");
      return;
    }

    stmUserUpd.run(0, new Date().toISOString(), 0, sender);

    await sendText(jid, "🔓 Bot unlocked.");
    return;
  }

  // ================================================
  // STATS
  // ================================================

  if (command === "stats") {
    const msgCount = messageCache.size;
    const uptime = process.uptime();

    await sendText(
      jid,
      `📊 STATS\n\nCached messages: ${msgCount}\nUptime: ${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`
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
  console.log("⚠️ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", error => {
  console.log("⚠️ Unhandled Rejection:", error?.message || error);
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
  console.log("❌ Fatal startup error:", error.message);
});
```