// Tumeivunja mifupi ili isikatwe na simu
const baileys = require(
  "@whiskeysockets/baileys"
);
const { 
  default: makeWASocket, 
  useMultiFileAuth 
} = baileys;

const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");

const BOT_NAME = "LUQMAN X MD";
const FOOTER = "acha mzaha na maisha";
let PREFIX = ".";

// Namba yako ya owner
const ADMIN_NUMBERS = [
  "255678716839@s.whatsapp.net"
];

async function startBot() {
    const { 
      state, 
      saveCreds 
    } = await useMultiFileAuth("session");
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
        // Namba yako ya owner hapa
        const phoneNumber = "255678716839"; 
        setTimeout(async () => {
            try {
                const code = await sock
                  .requestPairingCode(phoneNumber);
                console.log("\n====================\n");
                console.log("KODI YA PAIRING NI: " + code);
                console.log("\n====================\n");
            } catch (err) {
                console.log("Inajaribu tena...", err);
            }
        }, 5000); // Tumeongeza muda kuwa sekunde 5
    }

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        
        const body = type === "conversation" ? 
                     msg.message.conversation : 
                     type === "extendedTextMessage" ? 
                     msg.message.extendedTextMessage.text : "";

        if (!body.startsWith(PREFIX)) return;
        const args = body.slice(PREFIX.length)
          .trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const isOwner = ADMIN_NUMBERS.includes(sender);

        if (command === "ping") {
            await sock.sendMessage(from, { 
              text: "Bot ipo hewani, Luqman!" 
            });
        }

        if (command === "eval") {
            if (!isOwner) return sock.sendMessage(from, { 
              text: "Amri hii ni ya Owner pekee!" 
            });
            const kodi_ya_kuendesha = args.join(" ");
            try {
                let evaled = eval(kodi_ya_kuendesha);
                if (typeof evaled !== "string") 
                  evaled = require("util").inspect(evaled);
                await sock.sendMessage(from, { text: evaled });
            } catch (err) {
                await sock.sendMessage(from, { text: String(err) });
            }
        }
    });
}

startBot();

