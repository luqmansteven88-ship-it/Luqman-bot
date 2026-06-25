const { default: makeWASocket, useMultiFileAuth } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");

const BOT_NAME = "LUQMAN X MD";
const FOOTER = "acha mzaha na maisha";
let PREFIX = ".";

// Namba yako ya owner kwa ajili ya ku-control bot
const ADMIN_NUMBERS = ["255678716839@s.whatsapp.net"];

async function startBot() {
    // Inatengeneza folder la session kuhifadhi login
    const { state, saveCreds } = await useMultiFileAuth("session");
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    // Mfumo wa kuomba pairing code moja kwa moja kwenye Render logs
    if (!sock.authState.creds.registered) {
        const phoneNumber = "255678716839"; // Namba yako inayopokea code
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n====================================\n`);
                console.log(`KODI YAKO YA PAIRING NI: ${code}`);
                console.log(`\n====================================\n`);
            } catch (err) {
                console.log("Imefeli kupata pairing code, inajaribu tena...", err);
            }
        }, 3000);
    }

    // Kusoma na kujibu meseji
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        const body = type === "conversation" ? msg.message.conversation : 
                     type === "extendedTextMessage" ? msg.message.extendedTextMessage.text : "";

        if (!body.startsWith(PREFIX)) return;
        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Kagua kama anayeandika ni Owner (Wewe)
        const isOwner = ADMIN_NUMBERS.includes(sender);

        // AMRI (COMMANDS)
        if (command === "ping") {
            await sock.sendMessage(from, { text: "Bot ipo hewani, Luqman!" });
        }

        // Mfano wa amri ya Owner pekee ya ku-control bot
        if (command === "eval") {
            if (!isOwner) return sock.sendMessage(from, { text: "Huna ruhusa, amri hii ni ya Owner pekee!" });
            const kodi_ya_kuendesha = args.join(" ");
            try {
                let evaled = eval(kodi_ya_kuendesha);
                if (typeof evaled !== "string") evaled = require("util").inspect(evaled);
                await sock.sendMessage(from, { text: evaled });
            } catch (err) {
                await sock.sendMessage(from, { text: String(err) });
            }
        }
    });
}

startBot();
