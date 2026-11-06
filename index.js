const express = require('express');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  jidNormalizedUser,
  getContentType,
} = require('@whiskeysockets/baileys');
const cfg = require('./config');
const store = require('./store');
const commands = require('./commands');

const logger = pino({ level: 'silent' });
const num = commands.num;
const ownerJid = cfg.ownerNumber + '@s.whatsapp.net';
const msgStore = new Map(); // for antidelete (last 500 messages)
const spam = new Map();
const LINK_RE = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;

// ---------- keep-alive web server for Render ----------
const app = express();
app.get('/', (_, res) => res.send(`${cfg.botName} is running`));
app.listen(process.env.PORT || 3000, () => console.log('Web server started'));

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

let reminderTimer;

async function start() {
  await store.connect();
  const settings = await store.getSettings();
  const { state, saveCreds } = await store.useMongoAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // ---------- pairing code ----------
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cfg.ownerNumber);
        console.log('\n=============================');
        console.log(' PAIRING CODE: ' + (code.match(/.{1,4}/g) || [code]).join('-'));
        console.log('=============================\n');
      } catch (e) {
        console.log('Pairing code error:', e.message);
      }
    }, 4000);
  }

  // ---------- connection ----------
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log(`${cfg.botName} connected as ${sock.user?.id}`);
      try { await sock.sendMessage(ownerJid, { text: `✅ *${cfg.botName}* is online.\nType ${settings.prefix}menu` }); } catch {}
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed, code:', code);
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out. Clearing session; a new pairing code will be created.');
        await store.clearAuth();
      }
      setTimeout(start, 3000);
    }
  });

  // ---------- reminders ----------
  clearInterval(reminderTimer);
  reminderTimer = setInterval(async () => {
    try {
      const due = await store.col('reminders').find({ at: { $lte: Date.now() } }).toArray();
      for (const r of due) {
        await store.col('reminders').deleteOne({ _id: r._id });
        await sock.sendMessage(r.jid, { text: `⏰ *Reminder*\n${r.text}`, mentions: r.user ? [r.user] : [] });
      }
    } catch {}
  }, 20000);

  // ---------- anticall ----------
  sock.ev.on('call', async (calls) => {
    if (!settings.anticall) return;
    for (const c of calls) {
      if (c.status !== 'offer') continue;
      try {
        await sock.rejectCall(c.id, c.from);
        await sock.sendMessage(c.from, { text: `📵 Calls are not allowed. Please send a message to ${cfg.botName} instead.` });
      } catch {}
    }
  });

  // ---------- welcome / goodbye ----------
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      const g = await store.getGroup(id);
      if (!((action === 'add' && g.welcome) || (action === 'remove' && g.goodbye))) return;
      const meta = await sock.groupMetadata(id);
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id;
        const tpl = action === 'add' ? g.welcomeMsg : g.goodbyeMsg;
        const text = tpl.replace(/@user/g, '@' + num(jid)).replace(/{group}/g, meta.subject).replace(/{desc}/g, meta.desc || '');
        await sock.sendMessage(id, { text, mentions: [jid] });
      }
    } catch (e) { console.error('welcome error', e.message); }
  });

  // ---------- messages ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try { await handle(sock, m); } catch (e) { console.error('handle error', e); }
    }
  });
}

async function handle(sock, m) {
  if (!m.message || m.key.remoteJid === 'status@broadcast') return;
  const settings = await store.getSettings();
  const content = normalizeMessageContent(m.message);
  if (!content) return;

  // antidelete: someone deleted a message
  const proto = content.protocolMessage;
  if (proto) {
    if (proto.type === 0 && settings.antidelete) {
      const orig = msgStore.get(proto.key?.id);
      if (orig && !orig.key.fromMe) {
        const who = orig.key.participant || orig.key.remoteJid;
        try {
          await sock.sendMessage(ownerJid, {
            text: `🗑️ *Deleted message detected*\nFrom: @${num(who)}\nChat: ${orig.key.remoteJid}`,
            mentions: [who],
          });
          await sock.sendMessage(ownerJid, { forward: orig });
        } catch {}
      }
    }
    return;
  }

  msgStore.set(m.key.id, m);
  if (msgStore.size > 500) msgStore.delete(msgStore.keys().next().value);

  const from = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender = jidNormalizedUser(m.key.fromMe ? sock.user.id : m.key.participant || from);
  const mtype = getContentType(content);
  const text =
    content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || '';
  const contextInfo = typeof content[mtype] === 'object' ? content[mtype]?.contextInfo : undefined;

  const isOwner = !!m.key.fromMe || num(sender) === cfg.ownerNumber || settings.sudo.includes(num(sender));
  if (!isOwner && settings.banned.includes(num(sender))) return;

  const reply = (t, extra = {}) => sock.sendMessage(from, { text: t, ...extra }, { quoted: m });
  const ctx = { sock, m, from, sender, isGroup, isOwner, content, contextInfo, settings, prefix: settings.prefix, reply, text: '', args: [], cmd: '' };

  if (isGroup && !m.key.fromMe && (await protect(ctx, mtype, text))) return;

  // ---------- command ----------
  const prefix = settings.prefix;
  if (!text.startsWith(prefix)) return;
  if (settings.mode === 'private' && !isOwner) return;

  const body = text.slice(prefix.length).trim();
  if (!body) return;
  const [cmd, ...args] = body.split(/\s+/);
  ctx.cmd = cmd.toLowerCase();
  ctx.args = args;
  ctx.text = body.slice(cmd.length).trim();
  await commands.run(ctx);
}

// Group protections. Returns true if the message was removed.
async function protect(ctx, mtype, text) {
  const { sock, m, from, sender, isOwner } = ctx;
  if (isOwner) return false;
  const g = await store.getGroup(from);
  if (g.antilink === 'off' && !g.antisticker && !g.antispam && !g.antibot) return false;

  const info = await commands.adminInfo(ctx);
  if (!info.isBotAdmin || info.isAdmin) return false;
  const del = () => sock.sendMessage(from, { delete: m.key }).catch(() => {});

  if (g.antilink !== 'off' && LINK_RE.test(text)) {
    await del();
    if (g.antilink === 'warn') await commands.addWarn(ctx, g, sender, 'Sending links');
    return true;
  }
  if (g.antisticker && mtype === 'stickerMessage') {
    await del();
    return true;
  }
  if (g.antibot && /^BAE5/.test(m.key.id || '') && (m.key.id || '').length === 16) {
    await del();
    try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch {}
    return true;
  }
  if (g.antispam) {
    const k = from + sender;
    const now = Date.now();
    const arr = (spam.get(k) || []).filter((t) => now - t < 8000);
    arr.push(now);
    spam.set(k, arr);
    if (arr.length >= 7) {
      spam.delete(k);
      await del();
      await commands.addWarn(ctx, g, sender, 'Spamming');
      return true;
    }
  }
  return false;
}

start();
