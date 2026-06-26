const baileys = require("@whiskeysockets/baileys");
const {
    default: makeWASocket,
    useMultiFileAuthState
} = baileys;
const fs = require("fs");

const BOT_NAME = "LUQMAN X MD";
const PREFIX = ".";
const ADMIN_NUMBERS = [
    "255678716839@s.whatsapp.net"
];

async function startBot() {
    // Inatengeneza folda ya session inayoitwa 'session_id' kiotomatiki
    const { state, saveCreds } = await useMultiFileAuthState('session_id');
    
    const sock = makeWASocket({
        auth: state,
        // Marekesho ya browser ili kuzuia error 428 / Connection Closed
        browser: ["Mac OS", "Chrome", "10.15.7"],
        printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    // Mfumo wa kuomba Pairing Code kiotomatiki kama boti haijasajiliwa
    if (!sock.authStatus || !sock.authState.creds.registered) {
        const phoneNumber = "255678716839"; // Namba yako ya simu
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================\n`);
                console.log(`YOUR PAIRING CODE: ${code}`);
                console.log(`\n========================================\n`);
            } catch (error) {
                console.log("Imeshindwa kuomba Pairing Code, subiri kidogo au restart upya:", error.message);
            }
        }, 3000);
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log("Muunganisho umekatika. Sababu:", lastDisconnect?.error, ". Inajaribu kuwaka upya:", shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log(`Boti ya ${BOT_NAME} imewaka na imeunganishwa kikamilifu!`);
        }
    });

    // Seva ndogo (Basic Web Server) kwa ajili ya Hugging Face / Render ili isizime (Port binding)
    const express = require('express');
    const app = express();
    const PORT = process.env.PORT || 7860;
    app.get('/', (req, res) => res.send('Bot is Running Live!'));
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

startBot();
