import express from "express";
import fs from "fs";
import path from "path";
import qrcode from "qrcode";
import schedule from "node-schedule";
import { startBot, sock, getGroups, sendVideoToGroups, getLastVideo } from "./bot.js";

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Pastas de dados
const SCHEDULE_FILE = './data/scheduled.json';
const HISTORY_FILE = './data/history.json';
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(SCHEDULE_FILE)) fs.writeFileSync(SCHEDULE_FILE, JSON.stringify([]));
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));

// Variáveis para agendamentos
let scheduledJobs = [];

// Inicializa bot
startBot();

// Listar grupos ativos
app.get('/groups', async (req, res) => {
    const groups = await getGroups();
    res.json(groups);
});

// Listar agendamentos
app.get('/scheduled', (req, res) => {
    const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE));
    res.json(data);
});

// Listar histórico
app.get('/history', (req, res) => {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
    res.json(data);
});

// Agendar envio
app.post('/schedule', (req, res) => {
    const { groupIds, date, time, channelId } = req.body;
    const [hour, minute] = time.split(':').map(Number);
    const [year, month, day] = date.split('-').map(Number);
    const jobDate = new Date(year, month - 1, day, hour, minute);

    const job = schedule.scheduleJob(jobDate, async () => {
        const video = await getLastVideo(channelId);
        if (!video) return;

        const result = await sendVideoToGroups(groupIds, video);
        // Salvar no histórico
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE));
        history.push({
            date: new Date().toISOString(),
            groups: groupIds,
            video: video
        });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    });

    // Salvar agendamento
    const scheduled = JSON.parse(fs.readFileSync(SCHEDULE_FILE));
    scheduled.push({ groupIds, date, time, channelId });
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduled, null, 2));

    scheduledJobs.push({ job, groupIds, date, time, channelId });
    res.json({ success: true, message: 'Agendamento criado com sucesso!' });
});

// Deletar agendamento
app.post('/scheduled/delete', (req, res) => {
    const { index } = req.body;
    const scheduled = JSON.parse(fs.readFileSync(SCHEDULE_FILE));
    if (scheduled[index]) {
        scheduled.splice(index, 1);
        fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduled, null, 2));
        // Cancelar job
        if (scheduledJobs[index]) scheduledJobs[index].job.cancel();
        scheduledJobs.splice(index, 1);
        res.json({ success: true });
    } else res.json({ success: false, message: 'Agendamento não encontrado' });
});

app.listen(3000, () => console.log('Painel rodando em http://localhost:3000'));