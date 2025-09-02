import { makeWASocket, useSingleFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from "@whiskeysockets/baileys";
import fs from "fs";
import axios from "axios";
import path from "path";

const { state, saveState } = useSingleFileAuthState("./auth_info.json");

let sock;
let lastVideo = null;

export async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', update => {
        const { connection, qr } = update;
        if (qr) fs.writeFileSync('./public/qr.txt', `data:image/png;base64,${qr}`);
        if (connection === 'close') {
            const shouldReconnect = update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Conectado ao WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveState);
}

export async function getGroups() {
    if (!sock) throw new Error('Bot não conectado');
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups);
}

export async function getLastVideo() {
    // Use o canal que você quer
    const youtubeApiKey = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
    const canalId = "UCh-ceOeY4WVgS8R0onTaXmw";

    const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
            key: youtubeApiKey,
            channelId: canalId,
            order: "date",
            part: "snippet",
            type: "video",
            maxResults: 1
        }
    });

    if (!res.data.items || !res.data.items.length) throw new Error("Nenhum vídeo encontrado");

    const video = res.data.items[0];
    const videoId = video.id.videoId;
    const link = `https://www.youtube.com/watch?v=${videoId}`;
    lastVideo = { title: video.snippet.title, link };
    return lastVideo;
}

export async function sendVideoToGroups(groupIds, video) {
    if (!sock) throw new Error('Bot não conectado');
    for (let id of groupIds) {
        await sock.sendMessage(id, {
            text: `🚨 Novo vídeo!\n🎬 ${video.title}\nAssista: ${video.link}`
        });
    }
}