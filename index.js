index.js
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode-terminal")
const { exec } = require("child_process")
const BOT_NAME = "LUQMAN X MD"
const FOOTER = "acha mzaha na maisha"
let PREFIX = "." 
const ADMIN_NUMBERS = ["255678716839@s.whatsapp.net"] // Weka namba za wasaidizi hapa ukipenda
const maonyo = {}
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session")
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop')
    })
    sock.ev.on("creds.update", saveCreds)
    // MFUMO WA PAIRING CODE KWA AJILI YA RENDER
    if (!sock.authState.creds.registered) {
        const phoneNumber = "255678716839" // ⚠️ WEKA NAMBA YA SIMU YA BOT HAPA (Anza na 255)
        setTimeout(async () => {
            const code = await sock.requestPairingCode(phoneNumber)
            console.log(`\n🔥 PAIRING CODE YAKO NI: ${code}\n`)
        }, 3000)
    }
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") console.log(`🔥 ${BOT_NAME} IMEUNGANISHWA SALAMA!`)
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401
            if (shouldReconnect) startBot()
        }
    })
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0]
        if (!msg.message) return
        const sender = msg.key.remoteJid
        const isGroup = sender.endsWith("@g.us")
        const mtumishi = isGroup ? msg.key.participant : sender
        const isOwner = msg.key.fromMe || ADMIN_NUMBERS.includes(mtumishi)
        
        const text = msg.message.conversation || (msg.message.extendedTextMessage?.text) || ""
        if (!text.startsWith(PREFIX) && !isGroup) return
        
        const args = text.slice(PREFIX.length).trim().split(/ +/)
        const cmd = args.shift().toLowerCase()
        const isCmd = text.startsWith(PREFIX)
        async function pigaOnyo(userJid, sababu) {
            if (!isGroup) return
            if (!maonyo[userJid]) maonyo[userJid] = 0
            maonyo[userJid] += 1
            if (maonyo[userJid] >= 3) {
                await sock.sendMessage(sender, { text: `_🚨 *@${userJid.split("@")[0]}* Amefikisha maonyo 3/3! Anafutwa..._\n\n_${FOOTER}_`, mentions: [userJid] })
                await sock.groupParticipantsUpdate(sender, [userJid], "remove")
                maonyo[userJid] = 0
            } else {
                await sock.sendMessage(sender, { text: `_⚠️ *@${userJid.split("@")[0]}* Umepata Onyo (${maonyo[userJid]}/3)._\n_*Sababu:* ${sababu}._\n\n_${FOOTER}_`, mentions: [userJid] })
            }
        }
        if (isGroup && !isOwner) {
            if (text.includes("http://") || text.includes("https://") || text.includes("t.me/")) {
                try { await sock.sendMessage(sender, { delete: msg.key }); await pigaOnyo(mtumishi, "Kutuma Link"); } catch (e) {}
                return
            }
            if (text.length > 3000) {
                try { await sock.sendMessage(sender, { delete: msg.key }); await pigaOnyo(mtumishi, "Kutuma Spam/Bug"); } catch (e) {}
                return
            }
            if (text.includes("@everyone") || text.includes("@tagall") || text.includes("@status")) {
                try { await sock.sendMessage(sender, { delete: msg.key }); await pigaOnyo(mtumishi, "Kutag watu hovyo"); } catch (e) {}
                return
            }
        }
        if (isCmd && !isOwner) return 
        if (cmd === "menu") {
            const orodha_menu = `╭━━━〔 🛡️ *${BOT_NAME}* 〕━━━╮\n` +
                                `┃ ⚙️ *Prefix:* _\`${PREFIX}\`_\n` +
                                `├──━━━━━━━━━━━━━━\n` +
                                `┃ 🛡️ *ULINZI*\n` +
                                `┃ 🔓 _Anti-Link_\n` +
                                `┃ 🔓 _Anti-Spam/Bug_\n` +
                                `┃ 🔓 _Anti-Group/Status Mention_\n` +
                                `├──━━━━━━━━━━━━━━\n` +
                                `┃ 👑 *AMRI ZAKO*\n` +
                                `┃ ⚔️ _${PREFIX}kick_\n` +
                                `┃ ⚔️ _${PREFIX}delete_\n` +
                                `┃ ⚔️ _${PREFIX}warn_\n` +
                                `┃ ⚔️ _${PREFIX}ping_\n` +
                                `┃ ⚔️ _${PREFIX}prankkick_\n` +
                                `┃ ⚔️ _${PREFIX}update_\n` +
                                `╰━━━━━━━━━━━━━━━━╯\n` +
                                `_*_${FOOTER}_*`
            await sock.sendMessage(sender, { text: orodha_menu })
        }
        if (cmd === "ping") {
            const muda_wa_nyuma = Date.now()
            const kasi = Date.now() - muda_wa_nyuma + (M
