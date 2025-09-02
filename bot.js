import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import fs from "fs";
import fetch from "node-fetch";

let sock;

const CHANNELS = [
    { id: "UCh-ceOeY4WVgS8R0onTaXmw", name: "Canal 1" },
    { id: "OUTRO_ID", name: "Canal 2" }
];

export async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_multi');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ version, printQRInTerminal: true, auth: state });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR gerado. Escaneie para conectar.");
            const url = await qrcode.toDataURL(qr);
            fs.writeFileSync('./public/qr.txt', url);
        }

        if (connection === 'close') {
            console.log('Conexão fechada. Reconectando...');
            startBot();
        }

        if (connection === 'open') {
            console.log('Bot conectado!');
        }
    });
}

export async function getGroups() {
    const chats = await sock.groupFetchAllParticipating();
    return Object.values(chats).map(g => ({ id: g.id, name: g.subject }));
}

export async function getLastVideo(channelId) {
    const YOUTUBE_API_KEY = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${channelId}&order=date&part=snippet&type=video&maxResults=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;
    const video = data.items[0];
    return {
        title: video.snippet.title,
        link: `https://www.youtube.com/watch?v=${video.id.videoId}`,
        thumbnail: video.snippet.thumbnails.high.url
    };
}

export async function sendVideoToGroups(groupIds, video) {
    const imgBuffer = await (await fetch(video.thumbnail)).buffer();
    for (let id of groupIds) {
        await sock.sendMessage(id, { image: imgBuffer, caption: `🚨 Vídeo novo!\n🎬 *${video.title}*\n👉 ${video.link}` });
    }
}