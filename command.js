const axios = require('axios');
const QRCode = require('qrcode');
const sharp = require('sharp');
const tts = require('google-tts-api');
const pino = require('pino');
const { Sticker } = require('wa-sticker-formatter');
const { downloadMediaMessage, jidNormalizedUser, normalizeMessageContent } = require('@whiskeysockets/baileys');
const cfg = require('./config');
const store = require('./store');

const logger = pino({ level: 'silent' });
const num = (j) => (j || '').split('@')[0].split(':')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= Helpers =================
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

async function addWarn(ctx, g, jid, reason) {
  const { sock, from } = ctx;
  const k = num(jid);
  g.warns[k] = (g.warns[k] || 0) + 1;
  const c = g.warns[k];
  if (c >= 3) {
    g.warns[k] = 0;
    await store.saveGroup(g);
    await sock.sendMessage(from, { text: `⛔ @${k} reached 3 warnings and was removed.\nReason: ${reason}`, mentions: [jid] });
    try { await sock.groupParticipantsUpdate(from, [jid], 'remove'); } catch {}
  } else {
    await store.saveGroup(g);
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

// ================= Command registry =================
const list = [];
const map = new Map();
function add(opts, run) {
  const c = { ...opts, run };
  list.push(c);
  for (const n of c.names) map.set(n, c);
}

// ---------- GENERAL ----------
add({ names: ['menu', 'help'], cat: 'General' }, async (ctx) => {
  const icons = { General: '🤖', Tools: '🔧', Media: '🎨', Productivity: '📝', Fun: '🎲', Group: '👥', Security: '🛡️', Settings: '⚙️' };
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

add({ names: ['owner'], cat: 'General' }, (ctx) =>
  ctx.reply(`👑 *Owner:* ${cfg.ownerName}\n📞 wa.me/${cfg.ownerNumber}`));

add({ names: ['runtime', 'uptime'], cat: 'General' }, (ctx) => ctx.reply(`⏱️ Running for ${fmtTime(process.uptime())}`));

add({ names: ['id'], cat: 'General' }, (ctx) =>
  ctx.reply(`Chat ID: ${ctx.from}\nYour ID: ${ctx.sender}`));

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
  if (!text) return ctx.reply('Usage: .tts sw Habari yako\n(language code is optional, default en)');
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
  await store.col('reminders').insertOne({ jid: ctx.from, user: ctx.sender, at, text });
  const local = new Date(at + cfg.utcOffset * 36e5).toISOString().replace('T', ' ').slice(0, 16);
  await ctx.reply(`⏰ Reminder set for ${local} (EAT)\n📌 ${text}`);
});

async function userItems(ctx, type) {
  return store.col('items').find({ user: num(ctx.sender), type }).sort({ ts: 1 }).toArray();
}

add({ names: ['note'], cat: 'Productivity' }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .note buy milk');
  await store.col('items').insertOne({ user: num(ctx.sender), type: 'note', text: ctx.text, ts: Date.now() });
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
  await store.col('items').deleteOne({ _id: it._id });
  await ctx.reply('🗑️ Note deleted.');
});

add({ names: ['todo'], cat: 'Productivity' }, async (ctx) => {
  const sub = (ctx.args[0] || 'list').toLowerCase();
  const rest = ctx.args.slice(1).join(' ');
  const items = await userItems(ctx, 'todo');
  if (sub === 'add') {
    if (!rest) return ctx.reply('Usage: .todo add finish homework');
    await store.col('items').insertOne({ user: num(ctx.sender), type: 'todo', text: rest, done: false, ts: Date.now() });
    return ctx.reply('✅ Added to your to-do list.');
  }
  if (sub === 'done' || sub === 'del') {
    const it = items[Number(rest) - 1];
    if (!it) return ctx.reply(`Usage: .todo ${sub} <number>`);
    if (sub === 'done') await store.col('items').updateOne({ _id: it._id }, { $set: { done: true } });
    else await store.col('items').deleteOne({ _id: it._id });
    return ctx.reply(sub === 'done' ? '☑️ Marked as done.' : '🗑️ Removed.');
  }
  if (!items.length) return ctx.reply('Your to-do list is empty.\nAdd: .todo add <task>');
  await ctx.reply('📋 *To-do*\n' + items.map((x, i) => `${i + 1}. ${x.done ? '☑️' : '⬜'} ${x.text}`).join('\n') + '\n\n.todo add | done <n> | del <n>');
});

// ---------- FUN ----------
const jokes = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'I told my phone I needed space. Now it won’t stop showing "storage full".',
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
const pick = (a) => a[Math.floor(Math.random() * a.length)];

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
    setTimeout(() => ctx.sock.sendMessage(ctx.from, { text: `✅ Answer: *${ans}. ${decode(q.correct_answer)}*` }), 20000);
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
    const failed = r?.filter((x) => x.status && x.status !== '200');
    await ctx.reply(failed?.length ? `Some actions failed (${failed.map((f) => f.status).join(', ')}).` : done);
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
});
add({ names: ['setdesc'], cat: 'Group', group: true, admin: true, botAdmin: true }, async (ctx) => {
  if (!ctx.text) return ctx.reply('Usage: .setdesc New description');
  await ctx.sock.groupUpdateDescription(ctx.from, ctx.text);
});

// ---------- SECURITY ----------
add({ names: ['antilink'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const v = (ctx.args[0] || '').toLowerCase();
  if (!['off', 'warn', 'delete'].includes(v)) return ctx.reply('Usage: .antilink off|warn|delete');
  const g = await store.getGroup(ctx.from);
  g.antilink = v;
  await store.saveGroup(g);
  await ctx.reply(`🔗 Antilink: *${v}*\n(Bot must be admin.)`);
});

for (const [name, key, label] of [
  ['antisticker', 'antisticker', 'Anti-sticker'],
  ['antispam', 'antispam', 'Anti-spam'],
  ['antibot', 'antibot', 'Anti-bot'],
]) {
  add({ names: [name], cat: 'Security', group: true, admin: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    const g = await store.getGroup(ctx.from);
    g[key] = v;
    await store.saveGroup(g);
    await ctx.reply(`🛡️ ${label}: *${v ? 'ON' : 'OFF'}*\n(Bot must be admin.)`);
  });
}

add({ names: ['warn'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const t = getTargets(ctx);
  if (!t.length) return ctx.reply('Usage: .warn @user reason');
  const g = await store.getGroup(ctx.from);
  await addWarn(ctx, g, t[0], ctx.args.filter((a) => !a.startsWith('@') && !/^\d{8,}$/.test(a)).join(' ') || 'Manual warning');
});

add({ names: ['warnings'], cat: 'Security', group: true }, async (ctx) => {
  const t = getTargets(ctx)[0] || ctx.sender;
  const g = await store.getGroup(ctx.from);
  await ctx.sock.sendMessage(ctx.from, { text: `⚠️ @${num(t)} has ${g.warns[num(t)] || 0}/3 warnings`, mentions: [t] }, { quoted: ctx.m });
});

add({ names: ['unwarn'], cat: 'Security', group: true, admin: true }, async (ctx) => {
  const t = getTargets(ctx)[0];
  if (!t) return ctx.reply('Usage: .unwarn @user');
  const g = await store.getGroup(ctx.from);
  g.warns[num(t)] = Math.max((g.warns[num(t)] || 0) - 1, 0);
  await store.saveGroup(g);
  await ctx.reply(`✅ Warning removed. Now ${g.warns[num(t)]}/3`);
});

// ---------- SETTINGS ----------
for (const [name, key, label] of [['welcome', 'welcome', 'Welcome'], ['goodbye', 'goodbye', 'Goodbye']]) {
  add({ names: [name], cat: 'Settings', group: true, admin: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    const g = await store.getGroup(ctx.from);
    g[key] = v;
    await store.saveGroup(g);
    await ctx.reply(`${label} messages: *${v ? 'ON' : 'OFF'}*`);
  });
  add({ names: ['set' + name], cat: 'Settings', group: true, admin: true }, async (ctx) => {
    if (!ctx.text) return ctx.reply(`Usage: .set${name} Hello @user, welcome to {group}!\nPlaceholders: @user {group} {desc}`);
    const g = await store.getGroup(ctx.from);
    g[key + 'Msg'] = ctx.text;
    await store.saveGroup(g);
    await ctx.reply(`✅ ${label} message updated.`);
  });
}

add({ names: ['mode'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = (ctx.args[0] || '').toLowerCase();
  if (!['public', 'private'].includes(v)) return ctx.reply('Usage: .mode public|private');
  ctx.settings.mode = v;
  await store.saveSettings();
  await ctx.reply(`🌐 Mode: *${v}*`);
});

add({ names: ['prefix'], cat: 'Settings', owner: true }, async (ctx) => {
  const v = ctx.args[0];
  if (!v || v.length > 3) return ctx.reply('Usage: .prefix !   (max 3 characters)');
  ctx.settings.prefix = v;
  await store.saveSettings();
  await ctx.reply(`⚡ Prefix changed to *${v}*`);
});

const userList = (name, field, addIt, done) =>
  add({ names: [name], cat: 'Settings', owner: true }, async (ctx) => {
    const t = getTargets(ctx);
    if (!t.length) return ctx.reply(`Usage: .${name} @user (or reply / number)`);
    const set = new Set(ctx.settings[field]);
    for (const j of t) addIt ? set.add(num(j)) : set.delete(num(j));
    ctx.settings[field] = [...set];
    await store.saveSettings();
    await ctx.reply(done);
  });
userList('sudo', 'sudo', true, '✅ Added to sudo users.');
userList('delsudo', 'sudo', false, '✅ Removed from sudo users.');
userList('ban', 'banned', true, '🚫 User banned from using the bot.');
userList('unban', 'banned', false, '✅ User unbanned.');

add({ names: ['listsudo'], cat: 'Settings', owner: true }, (ctx) =>
  ctx.reply(ctx.settings.sudo.length ? '👑 *Sudo users*\n' + ctx.settings.sudo.map((n) => `• ${n}`).join('\n') : 'No sudo users.'));

for (const [name, key, label] of [['anticall', 'anticall', 'Anti-call'], ['antidelete', 'antidelete', 'Anti-delete']]) {
  add({ names: [name], cat: 'Settings', owner: true }, async (ctx) => {
    const v = onoff((ctx.args[0] || '').toLowerCase());
    if (v === null) return ctx.reply(`Usage: .${name} on|off`);
    ctx.settings[key] = v;
    await store.saveSettings();
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

// ================= Dispatcher =================
async function run(ctx) {
  const c = map.get(ctx.cmd);
  if (!c) return;
  if (c.owner && !ctx.isOwner) return ctx.reply('⛔ Owner only command.');
  if (c.group && !ctx.isGroup) return ctx.reply('👥 This command works in groups only.');
  if (c.admin || c.botAdmin) {
    const info = await adminInfo(ctx);
    if (c.admin && !info.isAdmin && !ctx.isOwner) return ctx.reply('⛔ Admins only.');
    if (c.botAdmin && !info.isBotAdmin) return ctx.reply('⚠️ Make the bot an admin first.');
  }
  try {
    await c.run(ctx);
  } catch (e) {
    console.error(`Command ${ctx.cmd} failed:`, e);
    await ctx.reply('❌ Something went wrong. Try again.');
  }
}

module.exports = { run, adminInfo, addWarn, num };
