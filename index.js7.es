/* =====================================================
   LUQMAN X MD  -  WhatsApp bot (Baileys) - single file
   ===================================================== */
const express = require('express');
const axios = require('axios');
const QRCode = require('qrcode');
const sharp = require('sharp');
const tts = require('google-tts-api');
const pino = require('pino');
const crypto = require('crypto');
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
  generateWAMessageContent,
  generateMessageID,
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

// ---------- Gemini AI engine (many models, silent automatic fallback) ----------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// used only if Google's model list cannot be fetched
const GEMINI_STATIC = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3-pro-preview'];
const GEMINI_LAST_RESORT = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
const geminiHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey };
let geminiCache = { at: 0, list: [] };
const geminiBad = new Map();
const aiCooldown = new Map();
const aiHistory = new Map();

// Builds the model chain: Gemini 3 Flash first, then newer Flash, Flash-Lite, Pro; older 2.5 only as last resort.
async function geminiModels() {
  if (geminiCache.list.length && Date.now() - geminiCache.at < 6 * 36e5) return geminiCache.list;
  let list = [];
  try {
    const { data } = await axios.get(`${GEMINI_BASE}/models?pageSize=200`, { headers: geminiHeaders, timeout: 15000 });
    const found = [];
    for (const m of data.models || []) {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      const name = String(m.name || '').replace('models/', '');
      const mm = name.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(?:-(.+))?$/);
      if (!mm) continue;
      if (/(image|tts|live|audio|embed|native|robot|computer|thinking-exp|customtools)/i.test(name)) continue;
      const ver = parseFloat(mm[1]);
      if (ver < 3) continue;
      found.push({ name, ver, fam: { flash: 0, 'flash-lite': 1, pro: 2 }[mm[2]], pre: /preview|exp/.test(mm[3] || '') ? 1 : 0 });
    }
    found.sort((a, b) => a.fam - b.fam || a.ver - b.ver || a.pre - b.pre);
    list = found.map((f) => f.name);
  } catch (e) {
    console.error('Gemini model list failed:', e.response?.status || e.message);
  }
  if (!list.length) list = [...GEMINI_STATIC];
  for (const x of GEMINI_LAST_RESORT) if (!list.includes(x)) list.push(x);
  geminiCache = { at: Date.now(), list };
  console.log('AI model chain:', list.join(' > '));
  return list;
}

// Tries each model in turn. The WhatsApp user never sees which model answered.
async function geminiGenerate({ contents, system }) {
  const all = await geminiModels();
  let models = all.filter((m) => (geminiBad.get(m) || 0) <= Date.now());
  if (!models.length) { geminiBad.clear(); models = all; }
  let lastErr;
  for (const model of models) {
    try {
      const body = { contents };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const { data } = await axios.post(`${GEMINI_BASE}/models/${model}:generateContent`, body, { headers: geminiHeaders, timeout: 45000 });
      const text = (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (text) { console.log('AI answered with', model); return text; }
      lastErr = new Error('empty answer');
    } catch (e) {
      lastErr = e;
      const st = e.response?.status;
      const msg = e.response?.data?.error?.message || '';
      if ((st === 400 || st === 401 || st === 403) && /api key|api_key|key not valid|permission denied|has not been used|disabled/i.test(msg)) {
        e.keyInvalid = true;
        throw e; // same key is used for every model, so stop early
      }
      geminiBad.set(model, Date.now() + (st === 404 ? 6 * 36e5 : st === 429 ? 2 * 6e4 : 6e4));
      console.error('AI model failed:', model, st || e.message);
    }
  }
  throw lastErr || new Error('No AI model available');
}

const PERSONAS = {
  default: '',
  teacher: 'You are a patient teacher. Explain step by step with simple examples.',
  chef: 'You are a friendly chef. Give practical recipes and cooking tips, including East African options when relevant.',
  comedian: 'You are a witty comedian. Stay helpful but keep answers funny and light-hearted.',
  coder: 'You are an expert programmer. Give correct, concise code with short explanations.',
  coach: 'You are a motivating life and fitness coach. Be encouraging and practical.',
  poet: 'You are a creative poet. Answer in short, beautiful verse when it fits.',
};
function aiSystem(persona) {
  return (
    `You are ${cfg.botName}, a friendly and helpful WhatsApp assistant made by ${cfg.ownerName}. ` +
    'Reply in the same language the user writes in (Swahili, English, etc.). Keep answers clear and short enough for a phone screen, using short paragraphs. ' +
    'For emphasis use WhatsApp style *bold* with single asterisks. Do not use markdown headings or tables.' +
    (PERSONAS[persona] ? ' ' + PERSONAS[persona] : '')
  );
}
function cleanAi(t) {
  t = t.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^#{1,6}\s*(.+)$/gm, '*$1*');
  return t.length > 3800 ? t.slice(0, 3800) + '...' : t;
}
function aiErrorText(e) {
  console.error('AI error:', e.response?.status || '', e.response?.data?.error?.message || e.message);
  if (e.keyInvalid) return '❌ AI is not set up correctly (API key problem). Please tell the owner.';
  if (e.response?.status === 429) return '⏳ AI is very busy right now. Please try again in a minute.';
  return '❌ AI could not answer right now. Please try again shortly.';
}
function quotedText(ctx) {
  const q = ctx.contextInfo?.quotedMessage && normalizeMessageContent(ctx.contextInfo.quotedMessage);
  return q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || q?.videoMessage?.caption || '';
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
const MENU_META = {
  General: ['🏠', 'General commands'],
  AI: ['🧠', 'AI assistant: chat, vision, translate'],
  Tools: ['🔧', 'Handy tools and lookups'],
  Media: ['🎨', 'Stickers, voice and images'],
  Games: ['🎮', 'Games and fun picks'],
  Level: ['🏆', 'XP, levels and daily rewards'],
  Productivity: ['📝', 'Reminders, notes and to-do'],
  Fun: ['🎲', 'Jokes, polls and trivia'],
  Group: ['👥', 'Group management'],
  Security: ['🛡️', 'Protection and warnings'],
  Settings: ['⚙️', 'Owner and group settings'],
};
const MENU_ORDER = Object.keys(MENU_META);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const footer = () => `✨ _Powered by ${cfg.botName}_ ✨`;

function localNow() {
  const d = new Date(Date.now() + cfg.utcOffset * 36e5);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    hour: d.getUTCHours(),
    date: `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

let ppCache = { at: 0, url: null };
async function menuImageUrl(ctx) {
  if (ctx.settings.menuImage) return ctx.settings.menuImage;
  if (Date.now() - ppCache.at < 36e5) return ppCache.url;
  let url = null;
  try { url = await ctx.sock.profilePictureUrl(jidNormalizedUser(ctx.sock.user.id), 'image'); } catch {}
  ppCache = { at: Date.now(), url };
  return url;
}

function mainMenu(ctx, cats) {
  const p = ctx.prefix;
  const n = localNow();
  const greet = n.hour < 12 ? 'Habari za asubuhi' : n.hour < 16 ? 'Habari za mchana' : n.hour < 19 ? 'Habari za jioni' : 'Habari za usiku';
  let t = `╔══════════════════╗\n   🔥 *${cfg.botName}* 🔥\n╚══════════════════╝\n\n`;
  t += `👋 ${greet}, *${ctx.m.pushName || 'rafiki'}*!\n\n`;
  t += `┌─〔 📊 *BOT INFO* 〕\n│ 👑 Owner : ${cfg.ownerName}\n│ ⚡ Prefix : ${p}\n│ 🌐 Mode : ${ctx.settings.mode}\n│ ⏱️ Uptime : ${fmtTime(process.uptime())}\n│ 📅 ${n.date}\n│ 🕐 ${n.time} EAT\n│ 🧩 Commands : ${list.length}\n└──────────────\n\n`;
  t += `┌─〔 📂 *CATEGORIES* 〕\n`;
  for (const c of MENU_ORDER) if (cats[c]) t += `│ ${MENU_META[c][0]} ${p}menu ${c.toLowerCase()} · ${cats[c].length}\n`;
  t += `└──────────────\n\n📜 ${p}menu all → every command\n\n${footer()}`;
  return t;
}

function catMenu(ctx, cats, name) {
  const p = ctx.prefix;
  const [icon, desc] = MENU_META[name];
  let t = `╭──〔 ${icon} *${name.toUpperCase()}* 〕──╮\n│ _${desc}_\n│\n`;
  for (const c of cats[name]) t += `│ ➤ ${p}${c.names[0]}\n`;
  t += `╰──────────────╯\n\n${footer()}`;
  return t;
}

function allMenu(ctx, cats) {
  const p = ctx.prefix;
  let t = `╔══════════════════╗\n   🔥 *${cfg.botName}* 🔥\n╚══════════════════╝\n\n`;
  for (const name of MENU_ORDER) {
    if (!cats[name]) continue;
    t += `╭──〔 ${MENU_META[name][0]} *${name.toUpperCase()}* 〕\n`;
    for (const c of cats[name]) t += `│ ➤ ${p}${c.names[0]}\n`;
    t += `╰──────────────\n\n`;
  }
  return t + footer();
}

add({ names: ['menu', 'help'], cat: 'General' }, async (ctx) => {
  const cats = {};
  for (const c of list) (cats[c.cat] ||= []).push(c);
  const arg = (ctx.args[0] || '').toLowerCase();
  if (arg === 'all') return ctx.reply(allMenu(ctx, cats));
  const found = MENU_ORDER.find((c) => c.toLowerCase() === arg && cats[c]);
  if (found) return ctx.reply(catMenu(ctx, cats, found));
  const text = mainMenu(ctx, cats);
  const url = text.length <= 1000 ? await menuImageUrl(ctx) : null;
  if (url) {
    try { return await ctx.sock.sendMessage(ctx.from, { image: { url }, caption: text }, { quoted: ctx.m }); } catch {}
  }
  await ctx.reply(text);
});

add({ names: ['setmenuimg'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = ctx.args[0];
  if (!v || (v !== 'off' && !/^https?:\/\//i.test(v))) return ctx.reply('Usage: .setmenuimg https://link-to-image.jpg\n(or .setmenuimg off to use the bot profile picture)');
  ctx.settings.menuImage = v === 'off' ? '' : v;
  await saveSettings();
  await ctx.reply(v === 'off' ? '🖼️ Menu image reset.' : '🖼️ Menu image updated.');
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

// ---------- AI (Gemini, many models) ----------
add({ names: ['ai', 'ask', 'gemini'], cat: 'AI' }, async (ctx) => {
  const q = ctx.text;
  if (!q) return ctx.reply('Usage: .ai what is the capital of Kenya?\nI remember our chat. Use .aiclear to start fresh.');
  const k = num(ctx.sender);
  if (Date.now() - (aiCooldown.get(k) || 0) < 3000) return ctx.reply('⏳ Wait a few seconds before asking again.');
  aiCooldown.set(k, Date.now());
  const key = ctx.from + '|' + k;
  let h = aiHistory.get(key);
  if (!h || Date.now() - h.at > 30 * 60 * 1000) h = { at: 0, turns: [] };
  const u = await col('users').findOne({ _id: k });
  const contents = [...h.turns, { role: 'user', parts: [{ text: q }] }];
  try {
    const ans = await geminiGenerate({ contents, system: aiSystem(u?.persona) });
    h.turns = [...contents, { role: 'model', parts: [{ text: ans }] }].slice(-16);
    h.at = Date.now();
    aiHistory.set(key, h);
    await ctx.reply(cleanAi(ans));
  } catch (e) {
    await ctx.reply(aiErrorText(e));
  }
});

add({ names: ['vision', 'see'], cat: 'AI' }, async (ctx) => {
  const raw = await getMedia(ctx, ['imageMessage']);
  if (!raw) return ctx.reply('Send or reply to an *image* with .vision <question>\nExample: .vision what is in this picture?');
  const k = num(ctx.sender);
  if (Date.now() - (aiCooldown.get(k) || 0) < 3000) return ctx.reply('⏳ Wait a few seconds before asking again.');
  aiCooldown.set(k, Date.now());
  let jpeg;
  try {
    jpeg = await sharp(raw).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch { return ctx.reply('❌ Could not read that image.'); }
  const q = ctx.text || 'Describe this image in detail and point out anything important.';
  try {
    const ans = await geminiGenerate({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: jpeg.toString('base64') } }, { text: q }] }],
      system: aiSystem(),
    });
    await ctx.reply(cleanAi(ans));
  } catch (e) {
    await ctx.reply(aiErrorText(e));
  }
});

add({ names: ['persona'], cat: 'AI' }, async (ctx) => {
  const v = (ctx.args[0] || '').toLowerCase();
  if (!v || !(v in PERSONAS)) {
    return ctx.reply('🎭 *AI personas*\n' + Object.keys(PERSONAS).map((n) => `• ${n}`).join('\n') + `\n\nUse: ${ctx.prefix}persona teacher`);
  }
  await col('users').updateOne({ _id: num(ctx.sender) }, { $set: { persona: v === 'default' ? '' : v, jid: ctx.sender } }, { upsert: true });
  aiHistory.delete(ctx.from + '|' + num(ctx.sender));
  await ctx.reply(`🎭 Persona set to *${v}*. Chat memory cleared.`);
});

add({ names: ['aiclear', 'clearai'], cat: 'AI' }, async (ctx) => {
  aiHistory.delete(ctx.from + '|' + num(ctx.sender));
  await ctx.reply('🧹 AI memory cleared. Let’s start fresh!');
});

add({ names: ['translate', 'tr'], cat: 'AI' }, async (ctx) => {
  const [lang, ...rest] = ctx.args;
  const text = rest.join(' ') || quotedText(ctx);
  if (!lang || !text) return ctx.reply('Usage: .translate sw Hello how are you\n(or reply to a message: .translate en)');
  try {
    await ctx.reply(cleanAi(await geminiGenerate({ contents: [{ role: 'user', parts: [{ text: `Translate the following text to ${lang}. Reply with the translation only.\n\n${text}` }] }] })));
  } catch (e) { await ctx.reply(aiErrorText(e)); }
});

add({ names: ['summarize', 'sum'], cat: 'AI' }, async (ctx) => {
  const text = ctx.text || quotedText(ctx);
  if (!text) return ctx.reply('Usage: .summarize <text>  (or reply to a message)');
  try {
    await ctx.reply(cleanAi(await geminiGenerate({ contents: [{ role: 'user', parts: [{ text: `Summarize this briefly, in the same language as the text:\n\n${text}` }] }] })));
  } catch (e) { await ctx.reply(aiErrorText(e)); }
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

// ---------- NEW: media / group / owner extras ----------
async function getMediaAny(ctx) {
  const kinds = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'];
  let msg = null;
  if (kinds.some((k) => ctx.content[k])) msg = ctx.m;
  else if (ctx.contextInfo?.stanzaId) {
    msg = msgStore.get(ctx.contextInfo.stanzaId) || statusStore.get(ctx.contextInfo.stanzaId) || null;
    if (!msg && ctx.contextInfo.quotedMessage) {
      msg = {
        key: { remoteJid: ctx.from, id: ctx.contextInfo.stanzaId, participant: ctx.contextInfo.participant, fromMe: false },
        message: ctx.contextInfo.quotedMessage,
      };
    }
  }
  if (!msg?.message) return null;
  const c = normalizeMessageContent(msg.message);
  const kind = kinds.find((k) => c?.[k]);
  if (!kind) return null;
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: ctx.sock.updateMediaMessage });
  return { buffer, kind, content: c[kind] };
}

add({ names: ['vv', 'reveal', 'save'], cat: 'Media', owner: true }, async (ctx) => {
  const r = await getMediaAny(ctx);
  if (!r) return ctx.reply('Reply to a view-once photo/video/voice note (or a status) with .vv\n(Works only if I received it while online.)');
  const q = { quoted: ctx.m };
  const cap = r.content.caption || '';
  if (r.kind === 'imageMessage') await ctx.sock.sendMessage(ctx.from, { image: r.buffer, caption: cap }, q);
  else if (r.kind === 'videoMessage') await ctx.sock.sendMessage(ctx.from, { video: r.buffer, caption: cap }, q);
  else if (r.kind === 'audioMessage') await ctx.sock.sendMessage(ctx.from, { audio: r.buffer, mimetype: r.content.mimetype || 'audio/mpeg', ptt: !!r.content.ptt }, q);
  else await ctx.sock.sendMessage(ctx.from, { sticker: r.buffer }, q);
});

add({ names: ['getpp', 'pp'], cat: 'Media' }, async (ctx) => {
  const jid = ctx.args[0] === 'group' && ctx.isGroup ? ctx.from : getTargets(ctx)[0] || (ctx.isGroup ? ctx.sender : ctx.from);
  try {
    const url = await ctx.sock.profilePictureUrl(jid, 'image');
    const isGroupJid = jid.endsWith('@g.us');
    await ctx.sock.sendMessage(
      ctx.from,
      { image: { url }, caption: `🖼️ Profile picture of ${isGroupJid ? 'this group' : '@' + num(jid)}`, mentions: isGroupJid ? [] : [jid] },
      { quoted: ctx.m }
    );
  } catch {
    await ctx.reply('Could not get the profile picture. The person has no photo or has hidden it.');
  }
});

add({ names: ['setpp'], cat: 'Media', owner: true }, async (ctx) => {
  const buf = await getMedia(ctx, ['imageMessage']);
  if (!buf) return ctx.reply('Send or reply to an *image* with .setpp');
  await ctx.sock.updateProfilePicture(jidNormalizedUser(ctx.sock.user.id), buf);
  await ctx.reply('✅ Profile picture updated.');
});

add({ names: ['statusview'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = onoff((ctx.args[0] || '').toLowerCase());
  if (v === null) return ctx.reply('Usage: .statusview on|off');
  ctx.settings.statusview = v;
  await saveSettings();
  await ctx.reply(`👀 Auto status view: *${v ? 'ON' : 'OFF'}*\n(Statuses will be marked as seen automatically.)`);
});

add({ names: ['leave', 'exit'], cat: 'Group', group: true, owner: true }, async (ctx) => {
  await ctx.reply('👋 Goodbye everyone!');
  await sleep(1000);
  await ctx.sock.groupLeave(ctx.from);
});

add({ names: ['del', 'delete'], cat: 'Group' }, async (ctx) => {
  const ci = ctx.contextInfo;
  if (!ci?.stanzaId) return ctx.reply('Reply to the message you want to delete with .del');
  const me = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map((j) => num(j));
  const target = ci.participant || ctx.from;
  const isMine = me.includes(num(target));
  if (ctx.isGroup) {
    const info = await adminInfo(ctx);
    if (!info.isAdmin && !ctx.isOwner) return ctx.reply('⛔ Only group admins can delete messages.');
    if (!isMine && !info.isBotAdmin) return ctx.reply("⚠️ Make me an admin first to delete other people's messages.");
  } else if (!ctx.isOwner) {
    return ctx.reply('⛔ Owner only in private chats.');
  } else if (!isMine) {
    return ctx.reply('❌ In private chats I can only delete my own messages.');
  }
  await ctx.sock.sendMessage(ctx.from, {
    delete: { remoteJid: ctx.from, fromMe: isMine, id: ci.stanzaId, participant: ctx.isGroup && !isMine ? target : undefined },
  });
  await ctx.sock.sendMessage(ctx.from, { delete: ctx.m.key }).catch(() => {});
});

add({ names: ['gstatus', 'groupstatus'], cat: 'Group', group: true, admin: true }, async (ctx) => {
  if (!('groupStatusMessageV2' in waProto.Message.prototype)) {
    return ctx.reply('❌ Group status is not supported by the current WhatsApp library version.');
  }
  const r = await getMediaAny(ctx);
  const caption = ctx.text;
  let payload;
  if (r?.kind === 'imageMessage') payload = { image: r.buffer, caption };
  else if (r?.kind === 'videoMessage') payload = { video: r.buffer, caption };
  else if (r?.kind === 'audioMessage') payload = { audio: r.buffer, mimetype: r.content.mimetype || 'audio/mpeg' };
  else if (caption) payload = { text: caption };
  else return ctx.reply('Usage: reply to an image/video with .gstatus caption\nor: .gstatus your text');
  const inner = await generateWAMessageContent(payload, { upload: ctx.sock.waUploadToServer });
  await ctx.sock.relayMessage(ctx.from, { groupStatusMessageV2: { message: inner } }, { messageId: generateMessageID() });
  await ctx.reply('✅ Group status posted.');
});

add({ names: ['resetlink', 'revoke'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  await ctx.sock.groupRevokeInvite(ctx.from);
  const code = await ctx.sock.groupInviteCode(ctx.from);
  await ctx.reply(`🔄 Invite link reset.\nNew link: https://chat.whatsapp.com/${code}`);
});

for (const [name, action, done] of [['block', 'block', '⛔ User blocked.'], ['unblock', 'unblock', '✅ User unblocked.']]) {
  add({ names: [name], cat: 'Settings', owner: true }, async (ctx) => {
    const t = getTargets(ctx)[0] || (!ctx.isGroup ? ctx.from : null);
    if (!t) return ctx.reply(`Usage: .${name} @user (or reply / number)`);
    if (num(t) === cfg.ownerNumber) return ctx.reply('❌ You cannot do that to the owner number.');
    await ctx.sock.updateBlockStatus(t, action);
    await ctx.reply(done);
  });
}

add({ names: ['restart'], cat: 'Settings', owner: true }, async (ctx) => {
  await ctx.reply('♻️ Restarting... back in about 30 seconds.');
  setTimeout(() => process.exit(0), 1500);
});

// ---------- GAMES ----------
const RPS = { rock: '🪨', paper: '📄', scissors: '✂️' };
add({ names: ['rps'], cat: 'Games' }, (ctx) => {
  const alias = { r: 'rock', p: 'paper', s: 'scissors' };
  let me = (ctx.args[0] || '').toLowerCase();
  me = alias[me] || me;
  if (!RPS[me]) return ctx.reply('Usage: .rps rock|paper|scissors');
  const bot = pick(Object.keys(RPS));
  const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const res = me === bot ? '🤝 It is a draw!' : beats[me] === bot ? '🎉 You win!' : '😎 I win!';
  return ctx.reply(`You: ${RPS[me]}  vs  Me: ${RPS[bot]}\n${res}`);
});

add({ names: ['flip', 'coin'], cat: 'Games' }, (ctx) => ctx.reply(`🪙 ${pick(['Heads', 'Tails'])}!`));

const EIGHT = ['Yes, definitely.', 'It is certain.', 'Most likely.', 'Ask again later.', 'Cannot predict now.', 'Do not count on it.', 'My sources say no.', 'Very doubtful.', 'Signs point to yes.', 'Without a doubt.'];
add({ names: ['8ball'], cat: 'Games' }, (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .8ball will I be rich?');
  return ctx.reply(`🎱 ${pick(EIGHT)}`);
});

add({ names: ['slot'], cat: 'Games' }, (ctx) => {
  const sym = ['🍒', '🍋', '🍇', '🍉', '⭐', '💎'];
  const r = [pick(sym), pick(sym), pick(sym)];
  const win = r[0] === r[1] && r[1] === r[2];
  const two = !win && (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]);
  return ctx.reply(`🎰 [ ${r.join(' | ')} ]\n${win ? '💰 JACKPOT!' : two ? '✨ So close! Two match.' : '😅 Try again!'}`);
});

const TRUTHS = [
  'What is the most embarrassing thing you have done in public?',
  'What was your biggest fear as a child?',
  'Who was your first crush?',
  'What is a secret talent you have?',
  'What is the last lie you told?',
  'What is the worst gift you ever received?',
  'What is the silliest thing you are afraid of?',
  'If you could swap lives with someone in this chat for a day, who would it be?',
];
const DARES = [
  'Send a voice note singing your favourite song.',
  'Change your status to a funny sentence for one hour.',
  'Send your best funny face right now.',
  'Speak only in emojis for the next 5 minutes.',
  'Send a voice note imitating an animal.',
  'Say something nice about every person in this chat.',
  'Tell us your most useless talent and show it.',
  'Write a short poem about the last person who spoke.',
];
add({ names: ['truth'], cat: 'Games' }, (ctx) => ctx.reply(`🤔 *TRUTH*\n${pick(TRUTHS)}`));
add({ names: ['dare'], cat: 'Games' }, (ctx) => ctx.reply(`😈 *DARE*\n${pick(DARES)}`));

// ---------- LEVELS / XP ----------
const xpCool = new Map();
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 40));

async function giveXp(ctx) {
  if (!ctx.isGroup || ctx.m.key.fromMe) return;
  const k = num(ctx.sender);
  const now = Date.now();
  if (now - (xpCool.get(k) || 0) < 30000) return;
  xpCool.set(k, now);
  const gain = 5 + Math.floor(Math.random() * 6);
  const r = await col('users').findOneAndUpdate({ _id: k }, { $inc: { xp: gain }, $set: { jid: ctx.sender } }, { upsert: true, returnDocument: 'after' });
  const doc = r && r.value !== undefined ? r.value : r;
  if (doc && typeof doc.xp === 'number' && levelOf(doc.xp) > levelOf(doc.xp - gain)) {
    await ctx.sock.sendMessage(ctx.from, { text: `🎉 @${k} reached *level ${levelOf(doc.xp)}*! Keep chatting 🔥`, mentions: [ctx.sender] });
  }
}

add({ names: ['rank', 'level', 'xp'], cat: 'Level' }, async (ctx) => {
  const t = getTargets(ctx)[0] || ctx.sender;
  const k = num(t);
  const u = await col('users').findOne({ _id: k });
  const xp = u?.xp || 0;
  const lvl = levelOf(xp);
  const cur = lvl * lvl * 40;
  const next = (lvl + 1) * (lvl + 1) * 40;
  const filled = Math.max(0, Math.min(10, Math.round(((xp - cur) / (next - cur)) * 10)));
  const pos = (await col('users').countDocuments({ xp: { $gt: xp } })) + 1;
  await ctx.sock.sendMessage(ctx.from, {
    text: `🏆 *Rank card*\n👤 @${k}\n⭐ Level: *${lvl}*\n✨ XP: ${xp} / ${next}\n[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}]\n🥇 Position: #${pos}`,
    mentions: [t],
  }, { quoted: ctx.m });
});

add({ names: ['leaderboard', 'lb', 'top'], cat: 'Level' }, async (ctx) => {
  const top = await col('users').find({ xp: { $gt: 0 } }).sort({ xp: -1 }).limit(10).toArray();
  if (!top.length) return ctx.reply('No ranking yet. Chat in groups to earn XP!');
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => `${medals[i] || (i + 1) + '.'} @${u._id} · Lv ${levelOf(u.xp)} · ${u.xp} XP`);
  await ctx.sock.sendMessage(ctx.from, {
    text: `🏆 *LEADERBOARD*\n\n${lines.join('\n')}`,
    mentions: top.map((u) => u.jid || `${u._id}@s.whatsapp.net`),
  }, { quoted: ctx.m });
});

add({ names: ['daily'], cat: 'Level' }, async (ctx) => {
  const k = num(ctx.sender);
  const u = await col('users').findOne({ _id: k });
  const last = u?.lastDaily || 0;
  const wait = 20 * 36e5 - (Date.now() - last);
  if (wait > 0) return ctx.reply(`⏳ Come back in ${Math.floor(wait / 36e5)}h ${Math.floor((wait % 36e5) / 6e4)}m for your next daily reward.`);
  const streak = Date.now() - last < 48 * 36e5 ? (u?.streak || 0) + 1 : 1;
  const reward = 100 + Math.min(streak, 7) * 20;
  await col('users').updateOne({ _id: k }, { $inc: { xp: reward }, $set: { lastDaily: Date.now(), streak, jid: ctx.sender } }, { upsert: true });
  await ctx.reply(`🎁 *Daily reward!*\n+${reward} XP\n🔥 Streak: ${streak} day(s)`);
});

// ---------- MORE TOOLS ----------
add({ names: ['define', 'dict'], cat: 'Tools' }, async (ctx) => {
  const w = ctx.args[0];
  if (!w) return ctx.reply('Usage: .define serendipity');
  try {
    const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { timeout: 15000 });
    const e = data[0];
    const lines = (e.meanings || []).slice(0, 3).map((m) => `• _${m.partOfSpeech}_: ${m.definitions[0].definition}`);
    await ctx.reply(`📖 *${e.word}* ${e.phonetic || ''}\n\n${lines.join('\n')}`);
  } catch { await ctx.reply('Could not find that word.'); }
});

add({ names: ['wiki'], cat: 'Tools' }, async (ctx) => {
  let lang = 'en';
  let q = ctx.text;
  if (/^[a-z]{2}$/.test(ctx.args[0] || '') && ctx.args.length > 1) { lang = ctx.args[0]; q = ctx.args.slice(1).join(' '); }
  if (!q) return ctx.reply('Usage: .wiki Mount Kilimanjaro\n(or .wiki sw Kilimanjaro)');
  try {
    const { data } = await axios.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, '_'))}`, { timeout: 15000, headers: { 'User-Agent': 'LuqmanXMD/1.0' } });
    const ex = data.extract || '';
    if (!ex) throw new Error('none');
    await ctx.reply(`📚 *${data.title}*\n\n${ex.slice(0, 800)}${ex.length > 800 ? '...' : ''}`);
  } catch { await ctx.reply('Could not find an article for that.'); }
});

const COINS = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple', doge: 'dogecoin', ada: 'cardano', ltc: 'litecoin', usdt: 'tether', trx: 'tron', ton: 'the-open-network' };
add({ names: ['crypto', 'price'], cat: 'Tools' }, async (ctx) => {
  const a = (ctx.args[0] || 'btc').toLowerCase();
  const id = COINS[a] || a;
  try {
    const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`, { timeout: 15000 });
    const d = data[id];
    if (!d) return ctx.reply('Unknown coin. Try: btc, eth, bnb, sol, xrp, doge, ada, ltc, usdt');
    const ch = d.usd_24h_change ?? 0;
    await ctx.reply(`💰 *${id}*\nPrice: $${d.usd.toLocaleString()}\n24h: ${ch >= 0 ? '📈 +' : '📉 '}${ch.toFixed(2)}%`);
  } catch { await ctx.reply('Price service unavailable. Try again later.'); }
});

const CITY_TZ = {
  'dar es salaam': 'Africa/Dar_es_Salaam', dar: 'Africa/Dar_es_Salaam', nairobi: 'Africa/Nairobi', kampala: 'Africa/Kampala', kigali: 'Africa/Kigali',
  lagos: 'Africa/Lagos', accra: 'Africa/Accra', cairo: 'Africa/Cairo', johannesburg: 'Africa/Johannesburg', london: 'Europe/London', paris: 'Europe/Paris',
  berlin: 'Europe/Berlin', istanbul: 'Europe/Istanbul', moscow: 'Europe/Moscow', dubai: 'Asia/Dubai', riyadh: 'Asia/Riyadh', mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata', karachi: 'Asia/Karachi', beijing: 'Asia/Shanghai', singapore: 'Asia/Singapore', tokyo: 'Asia/Tokyo', sydney: 'Australia/Sydney',
  'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles', toronto: 'America/Toronto', 'sao paulo': 'America/Sao_Paulo',
};
add({ names: ['time', 'worldtime'], cat: 'Tools' }, (ctx) => {
  const q = (ctx.text || 'dar es salaam').toLowerCase().trim();
  const tz = CITY_TZ[q] || (ctx.text.includes('/') ? ctx.text.trim() : null);
  if (!tz) return ctx.reply('Unknown city. Try: ' + Object.keys(CITY_TZ).slice(0, 12).join(', '));
  try {
    return ctx.reply(`🕐 *${ctx.text || 'Dar es Salaam'}*\n${new Date().toLocaleString('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' })}`);
  } catch { return ctx.reply('Invalid time zone.'); }
});

add({ names: ['password', 'genpass'], cat: 'Tools' }, (ctx) => {
  const len = Math.min(Math.max(parseInt(ctx.args[0]) || 14, 8), 64);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return ctx.reply(`🔐 *Password (${len})*\n${out}\n\n_Generate passwords in a private chat so nobody else sees them._`);
});

// ---------- GROUP EXTRAS ----------
add({ names: ['rules'], cat: 'Group', group: true }, async (ctx) => {
  const g = await getGroup(ctx.from);
  await ctx.reply(g.rules ? `📜 *Group rules*\n\n${g.rules}` : 'No rules set yet. Admins can set them with .setrules <text>');
});

add({ names: ['setrules'], cat: 'Group', group: true, admin: true }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .setrules 1. Be kind 2. No spam');
  const g = await getGroup(ctx.from);
  g.rules = ctx.text;
  await saveGroup(g);
  await ctx.reply('✅ Group rules saved.');
});

const afkMap = new Map();
add({ names: ['afk'], cat: 'Group', group: true }, async (ctx) => {
  afkMap.set(num(ctx.sender), { reason: ctx.text || 'Away', since: Date.now() });
  await ctx.sock.sendMessage(ctx.from, { text: `😴 @${num(ctx.sender)} is now AFK: ${ctx.text || 'Away'}`, mentions: [ctx.sender] }, { quoted: ctx.m });
});

async function afkCheck(ctx, text) {
  if (!ctx.isGroup || !afkMap.size) return;
  const k = num(ctx.sender);
  const isAfkCmd = text.toLowerCase().startsWith(ctx.prefix + 'afk');
  if (afkMap.has(k) && !isAfkCmd) {
    const a = afkMap.get(k);
    afkMap.delete(k);
    await ctx.sock.sendMessage(ctx.from, { text: `👋 Welcome back @${k}! You were AFK for ${fmtTime((Date.now() - a.since) / 1000)}.`, mentions: [ctx.sender] }, { quoted: ctx.m });
  }
  const ci = ctx.contextInfo;
  const ids = new Set([...(ci?.mentionedJid || []), ci?.participant].filter(Boolean));
  for (const id of ids) {
    const a = afkMap.get(num(id));
    if (a && num(id) !== k) {
      await ctx.sock.sendMessage(ctx.from, { text: `😴 @${num(id)} is AFK: ${a.reason}\n(for ${fmtTime((Date.now() - a.since) / 1000)})`, mentions: [id] }, { quoted: ctx.m });
    }
  }
}

add({ names: ['antibadword'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const v = onoff((ctx.args[0] || '').toLowerCase());
  if (v === null) return ctx.reply('Usage: .antibadword on|off\nAdd words with .addbad <word>');
  const g = await getGroup(ctx.from);
  g.antibadword = v;
  await saveGroup(g);
  await ctx.reply(`🤬 Bad-word filter: *${v ? 'ON' : 'OFF'}*\n(Bot must be admin. Offenders get a warning.)`);
});

add({ names: ['addbad'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const w = ctx.text.toLowerCase().trim();
  if (!w) return ctx.reply('Usage: .addbad <word or phrase>');
  const g = await getGroup(ctx.from);
  g.badwords = [...new Set([...(g.badwords || []), w])];
  await saveGroup(g);
  await ctx.reply(`✅ Added. The filter has ${g.badwords.length} word(s).`);
});

add({ names: ['delbad'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const w = ctx.text.toLowerCase().trim();
  if (!w) return ctx.reply('Usage: .delbad <word or phrase>');
  const g = await getGroup(ctx.from);
  g.badwords = (g.badwords || []).filter((x) => x !== w);
  await saveGroup(g);
  await ctx.reply('✅ Removed.');
});

add({ names: ['badwords'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const g = await getGroup(ctx.from);
  await ctx.reply((g.badwords || []).length ? '📋 *Filtered words*\n' + g.badwords.map((w) => `• ${w}`).join('\n') : 'No filtered words yet. Add with .addbad <word>');
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
  vv: '👁️', getpp: '🖼️', statusview: '👀', leave: '🚪', gstatus: '📲', del: '🗑️',
  resetlink: '🔄', block: '⛔', unblock: '✅', setpp: '🖼️', restart: '♻️',
  vision: '🔍', persona: '🎭', aiclear: '🧹', rps: '✊', flip: '🪙', '8ball': '🎱', slot: '🎰', truth: '🤔', dare: '😈',
  rank: '🏆', leaderboard: '🥇', daily: '🎁', define: '📖', wiki: '📚', crypto: '💰', time: '🕐', password: '🔐',
  rules: '📜', setrules: '📜', afk: '😴', antibadword: '🤬', addbad: '➕', delbad: '➖', badwords: '📋', setmenuimg: '🖼️',
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
const statusStore = new Map(); // recent statuses (for .vv / .save)
const sentIds = new Set(); // ids of messages the bot itself sent
const spam = new Map();
const LINK_RE = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;
let reminderTimer;
let starting = false;
let currentSock = null;

// keep-alive web server for Render
const app = express();
app.get('/', (_, res) => res.send(`${cfg.botName} is running`));
app.listen(process.env.PORT || 3000, () => console.log('Web server started'));

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  try { currentSock?.end(undefined); } catch {}
  setTimeout(() => process.exit(0), 700);
});
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

    currentSock = sock;
    const origSend = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
      const r = await origSend(...args);
      if (r?.key?.id) {
        sentIds.add(r.key.id);
        if (sentIds.size > 3000) sentIds.delete(sentIds.values().next().value);
      }
      return r;
    };
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
        if (code === DisconnectReason.connectionReplaced) {
          console.log('Another instance took over this session. This instance stays idle (no reconnect).');
          return;
        }
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
          let sent = false;
          try {
            const url = await sock.profilePictureUrl(jid, 'image');
            await sock.sendMessage(id, { image: { url }, caption: text, mentions: [jid] });
            sent = true;
          } catch {}
          if (!sent) await sock.sendMessage(id, { text, mentions: [jid] });
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
  if (!m.message) return;
  if (m.key.fromMe && sentIds.has(m.key.id)) return;
  const settings = await getSettings();
  if (m.key.remoteJid === 'status@broadcast') {
    statusStore.set(m.key.id, m);
    if (statusStore.size > 300) statusStore.delete(statusStore.keys().next().value);
    if (settings.statusview && !m.key.fromMe) {
      try { await sock.readMessages([m.key]); } catch {}
    }
    return;
  }
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

  // owner detection: phone number, own LID, or sudo (groups may use LID instead of phone numbers)
  const myNums = [cfg.ownerNumber, ...[sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => num(j))];
  let isOwner = !!m.key.fromMe || myNums.includes(num(sender)) || settings.sudo.includes(num(sender));
  if (!isOwner && isGroup && text.startsWith(settings.prefix)) {
    try {
      const meta = await sock.groupMetadata(from);
      const ids = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map((x) => num(x));
      const mine = meta.participants.find((p) => ids(p).includes(cfg.ownerNumber));
      if (mine && ids(mine).includes(num(sender))) isOwner = true;
    } catch {}
  }
  if (!isOwner && settings.banned.includes(num(sender))) return;

  const reply = (t, extra = {}) => sock.sendMessage(from, { text: t, ...extra }, { quoted: m });
  const ctx = { sock, m, from, sender, isGroup, isOwner, content, contextInfo, settings, prefix: settings.prefix, reply, text: '', args: [], cmd: '' };

  if (isGroup && !m.key.fromMe && (await protect(ctx, mtype, text))) return;
  if (isGroup) {
    await afkCheck(ctx, text).catch(() => {});
    giveXp(ctx).catch(() => {});
  }

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
  if (g.antilink === 'off' && !g.antisticker && !g.antispam && !g.antibot && !g.antibadword) return false;

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
  if (g.antibadword && (g.badwords || []).length) {
    const low = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
    if (g.badwords.some((w) => low.includes(` ${w} `))) {
      await del();
      await addWarn(ctx, g, sender, 'Bad language');
      return true;
    }
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
