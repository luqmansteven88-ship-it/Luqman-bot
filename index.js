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
        if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be an admin to demote users." });
        let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
        if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or mention the user you want to demote." });
        await conn.groupParticipantsUpdate(msg.key.remoteJid, [target], "demote");
        await conn.sendMessage(msg.key.remoteJid, { text: `📉 @${target.split("@")[0]} has been demoted to a regular member.`, mentions: [target] });
        break;
    }
            }
                  case "invitelink": {
            if (!isGroup) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be an admin to get the invite link." });
            const code = await conn.groupInviteCode(msg.key.remoteJid);
            await conn.sendMessage(msg.key.remoteJid, { text: `🔗 *Group Invite Link:*\nhttps://chat.whatsapp.com/${code}` });
            break;
        }
        case "revokelink": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be an admin to reset the link." });
            await conn.groupRevokeInvite(msg.key.remoteJid);
            await conn.sendMessage(msg.key.remoteJid, { text: "✅ Group invite link has been reset successfully!" });
            break;
        }
        case "setname": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be admin." });
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Please provide a new name for the group." });
            await conn.groupUpdateSubject(msg.key.remoteJid, q);
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Group name updated to: *${q}*` });
            break;
        }
        case "setgdesc": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be admin." });
            await conn.groupUpdateDescription(msg.key.remoteJid, q || "");
            await conn.sendMessage(msg.key.remoteJid, { text: "✅ Group description updated successfully." });
            break;
        }
        case "tagall": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            let text = `📢 *ATTENTION EVERYONE* \n\n${q ? `💬 *Message:* ${q}\n\n` : ""}`;
            let mentions = [];
            for (let mem of groupMetadata.participants) {
                text += `▪️ @${mem.id.split("@")[0]}\n`;
                mentions.push(mem.id);
            }
            await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: mentions });
            break;
        }
        case "tagadmin": {
            if (!isGroup) return;
            let text = `👮 *ATTENTION ADMINS*\n\n${q ? `💬 *Message:* ${q}\n\n` : ""}`;
            let mentions = [];
            for (let admin of groupAdmins) {
                text += `▪️ @${admin.split("@")[0]}\n`;
                mentions.push(admin);
            }
            await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: mentions });
            break;
        }
        case "members": {
            if (!isGroup) return;
            let text = `👥 *GROUP MEMBERS LIST*\nTotal: *${groupMetadata.participants.length}*\n\n`;
            let mentions = [];
            for (let mem of groupMetadata.participants) {
                text += `▪️ @${mem.id.split("@")[0]}\n`;
                mentions.push(mem.id);
            }
            await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: mentions });
            break;
        }
        case "groupinfo": {
            if (!isGroup) return;
            let desc = groupMetadata.desc || "No description set.";
            let info = `ℹ️ *GROUP INFO*\n\n📝 *Name:* ${groupMetadata.subject}\n👥 *Members:* ${groupMetadata.participants.length}\n👑 *Owner:* @${groupMetadata.owner ? groupMetadata.owner.split("@")[0] : "None"}\n\n*Description:*\n${desc}`;
            await conn.sendMessage(msg.key.remoteJid, { text: info, mentions: groupMetadata.owner ? [groupMetadata.owner] : [] });
            break;
        }
        case "antilink": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (q === "on") {
                global.antiLink = true;
                await conn.sendMessage(msg.key.remoteJid, { text: "✅ Anti-link activated." });
            } else if (q === "off") {
                global.antiLink = false;
                await conn.sendMessage(msg.key.remoteJid, { text: "❌ Anti-link deactivated." });
            } else {
                await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Use 'on' or 'off' to toggle Anti-link." });
            }
            break;
        }
        case "antibot": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (q === "on") {
                global.antiBot = true;
                await conn.sendMessage(msg.key.remoteJid, { text: "✅ Anti-bot activated." });
            } else if (q === "off") {
                global.antiBot = false;
                await conn.sendMessage(msg.key.remoteJid, { text: "❌ Anti-bot deactivated." });
            } else {
                await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Use 'on' or 'off' to toggle Anti-bot." });
            }
            break;
        }
        case "leave": {
            if (!isOwner) return;
            await conn.sendMessage(msg.key.remoteJid, { text: "👋 Goodbye! Leaving the group..." });
            await conn.groupLeave(msg.key.remoteJid);
            break;
        }
        case "announce": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be admin." });
            await conn.groupSettingUpdate(msg.key.remoteJid, "announcement");
            await conn.sendMessage(msg.key.remoteJid, { text: "🔒 Group closed. Only admins can send messages now." });
            break;
        }
        case "editgc": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            if (!isBotAdmin) return await conn.sendMessage(msg.key.remoteJid, { text: "❌ Bot needs to be admin." });
            await conn.groupSettingUpdate(msg.key.remoteJid, "not_announcement");
            await conn.sendMessage(msg.key.remoteJid, { text: "🔓 Group opened. All members can send messages." });
            break;
        }
        case "count": {
            if (!isGroup) return;
            await conn.sendMessage(msg.key.remoteJid, { text: `📊 This group has *${groupMetadata.participants.length}* members.` });
            break;
        }
        case "delete": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            let targetKey = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
            if (!targetKey) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to the message you want to delete." });
            await conn.sendMessage(msg.key.remoteJid, { delete: { remoteJid: msg.key.remoteJid, fromMe: false, id: targetKey, participant: msg.message.extendedTextMessage.contextInfo.participant } });
            break;
        }
        case "myrole": {
            if (!isGroup) return;
            let role = isOwner ? "Owner" : (isUserAdmin ? "Admin" : "Regular Member");
            await conn.sendMessage(msg.key.remoteJid, { text: `🎭 Your role in this group is: *${role}*` });
            break;
        }
        case "adminlist": {
            if (!isGroup) return;
            let text = `👑 *CURRENT ADMINS*\n\n`;
            let mentions = [];
            for (let admin of groupAdmins) {
                text += `▪️ @${admin.split("@")[0]}\n`;
                mentions.push(admin);
            }
            await conn.sendMessage(msg.key.remoteJid, { text: text, mentions: mentions });
            break;
        }
        case "bangc": {
            if (!isOwner) return;
            bannedGroups.add(msg.key.remoteJid);
            await conn.sendMessage(msg.key.remoteJid, { text: "🚫 This group has been banned from using the bot." });
            break;
        }
        case "unbangc": {
            if (!isOwner) return;
            bannedGroups.delete(msg.key.remoteJid);
            await conn.sendMessage(msg.key.remoteJid, { text: "✅ This group has been unbanned successfully." });
            break;
        }
        case "banguser": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or mention the user you want to ban." });
            bannedGroupUsers[msg.key.remoteJid] = bannedGroupUsers[msg.key.remoteJid] || [];
            bannedGroupUsers[msg.key.remoteJid].push(target);
            await conn.sendMessage(msg.key.remoteJid, { text: `🚫 @${target.split("@")[0]} has been banned from using the bot in this group.`, mentions: [target] });
            break;
        }
        case "unbanguser": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or mention the user you want to unban." });
            if (bannedGroupUsers[msg.key.remoteJid]) {
                bannedGroupUsers[msg.key.remoteJid] = bannedGroupUsers[msg.key.remoteJid].filter(u => u !== target);
            }
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ @${target.split("@")[0]} has been unbanned successfully.`, mentions: [target] });
            break;
    }
              // ============================== SECURITY & SETTINGS ==============================
        case "block": {
            if (!isOwner) return;
            let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or mention the user you want to block." });
            await conn.updateBlockStatus(target, "block");
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Blocked @${target.split("@")[0]} successfully.`, mentions: [target] });
            break;
        }
        case "unblock": {
            if (!isOwner) return;
            let target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!target) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to or mention the user you want to unblock." });
            await conn.updateBlockStatus(target, "unblock");
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Unblocked @${target.split("@")[0]} successfully.`, mentions: [target] });
            break;
        }
        case "clear": {
            if (!isOwner) return;
            // logic ya kuclear cache ya meseji kama ipo
            await conn.sendMessage(msg.key.remoteJid, { text: "🧹 Bot message cache cleared successfully!" });
            break;
        }
        case "report": {
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a message to report to the owner." });
            let repMsg = `🚨 *BOT REPORT*\n\n👤 *From:* @${msg.key.participant ? msg.key.participant.split("@")[0] : msg.key.remoteJid.split("@")[0]}\n💬 *Message:* ${q}`;
            await conn.sendMessage(global.ownerNumber + "@s.whatsapp.net", { text: repMsg, mentions: [msg.key.participant || msg.key.remoteJid] });
            await conn.sendMessage(msg.key.remoteJid, { text: "✅ Report sent to the owner successfully." });
            break;
        }
        case "ownername": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Please specify a new owner name." });
            global.ownerName = q;
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Owner name changed to: *${q}*` });
            break;
        }
        case "ownernumber": {
            await conn.sendMessage(msg.key.remoteJid, { text: `👑 The owner's number is: *${global.ownerNumber}*` });
            break;
        }
        case "botname": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Please specify a new bot name." });
            global.botName = q;
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Bot name changed to: *${q}*` });
            break;
        }
        case "menuimg": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide image URL to set as menu image." });
            global.menuImg = q;
            await conn.sendMessage(msg.key.remoteJid, { text: "🖼️ Menu image updated successfully." });
            break;
        }
        case "aliveimg": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide image URL to set as alive image." });
            global.aliveImg = q;
            await conn.sendMessage(msg.key.remoteJid, { text: "🖼️ Alive image updated successfully." });
            break;
        }
        case "alivemsg": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a message for the alive command." });
            global.aliveMsg = q;
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Alive message changed to: *${q}*` });
            break;
        }
        case "antidelete": {
            if (!isOwner) return;
            if (q === "on") {
                global.antiDelete = true;
                await conn.sendMessage(msg.key.remoteJid, { text: "✅ Anti-delete activated." });
            } else if (q === "off") {
                global.antiDelete = false;
                await conn.sendMessage(msg.key.remoteJid, { text: "❌ Anti-delete deactivated." });
            } else {
                await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Use 'on' or 'off' to toggle Anti-delete." });
            }
            break;
        }
        case "antiedit": {
            if (!isOwner) return;
            if (q === "on") {
                global.antiEdit = true;
                await conn.sendMessage(msg.key.remoteJid, { text: "✅ Anti-edit activated." });
            } else if (q === "off") {
                global.antiEdit = false;
                await conn.sendMessage(msg.key.remoteJid, { text: "❌ Anti-edit deactivated." });
            } else {
                await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Use 'on' or 'off' to toggle Anti-edit." });
            }
            break;
        }
            case "prefix": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Please provide a prefix (e.g., . or !)" });
            global.prefix = q;
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Prefix changed to: *${q}*` });
            break;
        }
        case "autoreact": {
            if (!isOwner) return;
            global.autoReact = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Auto-react is now *${global.autoReact ? "ON" : "OFF"}*` });
            break;
        }
        case "ownerreact": {
            if (!isOwner) return;
            global.ownerReact = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Owner-react is now *${global.ownerReact ? "ON" : "OFF"}*` });
            break;
        }
        case "autoread": {
            if (!isOwner) return;
            global.autoRead = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Auto-read is now *${global.autoRead ? "ON" : "OFF"}*` });
            break;
        }
        case "online": {
            if (!isOwner) return;
            global.alwaysOnline = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Always Online is now *${global.alwaysOnline ? "ON" : "OFF"}*` });
            break;
        }
        case "typing": {
            if (!isOwner) return;
            global.simTyping = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Simulating Typing is now *${global.simTyping ? "ON" : "OFF"}*` });
            break;
        }
        case "recording": {
            if (!isOwner) return;
            global.simRecording = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Simulating Recording is now *${global.simRecording ? "ON" : "OFF"}*` });
            break;
        }
        case "statusseen": {
            if (!isOwner) return;
            global.statusSeen = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Auto Status Seen is now *${global.statusSeen ? "ON" : "OFF"}*` });
            break;
        }
        case "statusreact": {
            if (!isOwner) return;
            global.statusReact = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Status React is now *${global.statusReact ? "ON" : "OFF"}*` });
            break;
        }
        case "statusreply": {
            if (!isOwner) return;
            global.statusReply = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Status Reply is now *${global.statusReply ? "ON" : "OFF"}*` });
            break;
        }
        case "addvoice": {
            if (!isOwner) return;
            let mime = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage?.mimetype;
            if (!mime) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Reply to a voice note you want to save." });
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide a trigger word for this voice note." });
            let audio = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            global.voiceTriggers = global.voiceTriggers || {};
            global.voiceTriggers[q.toLowerCase()] = audio;
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Voice trigger added for: *${q.toLowerCase()}*` });
            break;
        }
        case "delvoice": {
            if (!isOwner) return;
            if (!q) return await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Provide the trigger word to delete." });
            if (global.voiceTriggers && global.voiceTriggers[q.toLowerCase()]) {
                delete global.voiceTriggers[q.toLowerCase()];
                await conn.sendMessage(msg.key.remoteJid, { text: `✅ Voice trigger for *${q.toLowerCase()}* has been deleted.` });
            } else {
                await conn.sendMessage(msg.key.remoteJid, { text: "⚠️ Trigger word not found." });
            }
            break;
        }
        case "voicelist": {
            let keys = Object.keys(global.voiceTriggers || {});
            if (keys.length === 0) {
                return await conn.sendMessage(msg.key.remoteJid, { text: "🎙️ No voice triggers saved yet." });
            }
            let textList = `🎙️ *SAVED VOICE TRIGGERS*\n\n`;
            for (let key of keys) {
                textList += `▪️ ${key}\n`;
            }
            await conn.sendMessage(msg.key.remoteJid, { text: textList });
            break;
        }
        case "antibotprem": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            global.antiBotPrem = global.antiBotPrem || {};
            global.antiBotPrem[msg.key.remoteJid] = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Premium Anti-bot is now *${global.antiBotPrem[msg.key.remoteJid] ? "ON" : "OFF"}*` });
            break;
        }
        case "antilinkprem": {
            if (!isGroup || (!isUserAdmin && !isOwner)) return;
            global.antiLinkPrem = global.antiLinkPrem || {};
            global.antiLinkPrem[msg.key.remoteJid] = q === "on";
            await conn.sendMessage(msg.key.remoteJid, { text: `✅ Premium Anti-link is now *${global.antiLinkPrem[msg.key.remoteJid] ? "ON" : "OFF"}*` });
            break;
        }
    } // Hili linafunga switch (command)
} catch (e) {
    console.error("❌ CRITICAL ERROR:", e);
}
}); // Hili linafunga conn.ev.on("messages.upsert")

conn.ev.on("creds.update", saveCreds);
}

startLuqmanBot();
          
             
