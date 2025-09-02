import crypto from 'crypto';
import { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion 
} from "@whiskeysockets/baileys";
import fs from "fs";
import fetch from "node-fetch";
import qrcode from "qrcode";
import schedule from "node-schedule";

const SESSION_DIR = './sessions';
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

let sock;
let scheduledJobs = [];
let history = [];

// Config YouTube
const YOUTUBE_API_KEY = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
const CHANNEL_ID = "UCh-ceOeY4WVgS8R0onTaXmw";

export async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({ auth: state, version });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) qrcode.toDataURL(qr).then(url => fs.writeFileSync('public/qr.txt', url));
        if (connection === 'close') startBot();
        else if (connection === 'open') console.log('Conectado ao WhatsApp!');
    });

    sock.ev.on('creds.update', saveCreds);
}

export function getSock() { return sock; }

export async function getGroups() {
    if (!sock) throw new Error("Bot não conectado");
    const res = await sock.groupFetchAllParticipating();
    return Object.values(res).map(g => ({ id: g.id, name: g.subject }));
}

export async function getLastVideo() {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${CHANNEL_ID}&order=date&part=snippet&type=video&maxResults=1`;
    const res = await fetch(url).then(r => r.json());
    if (!res.items || !res.items.length) return null;
    const v = res.items[0];
    return {
        title: v.snippet.title,
        link: `https://www.youtube.com/watch?v=${v.id.videoId}`,
        thumbnail: v.snippet.thumbnails.high.url
    };
}

export async function sendVideoToGroups(groupsIds, video) {
    if (!sock) throw new Error("Bot não conectado");

    const imgData = await fetch(video.thumbnail).then(r => r.arrayBuffer());
    const buffer = Buffer.from(imgData);

    for (let id of groupsIds) {
        await sock.sendMessage(id, {
            image: buffer,
            caption: `🚨 Novo vídeo!\n🎬 ${video.title}\n👉 ${video.link}`
        });
    }

    history.push({ date: new Date(), groups: groupsIds, video });
}

export function scheduleVideo(groupsIds, date, time) {
    const [hour, minute] = time.split(':').map(Number);
    const [year, month, day] = date.split('-').map(Number);

    const jobDate = new Date(year, month - 1, day, hour, minute);
    const job = schedule.scheduleJob(jobDate, async () => {
        const video = await getLastVideo();
        if (video) await sendVideoToGroups(groupsIds, video);
    });

    scheduledJobs.push({ groupsIds, date, time, job });
}

export function deleteScheduled(index) {
    if (scheduledJobs[index]) {
        scheduledJobs[index].job.cancel();
        scheduledJobs.splice(index, 1);
    }
}

export function getScheduled() { 
    return scheduledJobs.map(s => ({
        date: s.date, time: s.time, groupsIds: s.groupsIds
    })); 
}

export function getHistory() { return history; }