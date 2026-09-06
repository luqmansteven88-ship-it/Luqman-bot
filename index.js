const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

const P = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");

// ==========================================
// LUQMAN MD CONFIG
// ==========================================
const CONFIG = {
  ownerNumber: "255678716839",
  ownerName: "LUQMAN SJ",
  botName: "LUQMAN MD",
  prefix: ".",
  authDir: "auth_session",
  version: "6.0.0"
};

let conn;
let reconnecting = false;

// ==========================================
// BOT STATE
// ==========================================
const state = {
  botMode: "Public",
  autoReact: false,
  ownerReact: false,
  autoRead: false,
  alwaysOnline: false,
  typing: false,
  recording: false,
  antiCall: false,
  antiSpam: false,
  antiDelete: false,
  antiEdit: false,
  statusSeen: false,
  statusReact: false,
  statusReply: false,

  antiLink: new Set(),
  bannedUsers: new Set(),
  bannedGroups: new Set(),
  bannedGroupUsers: new Map(),
  disabledCommands: new Set(),
  warnings: new Map(),

  cache: new Map(),
  cacheLimit: 150,

  startedAt: Date.now()
};

// ==========================================
// DATA / SETTINGS
// ==========================================
const dataDir = path.join(process.cwd(), "data");
const settingsFile = path.join(dataDir, "settings.json");

fs.mkdirSync(dataDir, { recursive: true });

function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile)) return;

    const raw = JSON.parse(
      fs.readFileSync(settingsFile, "utf8")
    );

    Object.assign(state, {
      botMode: raw.botMode ?? "Public",
      autoReact: !!raw.autoReact,
      ownerReact: !!raw.ownerReact,
      autoRead: !!raw.autoRead,
      alwaysOnline: !!raw.alwaysOnline,
      typing: !!raw.typing,
      recording: !!raw.recording,
      antiCall: !!raw.antiCall,
      antiSpam: !!raw.antiSpam,
      antiDelete: !!raw.antiDelete,
      antiEdit: !!raw.antiEdit,
      statusSeen: !!raw.statusSeen,
      statusReact: !!raw.statusReact,
      statusReply: !!raw.statusReply,

      antiLink: new Set(raw.antiLink || []),
      bannedUsers: new Set(raw.bannedUsers || []),
      bannedGroups: new Set(raw.bannedGroups || []),
      disabledCommands: new Set(raw.disabledCommands || [])
    });

  } catch (e) {
    console.log(
      "⚠️ Could not load settings:",
      e.message
    );
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          botMode: state.botMode,
          autoReact: state.autoReact,
          ownerReact: state.ownerReact,
          autoRead: state.autoRead,
          alwaysOnline: state.alwaysOnline,
          typing: state.typing,
          recording: state.recording,
          antiCall: state.antiCall,
          antiSpam: state.antiSpam,
          antiDelete: state.antiDelete,
          antiEdit: state.antiEdit,
          statusSeen: state.statusSeen,
          statusReact: state.statusReact,
          statusReply: state.statusReply,

          antiLink: [...state.antiLink],
          bannedUsers: [...state.bannedUsers],
          bannedGroups: [...state.bannedGroups],
          disabledCommands: [
            ...state.disabledCommands
          ]
        },
        null,
        2
      )
    );
  } catch (e) {
    console.log(
      "⚠️ Could not save settings:",
      e.message
    );
  }
}

loadSettings();

// ==========================================
// HELPERS
// ==========================================
function ownerJid() {
  return jidNormalizedUser(
    `${CONFIG.ownerNumber}@s.whatsapp.net`
  );
}

function normalizeJid(jid) {
  if (!jid) return "";
  return jidNormalizedUser(jid);
}

function isOwner(jid) {
  return normalizeJid(jid) === ownerJid();
}

function getText(msg) {
  return (
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    msg?.message?.videoMessage?.caption ||
    ""
  ).trim();
}

function getTarget(msg) {
  const ctx =
    msg?.message?.extendedTextMessage?.contextInfo;

  return normalizeJid(
    ctx?.mentionedJid?.[0] ||
    ctx?.participant
  );
}

function addCache(msg) {
  if (!msg?.key?.id) return;

  state.cache.set(msg.key.id, msg);

  if (state.cache.size > state.cacheLimit) {
    const first =
      state.cache.keys().next().value;

    state.cache.delete(first);
  }
}

function uptime() {
  let seconds = Math.floor(
    (Date.now() - state.startedAt) / 1000
  );

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

async function sendText(jid, text, quoted) {
  return conn.sendMessage(
    jid,
    { text },
    quoted ? { quoted } : {}
  );
}

// ==========================================
// MENU
// ==========================================
function menu() {
  const p = CONFIG.prefix;

  return `
╭━━━〔 🤖 ${CONFIG.botName} 〕━━━╮
┃ Version : ${CONFIG.version}
┃ Mode    : ${state.botMode}
┃ Prefix  : ${p}
┃ Owner   : ${CONFIG.ownerName}
╰━━━━━━━━━━━━━━━━━━━━━━╯

👥 GROUP COMMANDS

${p}kick
${p}promote
${p}demote
${p}mute
${p}unmute
${p}tagall
${p}tagadmin
${p}members
${p}groupinfo
${p}invitelink
${p}revokelink
${p}setgname
${p}setgdesc
${p}antilink
${p}warn
${p}warnings
${p}adminlist
${p}myrole
${p}delete
${p}bangc
${p}unbangc
${p}bangcuser
${p}unbangcuser

🛡️ SECURITY

${p}antidelete
${p}antiedit
${p}antispam
${p}anticall
${p}ban
${p}unban
${p}bancmd
${p}unbancmd
${p}block
${p}unblock

⚙️ AUTOMATION

${p}autoreact
${p}ownerreact
${p}autoread
${p}online
${p}typing
${p}recording
${p}statusseen
${p}statusreact
${p}statusreply

👑 OWNER / BOT

${p}alive
${p}ping
${p}owner
${p}botinfo
${p}mode
${p}prefix
${p}clear
${p}restart

━━━━━━━━━━━━━━━━━━━━━━
🔥 ${CONFIG.botName}
Powered by ${CONFIG.ownerName}
`;
}

// ==========================================
// GROUP CONTEXT
// ==========================================
async function groupContext(msg) {
  const jid = msg.key.remoteJid;

  if (!jid?.endsWith("@g.us")) {
    return null;
  }

  const metadata =
    await conn.groupMetadata(jid);

  const admins =
    metadata.participants
      .filter(x => x.admin)
      .map(x => normalizeJid(x.id));

  const me =
    normalizeJid(conn.user?.id);

  return {
    metadata,
    admins,

    isAdmin:
      admins.includes(
        normalizeJid(
          msg.key.participant
        )
      ),

    botAdmin:
      admins.includes(me)
  };
}

// ==========================================
// GROUP PERMISSION
// ==========================================
async function requireGroup(
  msg,
  admin = false
) {
  const g =
    await groupContext(msg);

  if (!g) {
    await sendText(
      msg.key.remoteJid,
      "❌ Command hii inafanya kazi kwenye group tu.",
      msg
    );

    return null;
  }

  const sender =
    normalizeJid(
      msg.key.participant ||
      msg.key.remoteJid
    );

  if (
    admin &&
    !g.isAdmin &&
    !isOwner(sender)
  ) {
    await sendText(
      msg.key.remoteJid,
      "❌ Admin/Owner pekee.",
      msg
    );

    return null;
  }

  if (
    admin &&
    !g.botAdmin
  ) {
    await sendText(
      msg.key.remoteJid,
      "❌ Nifanye Admin kwanza.",
      msg
    );

    return null;
  }

  return g;
}

// ==========================================
// COMMAND HANDLER
// ==========================================
async function handleCommand(msg) {
  const jid =
    msg.key.remoteJid;

  const sender =
    normalizeJid(
      msg.key.participant ||
      jid
    );

  const owner =
    isOwner(sender);

  if (
    state.bannedUsers.has(sender) ||
    state.bannedGroups.has(jid)
  ) {
    return;
  }

  if (
    jid.endsWith("@g.us") &&
    state.bannedGroupUsers
      .get(jid)
      ?.has(sender)
  ) {
    return;
  }

  const text =
    getText(msg);

  if (
    !text.startsWith(
      CONFIG.prefix
    )
  ) {
    return;
  }

  const parts =
    text
      .slice(CONFIG.prefix.length)
      .trim()
      .split(/\s+/);

  const command =
    (parts.shift() || "")
      .toLowerCase();

  const q =
    parts.join(" ");

  if (!command) return;

  if (
    state.disabledCommands.has(
      command
    ) &&
    !owner
  ) {
    return sendText(
      jid,
      `🔕 ${CONFIG.prefix}${command} imezimwa na Owner.`,
      msg
    );
  }

  if (
    state.botMode === "Private" &&
    !owner
  ) {
    return;
  }

  // ========================================
  // ANTI SPAM
  // ========================================
  if (
    state.antiSpam &&
    jid.endsWith("@g.us")
  ) {
    const key =
      `spam:${jid}:${sender}`;

    const now =
      Date.now();

    const old =
      state[key] || [];

    state[key] =
      old.filter(
        t => now - t < 8000
      );

    state[key].push(now);

    if (
      state[key].length > 8
    ) {
      return;
    }
  }

  // ========================================
  // COMMANDS
  // ========================================
  switch (command) {

    // ======================================
    // MENU
    // ======================================
    case "menu":
      return sendText(
        jid,
        menu(),
        msg
      );

    // ======================================
    // PING
    // ======================================
    case "ping": {
      const start =
        Date.now();

      await sendText(
        jid,
        "🏓 Pinging...",
        msg
      );

      return sendText(
        jid,
        `🏓 Pong!

⚡ Response:
${Date.now() - start}ms

⏱️ Uptime:
${uptime()}`,
        msg
      );
    }

    // ======================================
    // ALIVE
    // ======================================
    case "alive":
      return sendText(
        jid,
        `╭━━〔 🟢 ${CONFIG.botName} 〕━━╮
┃ Status: ONLINE
┃ Uptime: ${uptime()}
┃ Version: ${CONFIG.version}
┃ Owner: ${CONFIG.ownerName}
╰━━━━━━━━━━━━━━━━━━╯`,
        msg
      );

    // ======================================
    // OWNER
    // ======================================
    case "owner":
    case "ownernumber":
      return sendText(
        jid,
        `👑 ${CONFIG.ownerName}

📞 wa.me/${CONFIG.ownerNumber}`,
        msg
      );

    // ======================================
    // BOT INFO
    // ======================================
    case "botinfo":
      return sendText(
        jid,
        `🤖 ${CONFIG.botName}

Version: ${CONFIG.version}
Mode: ${state.botMode}
Prefix: ${CONFIG.prefix}
Uptime: ${uptime()}
Node: ${process.version}`,
        msg
      );

    // ======================================
    // MODE
    // ======================================
    case "mode":
      if (!owner) return;

      state.botMode =
        q.toLowerCase() === "private"
          ? "Private"
          : "Public";

      saveSettings();

      return sendText(
        jid,
        `⚙️ Mode: ${state.botMode}`,
        msg
      );

    // ======================================
    // PREFIX
    // ======================================
    case "prefix":
      if (!owner) return;

      if (
        !q ||
        q.length > 3 ||
        /\s/.test(q)
      ) {
        return sendText(
          jid,
          "⚠️ Mfano: .prefix !",
          msg
        );
      }

      CONFIG.prefix = q;

      return sendText(
        jid,
        `✅ Prefix sasa ni: ${CONFIG.prefix}`,
        msg
      );

    // ======================================
    // AUTO REACT
    // ======================================
    case "autoreact":
      if (!owner) return;

      state.autoReact =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `🎭 AutoReact: ${
          state.autoReact
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // OWNER REACT
    // ======================================
    case "ownerreact":
      if (!owner) return;

      state.ownerReact =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `👑 OwnerReact: ${
          state.ownerReact
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // AUTO READ
    // ======================================
    case "autoread":
      if (!owner) return;

      state.autoRead =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `👀 AutoRead: ${
          state.autoRead
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // ONLINE
    // ======================================
    case "online":
      if (!owner) return;

      state.alwaysOnline =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `🟢 Online: ${
          state.alwaysOnline
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // TYPING
    // ======================================
    case "typing":
      if (!owner) return;

      state.typing =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `⌨️ Typing: ${
          state.typing
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // RECORDING
    // ======================================
    case "recording":
      if (!owner) return;

      state.recording =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `🎙️ Recording: ${
          state.recording
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // ANTI DELETE
    // ======================================
    case "antidelete":
      if (!owner) return;

      state.antiDelete =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `🛡️ AntiDelete: ${
          state.antiDelete
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // ANTI EDIT
    // ======================================
    case "antiedit":
      if (!owner) return;

      state.antiEdit =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `📝 AntiEdit: ${
          state.antiEdit
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // ANTI SPAM
    // ======================================
    case "antispam":
      if (!owner) return;

      state.antiSpam =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `⏳ AntiSpam: ${
          state.antiSpam
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // ANTI CALL
    // ======================================
    case "anticall":
      if (!owner) return;

      state.antiCall =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `☎️ AntiCall: ${
          state.antiCall
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // STATUS SEEN
    // ======================================
    case "statusseen":
      if (!owner) return;

      state.statusSeen =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `👁️ StatusSeen: ${
          state.statusSeen
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // STATUS REACT
    // ======================================
    case "statusreact":
      if (!owner) return;

      state.statusReact =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `❤️ StatusReact: ${
          state.statusReact
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // STATUS REPLY
    // ======================================
    case "statusreply":
      if (!owner) return;

      state.statusReply =
        q.toLowerCase() === "on";

      saveSettings();

      return sendText(
        jid,
        `💬 StatusReply: ${
          state.statusReply
            ? "ON"
            : "OFF"
        }`,
        msg
      );

    // ======================================
    // CLEAR CACHE
    // ======================================
    case "clear":
      if (!owner) return;

      state.cache.clear();

      return sendText(
        jid,
        "🧹 Message cache imesafishwa.",
        msg
      );

    // ======================================
    // BAN COMMAND
    // ======================================
    case "bancmd":
      if (!owner) return;

      if (!q) {
        return sendText(
          jid,
          `⚠️ ${CONFIG.prefix}bancmd ping`,
          msg
        );
      }

      state.disabledCommands.add(
        q
          .toLowerCase()
          .replace(
            CONFIG.prefix,
            ""
          )
      );

      saveSettings();

      return sendText(
        jid,
        `🔕 ${q} imezimwa.`,
        msg
      );

    // ======================================
    // UNBAN COMMAND
    // ======================================
    case "unbancmd":
      if (!owner) return;

      if (!q) {
        return sendText(
          jid,
          `⚠️ ${CONFIG.prefix}unbancmd ping`,
          msg
        );
      }

      state.disabledCommands.delete(
        q
          .toLowerCase()
          .replace(
            CONFIG.prefix,
            ""
          )
      );

      saveSettings();

      return sendText(
        jid,
        `🔔 ${q} imewashwa.`,
        msg
      );

    // ======================================
    // GLOBAL BAN
    // ======================================
    case "ban": {
      if (!owner) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag au reply user.",
          msg
        );
      }

      state.bannedUsers.add(
        target
      );

      saveSettings();

      return sendText(
        jid,
        `🚫 @${target.split("@")[0]} amebanwa kutumia bot.`,
        msg
      );
    }

    // ======================================
    // GLOBAL UNBAN
    // ======================================
    case "unban": {
      if (!owner) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag au reply user.",
          msg
        );
      }

      state.bannedUsers.delete(
        target
      );

      saveSettings();

      return sendText(
        jid,
        `✅ @${target.split("@")[0]} ame-unbanwa.`,
        msg
      );
    }

    // ======================================
    // ANTI LINK
    // ======================================
    case "antilink": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const on =
        q.toLowerCase() === "on";

      if (on) {
        state.antiLink.add(jid);
      } else {
        state.antiLink.delete(jid);
      }

      saveSettings();

      return sendText(
        jid,
        `🛡️ AntiLink: ${
          on ? "ON" : "OFF"
        }`,
        msg
      );
    }

    // ======================================
    // MUTE / UNMUTE
    // ======================================
    case "mute":
    case "unmute": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      await conn.groupSettingUpdate(
        jid,
        command === "mute"
          ? "announcement"
          : "not_announcement"
      );

      return sendText(
        jid,
        command === "mute"
          ? "🔒 Group imefungwa kwa members."
          : "🔓 Group imefunguliwa.",
        msg
      );
    }

    // ======================================
    // KICK / PROMOTE / DEMOTE
    // ======================================
    case "kick":
    case "promote":
    case "demote": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag au reply user.",
          msg
        );
      }

      await conn.groupParticipantsUpdate(
        jid,
        [target],
        command === "kick"
          ? "remove"
          : command
      );

      return sendText(
        jid,
        `${
          command === "kick"
            ? "🪓"
            : command === "promote"
            ? "👑"
            : "📉"
        } @${target.split("@")[0]} → ${command}`,
        msg
      );
    }

    // ======================================
    // TAG ALL
    // ======================================
    case "tagall": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const mentions =
        g.metadata.participants
          .map(x =>
            normalizeJid(x.id)
          );

      const lines =
        mentions
          .map(
            x =>
              `@${x.split("@")[0]}`
          )
          .join(" ");

      return conn.sendMessage(
        jid,
        {
          text:
            `📢 ${q || "Attention"}\n\n${lines}`,
          mentions
        },
        { quoted: msg }
      );
    }

    // ======================================
    // TAG ADMIN / ADMIN LIST
    // ======================================
    case "tagadmin":
    case "adminlist": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      const mentions =
        g.admins;

      return conn.sendMessage(
        jid,
        {
          text:
            `👮 ADMINS\n\n${
              mentions
                .map(
                  x =>
                    `@${x.split("@")[0]}`
                )
                .join("\n")
            }`,
          mentions
        },
        { quoted: msg }
      );
    }

    // ======================================
    // MEMBERS
    // ======================================
    case "members": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      return sendText(
        jid,
        `👥 Members: ${g.metadata.participants.length}`,
        msg
      );
    }

    // ======================================
    // MY ROLE
    // ======================================
    case "myrole": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      const role =
        owner
          ? "Owner"
          : g.isAdmin
          ? "Admin"
          : "Member";

      return sendText(
        jid,
        `👤 Role yako: ${role}`,
        msg
      );
    }

    // ======================================
    // GROUP INFO
    // ======================================
    case "groupinfo": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      const creator =
        g.metadata.owner
          ? `@${g.metadata.owner.split("@")[0]}`
          : "Unknown";

      return conn.sendMessage(
        jid,
        {
          text:
            `ℹ️ GROUP INFO

📝 Name: ${g.metadata.subject}
👥 Members: ${g.metadata.participants.length}
👑 Creator: ${creator}
📋 Description: ${g.metadata.desc || "None"}`,

          mentions:
            g.metadata.owner
              ? [
                  normalizeJid(
                    g.metadata.owner
                  )
                ]
              : []
        },
        { quoted: msg }
      );
    }

    // ======================================
    // INVITE LINK
    // ======================================
    case "invitelink": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      if (!g.botAdmin) {
        return sendText(
          jid,
          "❌ Bot lazima awe Admin.",
          msg
        );
      }

      const code =
        await conn.groupInviteCode(
          jid
        );

      return sendText(
        jid,
        `🔗 https://chat.whatsapp.com/${code}`,
        msg
      );
    }

    // ======================================
    // REVOKE LINK
    // ======================================
    case "revokelink": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      await conn.groupRevokeInvite(
        jid
      );

      return sendText(
        jid,
        "♻️ Invite link ime-reset.",
        msg
      );
    }

    // ======================================
    // GROUP NAME
    // ======================================
    case "setgname": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      if (!q) {
        return sendText(
          jid,
          "⚠️ Andika jina jipya.",
          msg
        );
      }

      await conn.groupUpdateSubject(
        jid,
        q
      );

      return sendText(
        jid,
        "✅ Group name updated.",
        msg
      );
    }

    // ======================================
    // GROUP DESCRIPTION
    // ======================================
    case "setgdesc": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      if (!q) {
        return sendText(
          jid,
          "⚠️ Andika description mpya.",
          msg
        );
      }

      await conn.groupUpdateDescription(
        jid,
        q
      );

      return sendText(
        jid,
        "✅ Group description updated.",
        msg
      );
    }

    // ======================================
    // DELETE
    // ======================================
    case "delete": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const ctx =
        msg
          ?.message
          ?.extendedTextMessage
          ?.contextInfo;

      if (!ctx?.stanzaId) {
        return sendText(
          jid,
          "⚠️ Reply message unayotaka kufuta.",
          msg
        );
      }

      return conn.sendMessage(
        jid,
        {
          delete: {
            remoteJid: jid,
            fromMe: false,
            id: ctx.stanzaId,
            participant:
              ctx.participant
          }
        }
      );
    }

    // ======================================
    // WARN
    // ======================================
    case "warn": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag/reply user.",
          msg
        );
      }

      const key =
        `${jid}:${target}`;

      const count =
        (state.warnings.get(key) || 0) + 1;

      state.warnings.set(
        key,
        count
      );

      if (count >= 3) {
        state.warnings.delete(key);

        if (g.botAdmin) {
          await conn.groupParticipantsUpdate(
            jid,
            [target],
            "remove"
          );
        }

        return sendText(
          jid,
          `🚫 @${target.split("@")[0]} amefikisha warnings 3 na ameondolewa.`,
          msg
        );
      }

      return sendText(
        jid,
        `⚠️ @${target.split("@")[0]} warning ${count}/3`,
        msg
      );
    }

    // ======================================
    // WARNINGS
    // ======================================
    case "warnings": {
      const g =
        await requireGroup(
          msg
        );

      if (!g) return;

      const target =
        getTarget(msg) ||
        sender;

      const count =
        state.warnings.get(
          `${jid}:${target}`
        ) || 0;

      return sendText(
        jid,
        `⚠️ @${target.split("@")[0]} ana warnings ${count}/3`,
        msg
      );
    }

    // ======================================
    // BAN GROUP
    // ======================================
    case "bangc": {
      if (!owner) return;

      state.bannedGroups.add(
        jid
      );

      saveSettings();

      return sendText(
        jid,
        "🚫 Group imezuiwa kutumia bot.",
        msg
      );
    }

    // ======================================
    // UNBAN GROUP
    // ======================================
    case "unbangc": {
      if (!owner) return;

      state.bannedGroups.delete(
        jid
      );

      saveSettings();

      return sendText(
        jid,
        "✅ Group imefunguliwa kutumia bot.",
        msg
      );
    }

    // ======================================
    // BAN USER IN GROUP
    // ======================================
    case "bangcuser":
    case "unbangcuser": {
      const g =
        await requireGroup(
          msg,
          true
        );

      if (!g) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag/reply user.",
          msg
        );
      }

      if (
        !state.bannedGroupUsers.has(jid)
      ) {
        state.bannedGroupUsers.set(
          jid,
          new Set()
        );
      }

      const set =
        state.bannedGroupUsers.get(
          jid
        );

      if (
        command === "bangcuser"
      ) {
        set.add(target);
      } else {
        set.delete(target);
      }

      return sendText(
        jid,
        command === "bangcuser"
          ? "🚫 User amezuiwa kutumia bot hapa."
          : "✅ User ameruhusiwa tena.",
        msg
      );
    }

    // ======================================
    // BLOCK / UNBLOCK
    // ======================================
    case "block":
    case "unblock": {
      if (!owner) return;

      const target =
        getTarget(msg);

      if (!target) {
        return sendText(
          jid,
          "⚠️ Tag/reply user.",
          msg
        );
      }

      await conn.updateBlockStatus(
        target,
        command
      );

      return sendText(
        jid,
        `✅ ${command}: @${target.split("@")[0]}`,
        msg
      );
    }

    // ======================================
    // RESTART
    // ======================================
    case "restart":
      if (!owner) return;

      await sendText(
        jid,
        "🔄 Restarting LUQMAN MD...",
        msg
      );

      process.exit(0);

    default:
      return;
  }
}

// ==========================================
// MESSAGE HANDLER
// ==========================================
async function handleMessage(msg) {
  try {
    if (
      !msg?.message ||
      msg.key?.remoteJid ===
        "status@broadcast"
    ) {
      return;
    }

    addCache(msg);

    const jid =
      msg.key.remoteJid;

    const sender =
      normalizeJid(
        msg.key.participant ||
        jid
      );

    // ========================================
    // AUTO READ
    // ========================================
    if (state.autoRead) {
      await conn
        .readMessages([msg.key])
        .catch(() => {});
    }

    // ========================================
    // ONLINE
    // ========================================
    if (state.alwaysOnline) {
      await conn
        .sendPresenceUpdate(
          "available",
          jid
        )
        .catch(() => {});
    }

    // ========================================
    // TYPING
    // ========================================
    if (state.typing) {
      await conn
        .sendPresenceUpdate(
          "composing",
          jid
        )
        .catch(() => {});
    }

    // ========================================
    // RECORDING
    // ========================================
    if (state.recording) {
      await conn
        .sendPresenceUpdate(
          "recording",
          jid
        )
        .catch(() => {});
    }

    // ========================================
    // AUTO REACT
    // ========================================
    if (state.autoReact) {
      const emojis = [
        "👍",
        "🔥",
        "😎",
        "✨",
        "😂",
        "🙌"
      ];

      await conn
        .sendMessage(
          jid,
          {
            react: {
              text:
                emojis[
                  Math.floor(
                    Math.random() *
                    emojis.length
                  )
                ],
              key: msg.key
            }
          }
        )
        .catch(() => {});
    }

    // ========================================
    // OWNER REACT
    // ========================================
    if (
      state.ownerReact &&
      isOwner(sender)
    ) {
      await conn
        .sendMessage(
          jid,
          {
            react: {
              text: "👑",
              key: msg.key
            }
          }
        )
        .catch(() => {});
    }

    // ========================================
    // ANTI LINK
    // ========================================
    const text =
      getText(msg)
        .toLowerCase();

    if (
      state.antiLink.has(jid) &&
      jid.endsWith("@g.us") &&
      /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(
        text
      )
    ) {
      const g =
        await groupContext(
          msg
        ).catch(() => null);

      if (
        g &&
        !g.admins.includes(sender) &&
        !isOwner(sender)
      ) {
        if (g.botAdmin) {

          await conn
            .sendMessage(
              jid,
              {
                delete: msg.key
              }
            )
            .catch(() => {});

          const key =
            `${jid}:${sender}`;

          const count =
            (state.warnings.get(key) || 0) + 1;

          state.warnings.set(
            key,
            count
          );

          await sendText(
            jid,
            `🛡️ Link imefutwa.

⚠️ Warning ${count}/3`,
            msg
          ).catch(() => {});

          if (count >= 3) {
            state.warnings.delete(key);

            await conn
              .groupParticipantsUpdate(
                jid,
                [sender],
                "remove"
              )
              .catch(() => {});
          }
        }
      }
    }

    // ========================================
    // COMMANDS
    // ========================================
    await handleCommand(msg);

  } catch (err) {
    console.log(
      "❌ Message error:",
      err?.stack ||
      err?.message ||
      err
    );
  }
}

// ==========================================
// START BOT
// ==========================================
async function startBot() {

  const {
    state: authState,
    saveCreds
  } =
    await useMultiFileAuthState(
      CONFIG.authDir
    );

  conn = makeWASocket({
    auth: authState,

    logger: P({
      level: "silent"
    }),

    printQRInTerminal: false,

    browser: [
      "LUQMAN MD",
      "Chrome",
      "1.0.0"
    ],

    markOnlineOnConnect: false
  });

  // ========================================
  // SAVE CREDENTIALS
  // ========================================
  conn.ev.on(
    "creds.update",
    saveCreds
  );

  // ========================================
  // PAIRING CODE
  // ========================================
  if (
    !authState.creds.registered
  ) {

    const phone =
      CONFIG.ownerNumber
        .replace(/\D/g, "");

    try {

      await delay(1500);

      const code =
        await conn.requestPairingCode(
          phone
        );

      console.log(
        "\n=============================================="
      );

      console.log(
        `🔥 LUQMAN MD PAIRING CODE: ${code}`
      );

      console.log(
        "==============================================\n"
      );

      console.log(
        "📱 WhatsApp > Linked Devices > Link a device > Link with phone number"
      );

    } catch (err) {

      console.log(
        "❌ Pairing code error:",
        err?.message ||
        err
      );
    }
  }

  // ========================================
  // ANTI CALL
  // ========================================
  conn.ev.on(
    "call",
    async calls => {

      if (!state.antiCall) {
        return;
      }

      for (
        const call of calls
      ) {

        if (
          call.status ===
          "offer"
        ) {

          await conn
            .rejectCall(
              call.id,
              call.from
            )
            .catch(() => {});

          await conn
            .updateBlockStatus(
              call.from,
              "block"
            )
            .catch(() => {});
        }
      }
    }
  );

  // ========================================
  // CONNECTION UPDATE
  // ========================================
  conn.ev.on(
    "connection.update",
    async update => {

      const {
        connection,
        lastDisconnect
      } = update;

      // ====================================
      // CONNECTED
      // ====================================
      if (
        connection === "open"
      ) {

        reconnecting = false;

        console.log(
          "\n✅ LUQMAN MD CONNECTED SUCCESSFULLY!"
        );

        console.log(
          `👑 Owner: ${CONFIG.ownerName}`
        );

        console.log(
          `🤖 Bot: ${CONFIG.botName}`
        );

        console.log(
          `⚡ Version: ${CONFIG.version}`
        );
      }

      // ====================================
      // DISCONNECTED
      // ====================================
      if (
        connection === "close"
      ) {

        const code =
          new Boom(
            lastDisconnect?.error
          )
            ?.output
            ?.statusCode;

        console.log(
          `⚠️ Connection closed. Code: ${
            code ?? "unknown"
          }`
        );

        // ==================================
        // LOGGED OUT
        // ==================================
        if (
          code ===
          DisconnectReason.loggedOut
        ) {

          console.log(
            "❌ WhatsApp logged out."
          );

          console.log(
            "Delete auth_session and pair again."
          );

          return;
        }

        // ==================================
        // RECONNECT
        // ==================================
        if (!reconnecting) {

          reconnecting = true;

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          setTimeout(
            () => {

              startBot()
                .catch(
                  e => {

                    reconnecting =
                      false;

                    console.log(
                      "❌ Restart error:",
                      e.message
                    );
                  }
                );

            },
            5000
          );
        }
      }
    }
  );

  // ========================================
  // MESSAGES
  // ========================================
  conn.ev.on(
    "messages.upsert",
    async update => {

      if (
        update.type !==
        "notify"
      ) {
        return;
      }

      for (
        const msg of
        update.messages
      ) {

        await handleMessage(
          msg
        );
      }
    }
  );
}

// ==========================================
// GLOBAL ERROR HANDLERS
// ==========================================
process.on(
  "uncaughtException",
  err => {

    console.log(
      "❌ Uncaught:",
      err?.stack ||
      err
    );
  }
);

process.on(
  "unhandledRejection",
  err => {

    console.log(
      "❌ Rejection:",
      err?.stack ||
      err
    );
  }
);

// ==========================================
// START
// ==========================================
console.log(
  "🚀 Starting LUQMAN MD..."
);

startBot().catch(
  err => {

    console.error(
      "❌ STARTUP ERROR:",
      err?.stack ||
      err
    );

    process.exit(1);
  }
);
