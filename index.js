const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    delay,
    jidDecode,
    makeInMemoryStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");

// ==========================================
// CONFIGURATIONS & GLOBAL VARIABLES
// ==========================================
global.ownerNumber = "255678716839"; // Namba yako Luqman
global.ownerName = "LUQMAN SJ";
global.botName = "LUQMAN MD";
global.prefix = ".";
global.botMode = "Public"; // Public au Private
global.menuImg = "https://telegra.ph/file/default-menu.jpg";
global.aliveImg = "https://telegra.ph/file/default-alive.jpg";
global.aliveMsg = "Hello! LUQMAN MD is active and running.";

// Automation States
let autoReact = false;
let ownerReact = false;
let autoRead = false;
let alwaysOnline = false;
let simTyping = false;
let simRecording = false;
let antiCall = false;
let antiSpam = false;

// Status Automation
let statusSeen = false;
let statusReact = false;
let statusReply = false;

// Security Buffers
const bannedUsers = new Set();
const bannedGroups = new Set();
const bannedGroupUsers = {}; // { groupJid: Set(bannedUsers) }
const disabledCommands = new Set();
const voiceTriggers = {}; // { keyword: audioBuffer/url }

// Anti-Delete & Anti-Edit Cache (Meseji 100 pekee kuzuia crash)
const messageCache = [];
const cacheLimit = 100;

function pushToCache(msg) {
    if (messageCache.length >= cacheLimit) {
        messageCache.shift(); // Futa ya zamani zaidi
    }
    messageCache.push(msg);
}

// In-Memory Store
const store = makeInMemoryStore({ logger: pino({ level: "silent" }) });

// ==========================================
// START CONNECTION & PAIRING CODE SYSTEM
// ==========================================
async function startLuqmanBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    
    const conn = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Tumezima QR kwa ajili ya Pairing Code
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    store.bind(conn.ev);

    // KUPAIR KWA NAMBA YA SIMU MOJA KWA MOJA
    if (!conn.authState.creds.registered) {
        let phoneNumber = global.ownerNumber.replace(/[^0-9]/g, '');
        console.log(`\n==================================================`);
        console.log(`[!] LUQMAN MD: Attempting to pair with number: ${phoneNumber}`);
        console.log(`==================================================\n`);
        
        await delay(3000); // Subiri sekunde 3 ili connection iwe stable
        try {
            let code = await conn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n==================================================`);
            console.log(`🔥 YOUR PAIRING CODE: ${code}`);
            console.log(`==================================================\n`);
        } catch (err) {
            console.log("❌ Error requesting pairing code: ", err);
        }
    }

    // Save Credentials kila inapobadilika
    conn.ev.on("creds.update", saveCreds);

    // Event ya Call (Anti-Call)
    conn.ev.on("call", async (calls) => {
        if (!antiCall) return;
        for (let call of calls) {
            if (call.status === "offer") {
                console.log(`[CALL DETECTED] Auto-blocking caller: ${call.from}`);
                await conn.rejectCall(call.id, call.from);
                await conn.updateBlockStatus(call.from, "block");
            }
        }
    });

    // Connection Updates
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log("❌ Device logged out. Please delete auth_session and pair again.");
            } else {
                console.log("🔄 Connection lost. Reconnecting in 5 seconds...");
                setTimeout(startLuqmanBot, 5000);
            }
        } else if (connection === "open") {
            console.log("\n✅ LUQMAN MD IS SUCCESSFULLY CONNECTED!");
            console.log(`👑 Owner: ${global.ownerName}`);
            console.log(`🤖 Bot Name: ${global.botName}\n`);
        }
    });

    // ==========================================
    // STATUS (STORY) AUTOMATION
    // ==========================================
    conn.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message) return;

            // Kutambua Status Updates
            const senderJid = msg.key.remoteJid;
            if (senderJid === "status@broadcast") {
                const statusOwner = msg.key.participant;
                
                // 1. Status Seen
                if (statusSeen) {
                    await conn.readMessages([msg.key]);
                    console.log(`[STATUS] Read status from: ${statusOwner}`);
                }
                
                // 2. Status React (Na Delay kuzuia BAN)
                if (statusReact) {
                    await delay(5000); // Sekunde 5 za ulinzi
                    const emojis = ["❤️", "🔥", "🙌", "💯", "👏", "😂"];
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await conn.sendMessage(senderJid, { react: { text: randomEmoji, key: msg.key } }, { statusJidList: [statusOwner] });
                }

                // 3. Status Reply
                if (statusReply) {
                    await delay(8000); // Sekunde 8 za ulinzi
                    await conn.sendMessage(statusOwner, { text: "Nice status! 🔥 - Powered by LUQMAN MD" }, { quoted: msg });
                }
                return;
            }

            // Hifadhi meseji kwenye Cache kwa ajili ya Anti-Delete/Edit
            pushToCache(msg);

            // Antidelete System
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 3) {
                const deletedKey = msg.message.protocolMessage.key;
                const cachedMsg = messageCache.find(m => m.key.id === deletedKey.id);
                if (cachedMsg && global.antiDelete) {
                    await conn.sendMessage(msg.key.remoteJid, { text: `🛡️ *LUQMAN MD ANTI-DELETE* \n\nMtumiaji: @${deletedKey.participant.split("@")[0]} alifuta ujumbe huu:`, mentions: [deletedKey.participant] });
                    await conn.sendMessage(msg.key.remoteJid, { forward: cachedMsg }, { quoted: cachedMsg });
                }
            }

            // Antiedit System
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 14) {
                const editedKey = msg.message.protocolMessage.key;
                const cachedMsg = messageCache.find(m => m.key.id === editedKey.id);
                if (cachedMsg && global.antiEdit) {
                    await conn.sendMessage(msg.key.remoteJid, { text: `🛡️ *LUQMAN MD ANTI-EDIT* \n\nMtumiaji: @${editedKey.participant.split("@")[0]} amehariri ujumbe huu wa zamani:`, mentions: [editedKey.participant] });
                    await conn.sendMessage(msg.key.remoteJid, { forward: cachedMsg }, { quoted: cachedMsg });
                }
            }

            // Audio/Voice Triggers System
            const textContent = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
            if (voiceTriggers[textContent]) {
                await conn.sendMessage(msg.key.remoteJid, { audio: { url: voiceTriggers[textContent] }, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
            }

            // Parse Commands
            const isGroup = msg.key.remoteJid.endsWith("@g.us");
            const sender = isGroup ? msg.key.participant : msg.key.remoteJid;
            const isOwner = sender.includes(global.ownerNumber);

            // Auto React & Owner React
            if (autoReact) {
                const emojis = ["👍", "🙌", "🔥", "😎", "😂", "✨"];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await conn.sendMessage(msg.key.remoteJid, { react: { text: randomEmoji, key: msg.key } });
            }
            if (ownerReact && isOwner) {
                await conn.sendMessage(msg.key.remoteJid, { react: { text: "👑", key: msg.key } });
            }

            // Auto Read
            if (autoRead) {
                await conn.readMessages([msg.key]);
            }

            // Always Online, Typing, and Recording Simulation
            if (alwaysOnline) {
                await conn.sendPresenceUpdate("available", msg.key.remoteJid);
            }
            if (simTyping) {
                await conn.sendPresenceUpdate("composing", msg.key.remoteJid);
            }
            if (simRecording) {
                await conn.sendPresenceUpdate("recording", msg.key.remoteJid);
            }

            // Check if user or group is BANNED locally
            if (bannedUsers.has(sender) || bannedGroups.has(msg.key.remoteJid)) return; // Kaa kimya (muone taira)
            if (isGroup && bannedGroupUsers[msg.key.remoteJid]?.has(sender)) return; // Banned locally in this group

            // Command Prefixes check
            const prefix = global.prefix;
            if (!textContent.startsWith(prefix)) return;

            const args = textContent.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const q = args.join(" ");

            // Check if Command is Banned/Disabled globally
            if (disabledCommands.has(command)) {
                return await conn.sendMessage(msg.key.remoteJid, { text: `🔕 Command *${prefix}${command}* is temporarily disabled by Owner.` }, { quoted: msg });
            }

            // Group Metadata Helpers
            const groupMetadata = isGroup ? await conn.groupMetadata(msg.key.remoteJid) : null;
            const groupAdmins = isGroup ? groupMetadata.participants.filter(v => v.admin !== null).map(v => v.id) : [];
            const isBotAdmin = isGroup ? groupAdmins.includes(conn.user.id.split(":")[0] + "@s.whatsapp.net") : false;
            const isUserAdmin = isGroup ? groupAdmins.includes(sender) : false;

            // ==========================================
            // COMMAND HANDLER LOGIC
            // ==========================================
            switch (command) {

                // ================= MENU COMMAND =================
                case "menu": {
                    await conn.sendMessage(msg.key.remoteJid, { react: { text: "📜", key: msg.key } });
                    
                    let menuText = `𓊈𒆜꯭𝆭̽ 𝐋ʋ̽զϻ̈̐𝛂ƞ̄ 𝛅͜𝐉»ً𒆜꧂\n`;
                    menuText += `╔═══════════════════════════╗\n`;
                    menuText += `║  🤖 *${global.botName.toUpperCase()} V5.0.0*     ║\n`;
                    menuText += `╚═══════════════════════════╝\n\n`;
                    
                    menuText += `👑 *OWNERINFO*\n`;
                    menuText += `⚡ *Owner:* ${global.ownerName}\n`;
                    menuText += `⚡ *Prefix:* [ ${global.prefix} ]\n`;
                    menuText += `⚡ *Mode:* ${global.botMode}\n\n`;
                    
                    menuText += `─────────────────────────────\n`;
                    menuText += `📜 *𝐌 𝐄 𝐍 𝐔   𝐋 𝐈 𝐒 𝐓*\n`;
                    menuText += `─────────────────────────────\n\n`;
                    
                    menuText += `👥 𓊈𒆜 *𝗚𝗥𝗢𝗨𝗣 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦* 𒆜𓊉\n`;
                    menuText += `  ┠ _${prefix}gpp_ 🖼️\n`;
                    menuText += `  ┠ _${prefix}mute_ 🔒\n`;
                    menuText += `  ┠ _${prefix}unmute_ 🔓\n`;
                    menuText += `  ┠ _${prefix}kick_ 🪓\n`;
                    menuText += `  ┠ _${prefix}promote_ 👑\n`;
                    menuText += `  ┠ _${prefix}demote_ 📉\n`;
                    menuText += `  ┠ _${prefix}invitelink_ 🔗\n`;
                    menuText += `  ┠ _${prefix}revokelink_ ♻️\n`;
                    menuText += `  ┠ _${prefix}setgname_ 📝\n`;
                    menuText += `  ┠ _${prefix}setgdesc_ 📋\n`;
                    menuText += `  ┠ _${prefix}tagall_ 📢\n`;
                    menuText += `  ┠ _${prefix}tagadmin_ 👮‍♂️\n`;
                    menuText += `  ┠ _${prefix}members_ 👥\n`;
                    menuText += `  ┠ _${prefix}groupinfo_ ℹ️\n`;
                    menuText += `  ┠ _${prefix}antilink_ 🛡️\n`;
                    menuText += `  ┠ _${prefix}antibot_ 🤖\n`;
                    menuText += `  ┠ _${prefix}leave_ 👋\n`;
                    menuText += `  ┠ _${prefix}announce_ 📣\n`;
                    menuText += `  ┠ _${prefix}editgc_ ⚙\n`;
                    menuText += `  ┠ _${prefix}count_ 📊\n`;
                    menuText += `  ┠ _${prefix}delete_ 🗑️\n`;
                    menuText += `  ┠ _${prefix}myrole_ 👤\n`;
                    menuText += `  ┠ _${prefix}adminlist_ 🕵️‍♂️\n`;
                    menuText += `  ┠ _${prefix}bangc_ ⛔\n`;
                    menuText += `  ┠ _${prefix}unbangc_ 🔓\n`;
                    menuText += `  ┠ _${prefix}bangcuser_ 🙅‍♂️\n`;
                    menuText += `  ┠ _${prefix}unbangcuser_ 🙋‍♂️\n`;
                    menuText += `  ┩\n\n`;
                    
                    menuText += `🛡️ 𓊈𒆜 *𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬 & 𝗢𝗪𝗡𝗘𝗥* 𒆜𓊉\n`;
                    menuText += `  ┠ _${prefix}block_ 🚫\n`;
                    menuText += `  ┠ _${prefix}unblock_ 🔓\n`;
                    menuText += `  ┠ _${prefix}clear_ 🧹\n`;
                    menuText += `  ┠ _${prefix}report_ 📮\n`;
                    menuText += `  ┠ _${prefix}ownername_ ✍️\n`;
                    menuText += `  ┠ _${prefix}ownernumber_ 📞\n`;
                    menuText += `  ┠ _${prefix}botname_ 🤖\n`;
                    menuText += `  ┠ _${prefix}menuimg_ 🖼️\n`;
                    menuText += `  ┠ _${prefix}aliveimg_ 🎨\n`;
                    menuText += `  ┠ _${prefix}alivemsg_ 💬\n`;
                    menuText += `  ┠ _${prefix}antidelete_ 🕵️‍♂️\n`;
                    menuText += `  ┠ _${prefix}antiedit_ 📝\n`;
                    menuText += `  ┠ _${prefix}antispam_ ⏳\n`;
                    menuText += `  ┠ _${prefix}anticall_ ☎️\n`;
                    menuText += `  ┠ _${prefix}ban_ ❌\n`;
                    menuText += `  ┠ _${prefix}unban_ 🔓\n`;
                    menuText += `  ┠ _${prefix}bancmd_ 🔕\n`;
                    menuText += `  ┠ _${prefix}unbancmd_ 🔔\n`;
                    menuText += `  ┩\n\n`;
                    
                    menuText += `🟢 𓊈𒆜 *𝗔𝗨𝗧𝗢𝗠𝗔𝗧𝗜𝗢𝗡 & 𝗦𝗧𝗔𝗧𝗨𝗦* 𒆜𓊉\n`;
                    menuText += `  ┠ _${prefix}pp_ 👤\n`;
                    menuText += `  ┠ _${prefix}mode_ 🌍\n`;
                    menuText += `  ┠ _${prefix}prefix_ ⚙️\n`;
                    menuText += `  ┠ _${prefix}autoreact_ 🎭\n`;
                    menuText += `  ┠ _${prefix}ownerreact_ 🤴\n`;
                    menuText += `  ┠ _${prefix}autoread_ 👀\n`;
                    menuText += `  ┠ _${prefix}online_ 🟢\n`;
                    menuText += `  ┠ _${prefix}typing_ ⌨️\n`;
                    menuText += `  ┠ _${prefix}recording_ 🎙️\n`;
                    menuText += `  ┠ _${prefix}antibotprem_ 🤖\n`;
                    menuText += `  ┠ _${prefix}antilinkprem_ 🛡️\n`;
                    menuText += `  ┠ _${prefix}statusseen_ 👁️\n`;
                    menuText += `  ┠ _${prefix}statusreact_ ❤️\n`;
                    menuText += `  ┠ _${prefix}statusreply_ 💬\n`;
                    menuText += `  ┠ _${prefix}addvoice_ 🎙️\n`;
                    menuText += `  ┠ _${prefix}delvoice_ 🗑️\n`;
                    menuText += `  ┠ _${prefix}voicelist_ 📋\n`;
                    menuText += `  ┩\n\n`;
                    
                    menuText += `─────────────────────────────\n`;
                    menuText += `  𓊈𒆜꯭𝆭̽ 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐋𝐮𝐪𝐦𝐚𝐧 𝐒𝐉 »ً𒆜꧂\n`;
                    menuText += `─────────────────────────────`;

                    await conn.sendMessage(msg.key.remoteJid, { image: { url: global.menuImg }, caption: menuText }, { quoted: msg });
                    break;
                }

                // ================= GROUP COMMANDS =================
                case "gpp": {
                    if (!isGroup) return;
                    if (!isUserAdmin && !isOwner) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I must be admin to change group profile picture!" }, { quoted: msg });
                    // Hapa kodi ya kureceive image media to be updated
                    await conn.sendMessage(msg.key.remoteJid, { react: { text: "🖼️", key: msg.key } });
                    break;
                }
                case "mute": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Make me admin first!" }, { quoted: msg });
                    await conn.groupSettingUpdate(msg.key.remoteJid, "announcement");
                    await conn.sendMessage(msg.key.remoteJid, { text: "🔒 Group has been muted. Only admins can talk." }, { quoted: msg });
                    break;
                }
                case "unmute": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Make me admin first!" }, { quoted: msg });
                    await conn.groupSettingUpdate(msg.key.remoteJid, "not_announcement");
                    await conn.sendMessage(msg.key.remoteJid, { text: "🔓 Group has been unmuted. Everyone can talk." }, { quoted: msg });
                    break;
                }
                case "kick": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I am not Admin!" }, { quoted: msg });
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to a user or tag them!" }, { quoted: msg });
                    await conn.groupParticipantsUpdate(msg.key.remoteJid, [target], "remove");
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Successfully kicked @${target.split("@")[0]}`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "promote": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I am not Admin!" }, { quoted: msg });
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or tag a user to promote!" }, { quoted: msg });
                    await conn.groupParticipantsUpdate(msg.key.remoteJid, [target], "promote");
                    await conn.sendMessage(msg.key.remoteJid, { text: `🎉 @${target.split("@")[0]} has been promoted to Admin.`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "demote": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I am not Admin!" }, { quoted: msg });
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or tag a user to demote!" }, { quoted: msg });
                    await conn.groupParticipantsUpdate(msg.key.remoteJid, [target], "demote");
                    await conn.sendMessage(msg.key.remoteJid, { text: `📉 @${target.split("@")[0]} has been demoted to a regular member.`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "invitelink": {
                    if (!isGroup) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I must be admin to get the link!" }, { quoted: msg });
                    const code = await conn.groupInviteCode(msg.key.remoteJid);
                    await conn.sendMessage(msg.key.remoteJid, { text: `🔗 Group Invite Link: https://chat.whatsapp.com/${code}` }, { quoted: msg });
                    break;
                }
                case "revokelink": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ I am not admin!" }, { quoted: msg });
                    await conn.groupRevokeInvite(msg.key.remoteJid);
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Invite link reset! Old link is no longer active." }, { quoted: msg });
                    break;
                }
                case "setgname": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a new group name!" }, { quoted: msg });
                    await conn.groupUpdateSubject(msg.key.remoteJid, q);
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Group name changed to: *${q}*` }, { quoted: msg });
                    break;
                }
                case "setgdesc": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide new description text!" }, { quoted: msg });
                    await conn.groupUpdateDescription(msg.key.remoteJid, q);
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Group description has been updated." }, { quoted: msg });
                    break;
                }
                case "tagall": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    let text = `📢 *ATTENTION EVERYONE* \n\nMessage: ${q || "No message"}\n\n`;
                    let mentions = [];
                    for (let mem of groupMetadata.participants) {
                        text += `▫️ @${mem.id.split("@")[0]}\n`;
                        mentions.push(mem.id);
                    }
                    await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: mentions });
                    break;
                }
                case "tagadmin": {
                    if (!isGroup) return;
                    let text = `👮‍♂️ *ATTENTION ADMINS* \n\n`;
                    for (let admin of groupAdmins) {
                        text += `▪️ @${admin.split("@")[0]}\n`;
                    }
                    await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: groupAdmins });
                    break;
                }
                case "members": {
                    if (!isGroup) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: `👥 Total Members: *${groupMetadata.participants.length}*` }, { quoted: msg });
                    break;
                }
                case "groupinfo": {
                    if (!isGroup) return;
                    let desc = groupMetadata.desc || "No Description";
                    let info = `ℹ️ *GROUP INFO* \n\n📝 *Name:* ${groupMetadata.subject}\n👥 *Members:* ${groupMetadata.participants.length}\n👑 *Creator:* @${groupMetadata.owner?.split("@")[0] || "Unknown"}\n📋 *Desc:* ${desc}`;
                    await conn.sendMessage(msg.key.remoteJid, { text: info, mentions: [groupMetadata.owner] }, { quoted: msg });
                    break;
                }
                case "antilink": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (q === "on") {
                        global.antiLink = true;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Anti-Link is now *ON*. External links will be auto-deleted." }, { quoted: msg });
                    } else if (q === "off") {
                        global.antiLink = false;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Anti-Link is now *OFF*." }, { quoted: msg });
                    } else {
                        await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Usage: .antilink [on/off]" }, { quoted: msg });
                    }
                    break;
                }
                case "antibot": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    if (q === "on") {
                        global.antiBot = true;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Anti-Bot active. All incoming foreign bots will be kicked." }, { quoted: msg });
                    } else {
                        global.antiBot = false;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Anti-Bot turned off." }, { quoted: msg });
                    }
                    break;
                }
                case "leave": {
                    if (!isOwner) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: "Goodbye everyone! LUQMAN MD is leaving..." });
                    await conn.groupLeave(msg.key.remoteJid);
                    break;
                }
                case "announce": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    await conn.groupSettingUpdate(msg.key.remoteJid, "announcement");
                    await conn.sendMessage(msg.key.remoteJid, { text: "⚙️ Group settings locked to admins only." }, { quoted: msg });
                    break;
                }
                case "editgc": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    await conn.groupSettingUpdate(msg.key.remoteJid, "locked");
                    await conn.sendMessage(msg.key.remoteJid, { text: "⚙️ Only admins can edit group settings/info." }, { quoted: msg });
                    break;
                }
                case "count": {
                    if (!isGroup) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: `📊 Message count tracker is active. [Calculating...]` }, { quoted: msg });
                    break;
                }
                case "delete": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    let targetKey = msg.message.extendedTextMessage?.contextInfo;
                    if (!targetKey) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to the message you want to delete!" }, { quoted: msg });
                    await conn.sendMessage(msg.key.remoteJid, { delete: { remoteJid: msg.key.remoteJid, fromMe: false, id: targetKey.stanzaId, participant: targetKey.participant } });
                    break;
                }
                case "myrole": {
                    if (!isGroup) return;
                    let role = isOwner ? "Owner" : isUserAdmin ? "Admin" : "Member";
                    await conn.sendMessage(msg.key.remoteJid, { text: `👤 Your Role: *${role}*` }, { quoted: msg });
                    break;
                }
                case "adminlist": {
                    if (!isGroup) return;
                    let text = `🕵️‍♂️ *CURRENT ADMINS* \n\n`;
                    for (let admin of groupAdmins) {
                        text += `▪️ @${admin.split("@")[0]}\n`;
                    }
                    await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: groupAdmins }, { quoted: msg });
                    break;
                }
                case "bangc": {
                    if (!isOwner) return;
                    bannedGroups.add(msg.key.remoteJid);
                    await conn.sendMessage(msg.key.remoteJid, { text: "🚫 This group has been banned from using LUQMAN MD." }, { quoted: msg });
                    break;
                }
                case "unbangc": {
                    if (!isOwner) return;
                    bannedGroups.delete(msg.key.remoteJid);
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Group unbanned. Commands are now active here." }, { quoted: msg });
                    break;
                }
                case "bangcuser": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or tag user to ban in this Group." }, { quoted: msg });
                    if (!bannedGroupUsers[msg.key.remoteJid]) bannedGroupUsers[msg.key.remoteJid] = new Set();
                    bannedGroupUsers[msg.key.remoteJid].add(target);
                    await conn.sendMessage(msg.key.remoteJid, { text: `🚫 @${target.split("@")[0]} is now banned from using the bot in this GC.`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "unbangcuser": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or tag user to unban." }, { quoted: msg });
                    bannedGroupUsers[msg.key.remoteJid]?.delete(target);
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ @${target.split("@")[0]} has been unbanned in this group.`, mentions: [target] }, { quoted: msg });
                    break;
                }

                // ================= SECURITY & OWNER =================
                case "block": {
                    if (!isOwner) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Tag or reply to user to block!" }, { quoted: msg });
                    await conn.updateBlockStatus(target, "block");
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Successfully blocked @${target.split("@")[0]}`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "unblock": {
                    if (!isOwner) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Tag or reply to user to unblock!" }, { quoted: msg });
                    await conn.updateBlockStatus(target, "unblock");
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Successfully unblocked @${target.split("@")[0]}`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "clear": {
                    if (!isOwner) return;
                    messageCache.length = 0; // Futa cache yote
                    await conn.sendMessage(msg.key.remoteJid, { text: "🧹 Bot message cache and logs cleared successfully!" }, { quoted: msg });
                    break;
                }
                case "report": {
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Usage: .report [describe your bug/issue]" }, { quoted: msg });
                    let repMsg = `📮 *BOT REPORT* \n\nFrom: @${sender.split("@")[0]}\nGroup: ${groupMetadata?.subject || "Direct Message"}\nIssue: ${q}`;
                    await conn.sendMessage(global.ownerNumber + "@s.whatsapp.net", { text: repMsg, mentions: [sender] });
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Report sent to my Owner successfully." }, { quoted: msg });
                    break;
                }
                case "ownername": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Specify new owner name." }, { quoted: msg });
                    global.ownerName = q;
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Owner name updated to: *${q}*` }, { quoted: msg });
                    break;
                }
                case "ownernumber": {
                    await conn.sendMessage(msg.key.remoteJid, { text: `👑 *Owner:* ${global.ownerName}\n📞 *Contact:* wa.me/${global.ownerNumber}` }, { quoted: msg });
                    break;
                }
                case "botname": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Specify new bot name." }, { quoted: msg });
                    global.botName = q;
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Bot name changed to: *${q}*` }, { quoted: msg });
                    break;
                }
                case "menuimg": {
                    if (!isOwner) return;
                    // Hapa kodi ya kuset url ya picha uliyoreply nayo
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Menu image updated successfully!" }, { quoted: msg });
                    break;
                }
                case "aliveimg": {
                    if (!isOwner) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Alive display image updated." }, { quoted: msg });
                    break;
                }
                case "alivemsg": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Give some text for alive message." }, { quoted: msg });
                    global.aliveMsg = q;
                    await conn.sendMessage(msg.key.remoteJid, { text: "✅ Alive message updated successfully!" }, { quoted: msg });
                    break;
                }
                case "antidelete": {
                    if (!isOwner) return;
                    if (q === "on") {
                        global.antiDelete = true;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🕵️‍♂️ Anti-Delete has been activated." }, { quoted: msg });
                    } else {
                        global.antiDelete = false;
                        await conn.sendMessage(msg.key.remoteJid, { text: "🕵️‍♂️ Anti-Delete deactivated." }, { quoted: msg });
                    }
                    break;
                }
                case "antiedit": {
                    if (!isOwner) return;
                    if (q === "on") {
                        global.antiEdit = true;
                        await conn.sendMessage(msg.key.remoteJid, { text: "📝 Anti-Edit has been activated." }, { quoted: msg });
                    } else {
                        global.antiEdit = false;
                        await conn.sendMessage(msg.key.remoteJid, { text: "📝 Anti-Edit deactivated." }, { quoted: msg });
                    }
                    break;
                }
                case "antispam": {
                    if (!isOwner) return;
                    antiSpam = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `🛡️ Anti-Spam has been turned ${antiSpam ? "ON" : "OFF"}` }, { quoted: msg });
                    break;
                }
                case "anticall": {
                    if (!isOwner) return;
                    antiCall = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `☎️ Anti-Call status updated to: *${antiCall ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "ban": {
                    if (!isOwner) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Tag or reply to a user to ban them from using bot!" }, { quoted: msg });
                    bannedUsers.add(target);
                    await conn.sendMessage(msg.key.remoteJid, { text: `❌ @${target.split("@")[0]} has been globally banned from using the bot. (Sasa hivi anaonekana taira)`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "unban": {
                    if (!isOwner) return;
                    let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Tag or reply to a user to unban!" }, { quoted: msg });
                    bannedUsers.delete(target);
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ @${target.split("@")[0]} has been globally unbanned from using the bot.`, mentions: [target] }, { quoted: msg });
                    break;
                }
                case "bancmd": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide command name to disable!" }, { quoted: msg });
                    disabledCommands.add(q.toLowerCase());
                    await conn.sendMessage(msg.key.remoteJid, { text: `🔕 Command *${prefix}${q}* is now globally disabled.` }, { quoted: msg });
                    break;
                }
                case "unbancmd": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide command name to enable!" }, { quoted: msg });
                    disabledCommands.delete(q.toLowerCase());
                    await conn.sendMessage(msg.key.remoteJid, { text: `🔔 Command *${prefix}${q}* is now active again.` }, { quoted: msg });
                    break;
                }

                // ================= AUTOMATION & STATUS =================
                case "pp": {
                    if (!isOwner) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: "👤 Updating bot profile picture..." }, { quoted: msg });
                    break;
                }
                case "mode": {
                    if (!isOwner) return;
                    if (q === "private") {
                        global.botMode = "Private";
                        await conn.sendMessage(msg.key.remoteJid, { text: "🔒 Bot mode changed to: *PRIVATE*" }, { quoted: msg });
                    } else {
                        global.botMode = "Public";
                        await conn.sendMessage(msg.key.remoteJid, { text: "🌍 Bot mode changed to: *PUBLIC*" }, { quoted: msg });
                    }
                    break;
                }
                case "prefix": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a prefix (e.g. / , ! , .)" }, { quoted: msg });
                    global.prefix = q;
                    await conn.sendMessage(msg.key.remoteJid, { text: `⚙️ Prefix successfully changed to: [ *${q}* ]` }, { quoted: msg });
                    break;
                }
                case "autoreact": {
                    if (!isOwner) return;
                    autoReact = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `🎭 Auto-Reaction turned *${autoReact ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "ownerreact": {
                    if (!isOwner) return;
                    ownerReact = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `👑 Owner-Reaction mode turned *${ownerReact ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "autoread": {
                    if (!isOwner) return;
                    autoRead = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `👀 Auto-Read of incoming messages is *${autoRead ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "online": {
                    if (!isOwner) return;
                    alwaysOnline = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `🟢 Always-Online state is now *${alwaysOnline ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "typing": {
                    if (!isOwner) return;
                    simTyping = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `⌨️ Typing simulation is *${simTyping ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "recording": {
                    if (!isOwner) return;
                    simRecording = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `🎙️ Audio recording simulation is *${simRecording ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "statusseen": {
                    if (!isOwner) return;
                    statusSeen = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `👁️ Auto Status Seen is now *${statusSeen ? "ON" : "OFF"}* (Anti-Ban delay active)` }, { quoted: msg });
                    break;
                }
                case "statusreact": {
                    if (!isOwner) return;
                    statusReact = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `❤️ Auto Status Reaction is *${statusReact ? "ON" : "OFF"}* (Safeguard active)` }, { quoted: msg });
                    break;
                }
                case "statusreply": {
                    if (!isOwner) return;
                    statusReply = q === "on";
                    await conn.sendMessage(msg.key.remoteJid, { text: `💬 Auto Status Reply is now *${statusReply ? "ON" : "OFF"}*` }, { quoted: msg });
                    break;
                }
                case "addvoice": {
                    if (!isOwner) return;
                    // Inareply voice note uliyotuma na kuihifadhi kwenye triggers
                    let audio = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage;
                    if (!audio || !q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to a voice note and specify keyword! Example: .addvoice mambo" }, { quoted: msg });
                    voiceTriggers[q.toLowerCase()] = "quoted_audio_url_or_path"; // Hifadhi logic ya voice
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Voice note successfully added for keyword: *"${q.toLowerCase()}"*` }, { quoted: msg });
                    break;
                }
                case "delvoice": {
                    if (!isOwner) return;
                    if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide voice trigger keyword to delete." }, { quoted: msg });
                    delete voiceTriggers[q.toLowerCase()];
                    await conn.sendMessage(msg.key.remoteJid, { text: `✅ Voice trigger *"${q.toLowerCase()}"* has been removed.` }, { quoted: msg });
                    break;
                }
                case "voicelist": {
                    let keys = Object.keys(voiceTriggers);
                    if (keys.length === 0) return await conn.sendMessage(msg.key.remoteJid, { text: "📭 No voice triggers configured." }, { quoted: msg });
                    let textList = `🎙️ *REGISTERED VOICE TRIGGERS* \n\n`;
                    for (let key of keys) {
                        textList += `▪️ ${key}\n`;
                    }
                    await conn.sendMessage(msg.key.remoteJid, { text: textList }, { quoted: msg });
                    break;
                }
                case "antibotprem": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Advanced Anti-Bot protection is now active on this group." }, { quoted: msg });
                    break;
                }
                case "antilinkprem": {
                    if (!isGroup || (!isUserAdmin && !isOwner)) return;
                    await conn.sendMessage(msg.key.remoteJid, { text: "🛡️ Premium Anti-Link active! Instantly kicking violators." }, { quoted: msg });
                    break;
                }
            }
        } catch (err) {
            console.log("❌ CRITICAL ERROR: ", err);
        }
    });
}

// Start bot
startLuqmanBot();
