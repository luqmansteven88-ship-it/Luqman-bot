/* =====================================================
   LUQMAN X MD  -  WhatsApp bot (Baileys) - single file
   ===================================================== */
const express = require('express');
const axios = require('axios');
const QRCode = require('qrcode');
const sharp = require('sharp');
const tts = require('google-tts-api');
const pino = require('pino');
const { MongoClient } = require('mongodb');
const { Sticker } = require('wa-sticker-formatter');
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  jidNormalizedUser,
  getContentType,
  downloadMediaMessage,
  proto: waProto,
  initAuthCreds,
  BufferJSON,
} = require('@whiskeysockets/baileys');

// ===================== CONFIG =====================
const cfg = {
  botName: 'LUQMAN X MD',
  ownerName: 'LUQMAN SJ',
  ownerNumber: '255678716839',
  prefix: '.',
  stickerPack: 'LUQMAN X MD',
  utcOffset: 3, // East Africa (UTC+3) for .remind
  mongoUri: 'mongodb+srv://luqmansteven88_db_user:Luqman2026Bot@cluster0.epsc00l.mongodb.net/',
  dbName: 'luqmanxmd',
  geminiKey: 'AQ.Ab8RN6LZUSJKDuaNDxI1chc_PheC8mHr0U_NbD14dlLEdPqf-Q',
};

const logger = pino({ level: 'silent' });
const num = (j) => (j || '').split('@')[0].split(':')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ownerJid = cfg.ownerNumber + '@s.whatsapp.net';

// ===================== DATABASE =====================
let db;
const cache = { settings: null, groups: new Map() };
const col = (n) => db.collection(n);

async function dbConnect() {
  const client = new MongoClient(cfg.mongoUri);
  await client.connect();
  db = client.db(cfg.dbName);
  console.log('MongoDB connected');
}

// WhatsApp session stored in MongoDB (survives Render restarts)
async function useMongoAuthState() {
  const auth = col('auth');
  const write = (data, id) =>
    auth.replaceOne({ _id: id }, { _id: id, v: JSON.stringify(data, BufferJSON.replacer) }, { upsert: true });
  const read = async (id) => {
    const d = await auth.findOne({ _id: id });
    return d ? JSON.parse(d.v, BufferJSON.reviver) : null;
  };
  const remove = (id) => auth.deleteOne({ _id: id });
  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let v = await read(`${type}-${id}`);
              if (type === 'app-state-sync-key' && v) v = waProto.Message.AppStateSyncKeyData.fromObject(v);
              data[id] = v;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat in data) {
            for (const id in data[cat]) {
              const v = data[cat][id];
              const key = `${cat}-${id}`;
              tasks.push(v ? write(v, key) : remove(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds'),
  };
}
const clearAuth = () => col('auth').deleteMany({});

async function getSettings() {
  if (cache.settings) return cache.settings;
  let s = await col('settings').findOne({ _id: 'global' });
  if (!s) {
    s = { _id: 'global', prefix: cfg.prefix, mode: 'public', sudo: [], banned: [], anticall: false, antidelete: false };
    await col('settings').insertOne(s);
  }
  cache.settings = s;
  return s;
}
const saveSettings = () => col('settings').replaceOne({ _id: 'global' }, cache.settings, { upsert: true });

async function getGroup(jid) {
  if (cache.groups.has(jid)) return cache.groups.get(jid);
  let g = await col('groups').findOne({ _id: jid });
  if (!g) {
    g = {
      _id: jid,
      welcome: false,
      goodbye: false,
      welcomeMsg: 'Welcome @user to *{group}* 🎉',
      goodbyeMsg: 'Goodbye @user 👋',
      antilink: 'off',
      antisticker: false,
      antispam: false,
      antibot: false,
      warns: {},
    };
    await col('groups').insertOne(g);
  }
  cache.groups.set(jid, g);
  return g;
}
const saveGroup = (g) => col('groups').replaceOne({ _id: g._id }, g, { upsert: true });

// ===================== HELPERS =====================
async function adminInfo(ctx) {
  const { sock, from, sender } = ctx;
  const meta = await sock.groupMetadata(from);
  const same = (p, jid) => {
    const j = jidNormalizedUser(jid || '');
    return [p.id, p.lid, p.phoneNumber].some((x) => x && jidNormalizedUser(x) === j);
  };
  const isAdm = (p) => p.admin === 'admin' || p.admin === 'superadmin';
  const me = [sock.user?.id, sock.user?.lid].filter(Boolean);
  return {
    meta,
    isAdmin: meta.participants.some((p) => isAdm(p) && same(p, sender)),
    isBotAdmin: meta.participants.some((p) => isAdm(p) && me.some((j) => same(p, j))),
  };
}

function getTargets(ctx) {
  const ci = ctx.contextInfo || {};
  const t = [...(ci.mentionedJid || [])];
  if (!t.length && ci.participant) t.push(ci.participant);
  if (!t.length) {
    for (const a of ctx.args) {
      const d = a.replace(/\D/g, '');
      if (d.length >= 8) t.push(d + '@s.whatsapp.net');
    }
  }
  return t;
}

async function getMedia(ctx, kinds) {
  const { m, contextInfo, content, from, sock } = ctx;
  let msg = null;
  if (kinds.some((k) => content[k])) msg = m;
  else if (contextInfo?.quotedMessage) {
    const q = normalizeMessageContent(contextInfo.quotedMessage);
    if (kinds.some((k) => q?.[k])) {
      msg = {
        key: { remoteJid: from, id: contextInfo.stanzaId, participant: contextInfo.participant, fromMe: false },
        message: contextInfo.quotedMessage,
      };
    }
  }
  if (!msg) return null;
  return downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
}

const onoff = (v) => (v === 'on' ? true : v === 'off' ? false : null);
const fmtTime = (s) => {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m ${s % 60}s`;
};
const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z#0-9]+;/gi, '');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function addWarn(ctx, g, jid, reason) {
  const { sock, from } = ctx;
  const k = num(jid);
  g.warns[k] = (g.warns[k] || 0) + 1;
  const c = g.warns[k];
  if (c >= 3) {
    g.warns[k] = 0;
    await saveGroup(g);
    await sock.sendMessage(from, { text: `⛔ @${k} reached 3 warnings and was removed.\nReason: ${reason}`, mentions: [jid] });
    try { await sock.groupParticipantsUpdate(from, [jid], 'remove'); } catch {}
  } else {
    await saveGroup(g);
    await sock.sendMessage(from, { text: `⚠️ @${k} warning ${c}/3\nReason: ${reason}`, mentions: [jid] });
  }
}

function parseWhen(s) {
  let m = s.match(/^(\d+)(s|m|h|d)$/i);
  if (m) return Date.now() + Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2].toLowerCase()];
  m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const now = new Date(Date.now() + cfg.utcOffset * 36e5);
    const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, min) - cfg.utcOffset * 36e5;
    return t > Date.now() ? t : t + 864e5;
  }
  return null;
}

// ---------- Gemini AI ----------
const aiCooldown = new Map();
async function askGemini(prompt) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastErr;
  for (const model of models) {
    try {
      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, timeout: 30000 }
      );
      const t = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (t) return t;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('empty response');
}

// ===================== COMMANDS =====================
const list = [];
const map = new Map();
function add(opts, run) {
  const c = { ...opts, run };
  list.push(c);
  for (const n of c.names) map.set(n, c);
}

// ---------- GENERAL ----------
add({ names: ['menu', 'help'], cat: 'General' }, async (ctx) => {
  const icons = { General: '🤖', AI: '🧠', Tools: '🔧', Media: '🎨', Productivity: '📝', Fun: '🎲', Group: '👥', Security: '🛡️', Settings: '⚙️' };
  const cats = {};
  for (const c of list) (cats[c.cat] ||= []).push(c.names[0]);
  const p = ctx.prefix;
  let t = `╭━━━〔 🔥 ${cfg.botName} 〕━━━╮\n┃\n┃ 👑 Owner: ${cfg.ownerName}\n┃ ⚡ Prefix: ${p}\n┃ 🌐 Mode: ${ctx.settings.mode}\n┃\n`;
  for (const [cat, names] of Object.entries(cats)) {
    t += `┣━━〔 ${icons[cat] || '•'} ${cat.toUpperCase()} 〕━━\n`;
    for (const n of names) t += `┃ ${p}${n}\n`;
    t += '┃\n';
  }
  t += `╰━━〔 🔥 ${cfg.botName} 〕━━╯`;
  await ctx.reply(t);
});

add({ names: ['alive'], cat: 'General' }, (ctx) =>
  ctx.reply(`✅ *${cfg.botName}* is alive!\nUptime: ${fmtTime(process.uptime())}\nMode: ${ctx.settings.mode}`));

add({ names: ['ping'], cat: 'General' }, async (ctx) => {
  const t = Date.now();
  const sent = await ctx.sock.sendMessage(ctx.from, { text: 'Pinging...' }, { quoted: ctx.m });
  await ctx.sock.sendMessage(ctx.from, { text: `🏓 Pong! ${Date.now() - t}ms`, edit: sent.key });
});

add({ names: ['owner'], cat: 'General' }, (ctx) => ctx.reply(`👑 *Owner:* ${cfg.ownerName}\n📞 wa.me/${cfg.ownerNumber}`));
add({ names: ['runtime', 'uptime'], cat: 'General' }, (ctx) => ctx.reply(`⏱️ Running for ${fmtTime(process.uptime())}`));
add({ names: ['id'], cat: 'General' }, (ctx) => ctx.reply(`Chat ID: ${ctx.from}\nYour ID: ${ctx.sender}`));

// ---------- AI (Gemini) ----------
add({ names: ['ai', 'gemini', 'ask'], cat: 'AI' }, async (ctx) => {
  let q = ctx.text;
  if (!q) return ctx.reply('Usage: .ai what is the capital of Kenya?');
  const last = aiCooldown.get(num(ctx.sender)) || 0;
  if (Date.now() - last < 4000) return ctx.reply('⏳ Wait a few seconds before asking again.');
  aiCooldown.set(num(ctx.sender), Date.now());
  try {
    const ans = await askGemini(q);
    await ctx.reply(ans.length > 3500 ? ans.slice(0, 3500) + '...' : ans);
  } catch (e) {
    const st = e.response?.status;
    console.error('Gemini error:', st, e.response?.data || e.message);
    await ctx.reply(`❌ AI error${st ? ' (' + st + ')' : ''}. ${st === 400 || st === 403 ? 'The Gemini API key may be invalid.' : st === 429 ? 'Too many requests, try later.' : 'Try again later.'}`);
  }
});

add({ names: ['translate', 'tr'], cat: 'AI' }, async (ctx) => {
  const [lang, ...rest] = ctx.args;
  const text = rest.join(' ');
  if (!lang || !text) return ctx.reply('Usage: .translate sw Hello how are you');
  try {
    const ans = await askGemini(`Translate the following text to ${lang}. Reply with the translation only.\n\n${text}`);
    await ctx.reply(ans);
  } catch { await ctx.reply('❌ Translation failed. Try again later.'); }
});

add({ names: ['summarize', 'sum'], cat: 'AI' }, async (ctx) => {
  let text = ctx.text;
  const q = ctx.contextInfo?.quotedMessage && normalizeMessageContent(ctx.contextInfo.quotedMessage);
  if (!text && q) text = q.conversation || q.extendedTextMessage?.text || '';
  if (!text) return ctx.reply('Usage: .summarize <text>  (or reply to a message)');
  try {
    await ctx.reply(await askGemini(`Summarize this briefly:\n\n${text}`));
  } catch { await ctx.reply('❌ Summary failed. Try again later.'); }
});

// ---------- TOOLS ----------
add({ names: ['calc'], cat: 'Tools' }, async (ctx) => {
  const e = ctx.text.replace(/x/gi, '*').replace(/\^/g, '**');
  if (!e || !/^[0-9+\-*/().%\s]+$/.test(e)) return ctx.reply('Usage: .calc 12*(3+4)');
  try {
    const r = Function(`"use strict"; return (${e})`)();
    if (typeof r !== 'number' || !isFinite(r)) throw new Error();
    await ctx.reply(`🧮 ${ctx.text} = *${r}*`);
  } catch { await ctx.reply('Invalid expression.'); }
});

add({ names: ['echo'], cat: 'Tools' }, (ctx) => (ctx.text ? ctx.reply(ctx.text) : ctx.reply('Usage: .echo hello')));

add({ names: ['weather'], cat: 'Tools' }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .weather Dar es Salaam');
  try {
    const { data } = await axios.get(`https://wttr.in/${encodeURIComponent(ctx.text)}?format=%l:+%c+%C,+%t+(feels+%f),+humidity+%h,+wind+%w`, { timeout: 15000 });
    await ctx.reply(`🌤️ ${String(data).trim()}`);
  } catch { await ctx.reply('Could not get weather. Check the city name.'); }
});

add({ names: ['currency', 'convert'], cat: 'Tools' }, async (ctx) => {
  const [amt, from, to] = ctx.args;
  if (!amt || !from || !to || isNaN(amt)) return ctx.reply('Usage: .currency 100 usd tzs');
  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`, { timeout: 15000 });
    const rate = data.rates?.[to.toUpperCase()];
    if (!rate) return ctx.reply('Unknown currency code.');
    await ctx.reply(`💱 ${amt} ${from.toUpperCase()} = *${(amt * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to.toUpperCase()}*`);
  } catch { await ctx.reply('Currency service unavailable. Try again later.'); }
});

add({ names: ['qr'], cat: 'Tools' }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .qr https://example.com');
  const buf = await QRCode.toBuffer(ctx.text, { width: 500, margin: 2 });
  await ctx.sock.sendMessage(ctx.from, { image: buf, caption: '✅ QR code ready' }, { quoted: ctx.m });
});

// ---------- MEDIA ----------
add({ names: ['sticker', 's'], cat: 'Media' }, async (ctx) => {
  const buf = await getMedia(ctx, ['imageMessage']);
  if (!buf) return ctx.reply('Send or reply to an *image* with .sticker');
  const st = new Sticker(buf, { pack: cfg.stickerPack, author: cfg.botName, type: 'full', quality: 60 });
  await ctx.sock.sendMessage(ctx.from, await st.toMessage(), { quoted: ctx.m });
});

add({ names: ['toimg'], cat: 'Media' }, async (ctx) => {
  const buf = await getMedia(ctx, ['stickerMessage']);
  if (!buf) return ctx.reply('Reply to a *sticker* with .toimg');
  try {
    const png = await sharp(buf).png().toBuffer();
    await ctx.sock.sendMessage(ctx.from, { image: png }, { quoted: ctx.m });
  } catch { await ctx.reply('Animated stickers are not supported.'); }
});

add({ names: ['tts'], cat: 'Media' }, async (ctx) => {
  let lang = 'en';
  let text = ctx.text;
  if (ctx.args[0] && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(ctx.args[0]) && ctx.args.length > 1) {
    lang = ctx.args[0];
    text = ctx.args.slice(1).join(' ');
  }
  if (!text) return ctx.reply('Usage: .tts sw Habari yako\n(language code optional, default en)');
  if (text.length > 200) return ctx.reply('Max 200 characters.');
  try {
    const url = tts.getAudioUrl(text, { lang, slow: false, host: 'https://translate.google.com' });
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    await ctx.sock.sendMessage(ctx.from, { audio: Buffer.from(data), mimetype: 'audio/mpeg', ptt: true }, { quoted: ctx.m });
  } catch { await ctx.reply('TTS failed. Try again.'); }
});

// ---------- PRODUCTIVITY ----------
add({ names: ['remind', 'reminder'], cat: 'Productivity' }, async (ctx) => {
  const [when, ...rest] = ctx.args;
  const text = rest.join(' ');
  const at = when && parseWhen(when);
  if (!at || !text) return ctx.reply('Usage:\n.remind 10m call mom\n.remind 18:30 pray\n.remind 6pm gym\n(Time zone: East Africa, UTC+3)');
  await col('reminders').insertOne({ jid: ctx.from, user: ctx.sender, at, text });
  const local = new Date(at + cfg.utcOffset * 36e5).toISOString().replace('T', ' ').slice(0, 16);
  await ctx.reply(`⏰ Reminder set for ${local} (EAT)\n📌 ${text}`);
});

const userItems = (ctx, type) => col('items').find({ user: num(ctx.sender), type }).sort({ ts: 1 }).toArray();

add({ names: ['note'], cat: 'Productivity' }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .note buy milk');
  await col('items').insertOne({ user: num(ctx.sender), type: 'note', text: ctx.text, ts: Date.now() });
  await ctx.reply('📝 Note saved.');
});

add({ names: ['notes'], cat: 'Productivity' }, async (ctx) => {
  const n = await userItems(ctx, 'note');
  if (!n.length) return ctx.reply('You have no notes.');
  await ctx.reply('📝 *Your notes*\n' + n.map((x, i) => `${i + 1}. ${x.text}`).join('\n') + '\n\nDelete: .delnote <number>');
});

add({ names: ['delnote'], cat: 'Productivity' }, async (ctx) => {
  const n = await userItems(ctx, 'note');
  const it = n[Number(ctx.args[0]) - 1];
  if (!it) return ctx.reply('Usage: .delnote 2');
  await col('items').deleteOne({ _id: it._id });
  await ctx.reply('🗑️ Note deleted.');
});

add({ names: ['todo'], cat: 'Productivity' }, async (ctx) => {
  const sub = (ctx.args[0] || 'list').toLowerCase();
  const rest = ctx.args.slice(1).join(' ');
  const items = await userItems(ctx, 'todo');
  if (sub === 'add') {
    if (!rest) return ctx.reply('Usage: .todo add finish homework');
    await col('items').insertOne({ user: num(ctx.sender), type: 'todo', text: rest, done: false, ts: Date.now() });
    return ctx.reply('✅ Added to your to-do list.');
  }
  if (sub === 'done' || sub === 'del') {
    const it = items[Number(rest) - 1];
    if (!it) return ctx.reply(`Usage: .todo ${sub} <number>`);
    if (sub === 'done') await col('items').updateOne({ _id: it._id }, { $set: { done: true } });
    else await col('items').deleteOne({ _id: it._id });
    return ctx.reply(sub === 'done' ? '☑️ Marked as done.' : '🗑️ Removed.');
  }
  if (!items.length) return ctx.reply('Your to-do list is empty.\nAdd: .todo add <task>');
  await ctx.reply('📋 *To-do*\n' + items.map((x, i) => `${i + 1}. ${x.done ? '☑️' : '⬜'} ${x.text}`).join('\n') + '\n\n.todo add | done <n> | del <n>');
});

// ---------- FUN ----------
const jokes = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my phone I needed space. Now it keeps showing "storage full".',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'I would tell you a UDP joke, but you might not get it.',
  'Why don’t eggs tell jokes? They’d crack each other up.',
  'My bank account and I have something in common: we both lose interest quickly.',
];
const quotes = [
  '“The best way to predict the future is to create it.” – Peter Drucker',
  '“It always seems impossible until it’s done.” – Nelson Mandela',
  '“Don’t watch the clock; do what it does. Keep going.” – Sam Levenson',
  '“Whether you think you can or you think you can’t, you’re right.” – Henry Ford',
  '“Small steps every day lead to big results.”',
];

add({ names: ['joke'], cat: 'Fun' }, (ctx) => ctx.reply('😂 ' + pick(jokes)));
add({ names: ['quote'], cat: 'Fun' }, (ctx) => ctx.reply('💬 ' + pick(quotes)));
add({ names: ['roll', 'dice'], cat: 'Fun' }, (ctx) => {
  const max = Math.min(Math.max(parseInt(ctx.args[0]) || 6, 2), 1000000);
  return ctx.reply(`🎲 You rolled *${1 + Math.floor(Math.random() * max)}* (1-${max})`);
});

add({ names: ['poll'], cat: 'Fun' }, async (ctx) => {
  const parts = ctx.text.split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return ctx.reply('Usage: .poll Best food? | Pizza | Rice | Chips');
  await ctx.sock.sendMessage(ctx.from, { poll: { name: parts[0], values: parts.slice(1, 13), selectableCount: 1 } });
});

add({ names: ['trivia'], cat: 'Fun' }, async (ctx) => {
  try {
    const { data } = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 15000 });
    const q = data.results[0];
    const opts = [...q.incorrect_answers, q.correct_answer].map(decode).sort(() => Math.random() - 0.5);
    const letters = ['A', 'B', 'C', 'D'];
    const ans = letters[opts.indexOf(decode(q.correct_answer))];
    await ctx.reply(`🧠 *Trivia* (${decode(q.category)})\n\n${decode(q.question)}\n\n` + opts.map((o, i) => `${letters[i]}. ${o}`).join('\n') + '\n\nAnswer in 20 seconds...');
    setTimeout(() => ctx.sock.sendMessage(ctx.from, { text: `✅ Answer: *${ans}. ${decode(q.correct_answer)}*` }).catch(() => {}), 20000);
  } catch { await ctx.reply('Trivia service unavailable.'); }
});

// ---------- GROUP ----------
add({ names: ['tagall'], cat: 'Group', group: true, admin: true }, async (ctx) => {
  const { meta } = await adminInfo(ctx);
  const ids = meta.participants.map((p) => p.id);
  await ctx.sock.sendMessage(ctx.from, { text: `📢 *${ctx.text || 'Attention everyone'}*\n\n` + ids.map((i) => `• @${num(i)}`).join('\n'), mentions: ids });
});

add({ names: ['hidetag'], cat: 'Group', group: true, admin: true }, async (ctx) => {
  const { meta } = await adminInfo(ctx);
  await ctx.sock.sendMessage(ctx.from, { text: ctx.text || '📢', mentions: meta.participants.map((p) => p.id) });
});

add({ names: ['admins'], cat: 'Group', group: true }, async (ctx) => {
  const { meta } = await adminInfo(ctx);
  const a = meta.participants.filter((p) => p.admin).map((p) => p.id);
  await ctx.sock.sendMessage(ctx.from, { text: '👮 *Admins*\n' + a.map((i) => `• @${num(i)}`).join('\n'), mentions: a }, { quoted: ctx.m });
});

add({ names: ['ginfo', 'groupinfo'], cat: 'Group', group: true }, async (ctx) => {
  const { meta } = await adminInfo(ctx);
  await ctx.reply(`👥 *${meta.subject}*\nMembers: ${meta.participants.length}\nAdmins: ${meta.participants.filter((p) => p.admin).length}\nCreated: ${new Date(meta.creation * 1000).toDateString()}\n\n${meta.desc || 'No description'}`);
});

add({ names: ['linkgc', 'link'], cat: 'Group', group: true, botAdmin: true }, async (ctx) => {
  const code = await ctx.sock.groupInviteCode(ctx.from);
  await ctx.reply(`🔗 https://chat.whatsapp.com/${code}`);
});

const memberAction = (name, action, done) =>
  add({ names: [name], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
    const t = getTargets(ctx);
    if (!t.length) return ctx.reply(`Usage: .${name} @user (or reply / number)`);
    const r = await ctx.sock.groupParticipantsUpdate(ctx.from, t, action);
    const failed = Array.isArray(r) ? r.filter((x) => x.status && x.status !== '200') : [];
    await ctx.reply(failed.length ? `Some actions failed (${failed.map((f) => f.status).join(', ')}).` : done);
  });
memberAction('kick', 'remove', '✅ Removed.');
memberAction('add', 'add', '✅ Added (or invite sent).');
memberAction('promote', 'promote', '✅ Promoted to admin.');
memberAction('demote', 'demote', '✅ Demoted.');

add({ names: ['mute'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  await ctx.sock.groupSettingUpdate(ctx.from, 'announcement');
  await ctx.reply('🔇 Group muted. Only admins can send messages.');
});
add({ names: ['unmute'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  await ctx.sock.groupSettingUpdate(ctx.from, 'not_announcement');
  await ctx.reply('🔊 Group unmuted.');
});
add({ names: ['setname'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .setname New Name');
  await ctx.sock.groupUpdateSubject(ctx.from, ctx.text);
  await ctx.reply('✅ Group name changed.');
});
add({ names: ['setdesc'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .setdesc New description');
  await ctx.sock.groupUpdateDescription(ctx.from, ctx.text);
  await ctx.reply('✅ Group description updated.');
});

// ---------- SECURITY ----------
add({ names: ['antilink'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const v = (ctx.args[0] || '').toLowerCase();
  if (!['off', 'warn', 'delete'].includes(v)) return ctx.reply('Usage: .antilink off|warn|delete');
  const g = await getGroup(ctx.from);
  g.antilink = v;
  await saveGroup(g);
  await ctx.reply(`🔗 Antilink: *${v}*\n(Bot must be admin.)`);
});

for (const [name, label] of [['antisticker', 'Anti-sticker'], ['antispam', 'Anti-spam'], ['antibot', 'Anti-bot']]) {
  add({ names: [name], cat: 'Security', group: true, admin: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    const g = await getGroup(ctx.from);
    g[name] = v;
    await saveGroup(g);
    await ctx.reply(`🛡️ ${label}: *${v ? 'ON' : 'OFF'}*\n(Bot must be admin.)`);
  });
}

add({ names: ['warn'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const t = getTargets(ctx);
  if (!t.length) return ctx.reply('Usage: .warn @user reason');
  const g = await getGroup(ctx.from);
  const reason = ctx.args.filter((a) => !a.startsWith('@') && !/^\d{8,}$/.test(a)).join(' ') || 'Manual warning';
  await addWarn(ctx, g, t[0], reason);
});

add({ names: ['warnings'], cat: 'Security', group: true }, async (ctx) => {
  const t = getTargets(ctx)[0] || ctx.sender;
  const g = await getGroup(ctx.from);
  await ctx.sock.sendMessage(ctx.from, { text: `⚠️ @${num(t)} has ${g.warns[num(t)] || 0}/3 warnings`, mentions: [t] }, { quoted: ctx.m });
});

add({ names: ['unwarn'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const t = getTargets(ctx)[0];
  if (!t) return ctx.reply('Usage: .unwarn @user');
  const g = await getGroup(ctx.from);
  g.warns[num(t)] = Math.max((g.warns[num(t)] || 0) - 1, 0);
  await saveGroup(g);
  await ctx.reply(`✅ Warning removed. Now ${g.warns[num(t)]}/3`);
});

// ---------- SETTINGS ----------
for (const [name, label] of [['welcome', 'Welcome'], ['goodbye', 'Goodbye']]) {
  add({ names: [name], cat: 'Settings', group: true, admin: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    const g = await getGroup(ctx.from);
    g[name] = v;
    await saveGroup(g);
    await ctx.reply(`${label} messages: *${v ? 'ON' : 'OFF'}*`);
  });
  add({ names: ['set' + name], cat: 'Settings', group: true, admin: true }, async (ctx) => {
    if (!ctx.text) return ctx.reply(`Usage: .set${name} Hello @user, welcome to {group}!\nPlaceholders: @user {group} {desc}`);
    const g = await getGroup(ctx.from);
    g[name + 'Msg'] = ctx.text;
    await saveGroup(g);
    await ctx.reply(`✅ ${label} message updated.`);
  });
}

add({ names: ['mode'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = (ctx.args[0] || '').toLowerCase();
  if (!['public', 'private'].includes(v)) return ctx.reply('Usage: .mode public|private');
  ctx.settings.mode = v;
  await saveSettings();
  await ctx.reply(`🌐 Mode: *${v}*`);
});

add({ names: ['prefix'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = ctx.args[0];
  if (!v || v.length > 3) return ctx.reply('Usage: .prefix !   (max 3 characters)');
  ctx.settings.prefix = v;
  await saveSettings();
  await ctx.reply(`⚡ Prefix changed to *${v}*`);
});

const userList = (name, field, addIt, done) =>
  add({ names: [name], cat: 'Settings', owner: true }, async (ctx) => {
    const t = getTargets(ctx);
    if (!t.length) return ctx.reply(`Usage: .${name} @user (or reply / number)`);
    const set = new Set(ctx.settings[field]);
    for (const j of t) addIt ? set.add(num(j)) : set.delete(num(j));
    ctx.settings[field] = [...set];
    await saveSettings();
    await ctx.reply(done);
  });
userList('sudo', 'sudo', true, '✅ Added to sudo users.');
userList('delsudo', 'sudo', false, '✅ Removed from sudo users.');
userList('ban', 'banned', true, '🚫 User banned from using the bot.');
userList('unban', 'banned', false, '✅ User unbanned.');

add({ names: ['listsudo'], cat: 'Settings', owner: true }, (ctx) =>
  ctx.reply(ctx.settings.sudo.length ? '👑 *Sudo users*\n' + ctx.settings.sudo.map((n) => `• ${n}`).join('\n') : 'No sudo users.'));

for (const [name, label] of [['anticall', 'Anti-call'], ['antidelete', 'Anti-delete']]) {
  add({ names: [name], cat: 'Settings', owner: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    ctx.settings[name] = v;
    await saveSettings();
    await ctx.reply(`${label}: *${v ? 'ON' : 'OFF'}*`);
  });
}

add({ names: ['settings'], cat: 'Settings', owner: true }, (ctx) => {
  const s = ctx.settings;
  return ctx.reply(`⚙️ *Settings*\nMode: ${s.mode}\nPrefix: ${s.prefix}\nAnti-call: ${s.anticall ? 'ON' : 'OFF'}\nAnti-delete: ${s.antidelete ? 'ON' : 'OFF'}\nSudo users: ${s.sudo.length}\nBanned: ${s.banned.length}`);
});

add({ names: ['broadcast', 'bc'], cat: 'Settings', owner: true }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .broadcast your message');
  const groups = Object.keys(await ctx.sock.groupFetchAllParticipating());
  await ctx.reply(`📡 Sending to ${groups.length} groups...`);
  for (const id of groups) {
    try { await ctx.sock.sendMessage(id, { text: `📢 *Broadcast*\n\n${ctx.text}` }); } catch {}
    await sleep(2500); // slow on purpose to reduce ban risk
  }
  await ctx.reply('✅ Broadcast finished.');
});

// ---------- dispatcher ----------
const EMOJI = {
  kick: '🦶', add: '➕', promote: '⬆️', demote: '⬇️', mute: '🔇', unmute: '🔊', ban: '🚫', unban: '✅',
  warn: '⚠️', unwarn: '🕊️', warnings: '📋', tagall: '📢', hidetag: '👻', admins: '👮', ginfo: 'ℹ️', linkgc: '🔗',
  setname: '✏️', setdesc: '📝', antilink: '🔗', antisticker: '🚷', antispam: '🛑', antibot: '🤖',
  welcome: '👋', goodbye: '👋', setwelcome: '✏️', setgoodbye: '✏️', mode: '🌐', prefix: '⚡',
  sudo: '👑', delsudo: '👑', listsudo: '👑', anticall: '📵', antidelete: '🗑️', broadcast: '📡', settings: '⚙️',
  menu: '📜', alive: '💚', ping: '🏓', owner: '👑', runtime: '⏱️', id: '🆔',
  ai: '🧠', translate: '🌍', summarize: '📄', calc: '🧮', echo: '🔁', weather: '🌤️', currency: '💱', qr: '🔳',
  sticker: '🎨', toimg: '🖼️', tts: '🗣️', remind: '⏰', note: '📝', notes: '📒', delnote: '🗑️', todo: '📋',
  joke: '😂', quote: '💬', roll: '🎲', poll: '📊', trivia: '🧠',
};
const FAIL_RE = /^(Usage|Invalid|Unknown|Could not|Send or reply|Reply to|Max |Animated|Wait|⏳|❌|⛔|⚠️ Make|👥 This)/;

async function runCommand(ctx) {
  const react = (e) => ctx.sock.sendMessage(ctx.from, { react: { text: e, key: ctx.m.key } }).catch(() => {});
  const c = map.get(ctx.cmd);
  if (!c) {
    await react('❓');
    if (!ctx.isGroup) await ctx.reply(`❓ Unknown command *${ctx.prefix}${ctx.cmd}*\nType ${ctx.prefix}menu to see all commands.`);
    return;
  }
  // react immediately with the command emoji
  await react(EMOJI[c.names[0]] || '✅');
  // any reply that is an error/usage message switches the reaction to ❌
  const origReply = ctx.reply;
  ctx.reply = (t, extra) => {
    if (typeof t === 'string' && FAIL_RE.test(t)) react('❌');
    return origReply(t, extra);
  };

  if (c.owner && !ctx.isOwner) { await react('⛔'); return origReply('⛔ Owner only command. You are not allowed to use it.'); }
  if (c.group && !ctx.isGroup) { await react('❌'); return origReply('👥 This command works in groups only.'); }
  if (c.admin || c.botAdmin) {
    let info;
    try { info = await adminInfo(ctx); } catch (e) { await react('❌'); return origReply('❌ Could not read group info: ' + (e.message || 'unknown error')); }
    if (c.admin && !info.isAdmin && !ctx.isOwner) { await react('⛔'); return origReply('⛔ Only group admins can use this command.'); }
    if (c.botAdmin && !info.isBotAdmin) { await react('⚠️'); return origReply('⚠️ Make me an admin in this group first, then try again.'); }
  }
  try {
    await c.run(ctx);
  } catch (e) {
    console.error(`Command ${ctx.cmd} failed:`, e);
    await react('❌');
    await origReply(`❌ *${ctx.prefix}${ctx.cmd}* failed: ${e.message || 'unknown error'}\nCheck the format or my permissions and try again.`).catch(() => {});
  }
}

// ===================== BOT CORE =====================
const msgStore = new Map(); // antidelete cache (last 500 messages)
const spam = new Map();
const LINK_RE = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;
let reminderTimer;
let starting = false;

// keep-alive web server for Render
const app = express();
app.get('/', (_, res) => res.send(`${cfg.botName} is running`));
app.listen(process.env.PORT || 3000, () => console.log('Web server started'));

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

async function start() {
  if (starting) return;
  starting = true;
  try {
    if (!db) await dbConnect();
    const settings = await getSettings();
    const { state, saveCreds } = await useMongoAuthState();
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

    // ----- pairing code -----
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

    // ----- connection -----
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
          await clearAuth();
        }
        starting = false;
        setTimeout(start, 3000);
      }
    });

    // ----- reminders -----
    clearInterval(reminderTimer);
    reminderTimer = setInterval(async () => {
      try {
        const due = await col('reminders').find({ at: { $lte: Date.now() } }).toArray();
        for (const r of due) {
          await col('reminders').deleteOne({ _id: r._id });
          await sock.sendMessage(r.jid, { text: `⏰ *Reminder*\n${r.text}`, mentions: r.user ? [r.user] : [] });
        }
      } catch {}
    }, 20000);

    // ----- anticall -----
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

    // ----- welcome / goodbye -----
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      try {
        const g = await getGroup(id);
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

    // ----- messages -----
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const m of messages) {
        // messages you send from your own phone arrive as 'append', so accept them if they are fresh
        if (type !== 'notify') {
          const t = m.messageTimestamp;
          const ts = t && typeof t === 'object' ? (t.toNumber ? t.toNumber() : Number(t.low)) : Number(t);
          if (!ts || Date.now() / 1000 - ts > 30) continue;
        }
        try { await handle(sock, m); } catch (e) { console.error('handle error', e); }
      }
    });
  } catch (e) {
    console.error('Start error:', e);
    starting = false;
    setTimeout(start, 5000);
  }
}

async function handle(sock, m) {
  if (!m.message || m.key.remoteJid === 'status@broadcast') return;
  const settings = await getSettings();
  const content = normalizeMessageContent(m.message);
  if (!content) return;

  // antidelete
  const pm = content.protocolMessage;
  if (pm) {
    if (pm.type === 0 && settings.antidelete) {
      const orig = msgStore.get(pm.key?.id);
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

  const prefix = settings.prefix;
  if (!text.startsWith(prefix)) return;
  console.log('Command received:', text.slice(0, 60), '| from:', num(sender), '| group:', isGroup);
  if (settings.mode === 'private' && !isOwner) return;

  const body = text.slice(prefix.length).trim();
  if (!body) return;
  const [cmd, ...args] = body.split(/\s+/);
  ctx.cmd = cmd.toLowerCase();
  ctx.args = args;
  ctx.text = body.slice(cmd.length).trim();
  await runCommand(ctx);
}

// group protections; returns true if message was removed
async function protect(ctx, mtype, text) {
  const { sock, m, from, sender, isOwner } = ctx;
  if (isOwner) return false;
  const g = await getGroup(from);
  if (g.antilink === 'off' && !g.antisticker && !g.antispam && !g.antibot) return false;

  const info = await adminInfo(ctx);
  if (!info.isBotAdmin || info.isAdmin) return false;
  const del = () => sock.sendMessage(from, { delete: m.key }).catch(() => {});

  if (g.antilink !== 'off' && LINK_RE.test(text)) {
    await del();
    if (g.antilink === 'warn') await addWarn(ctx, g, sender, 'Sending links');
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
      await addWarn(ctx, g, sender, 'Spamming');
      return true;
    }
  }
  return false;
}

start();
