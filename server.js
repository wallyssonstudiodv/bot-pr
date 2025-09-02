import express from "express";
import path from "path";
import { startBot, getGroups, sendVideoToGroups, getLastVideo } from "./bot.js";

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

let scheduledJobs = [];

// Inicializa bot
startBot();

// Pega lista de grupos
app.get("/groups", async (req, res) => {
    try {
        const groups = await getGroups();
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Enviar vídeo agora
app.post("/send-video", async (req, res) => {
    const { groupIds } = req.body;
    try {
        const video = await getLastVideo();
        await sendVideoToGroups(groupIds, video);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Agendamento
app.post("/schedule-video", async (req, res) => {
    const { day, hour, minute } = req.body;
    scheduledJobs = scheduledJobs.filter(job => !(job.day === day && job.hour === hour && job.minute === minute));
    scheduledJobs.push({ day, hour, minute });
    res.json({ success: true, message: `Agendado para dia ${day} às ${hour}:${minute}` });
});

// Checa agendamentos a cada minuto
setInterval(async () => {
    const now = new Date();
    const day = now.getDay(), hour = now.getHours(), minute = now.getMinutes();
    for (let job of scheduledJobs) {
        if (job.day === day && job.hour === hour && job.minute === minute) {
            try {
                const groups = await getGroups();
                const groupIds = groups.map(g => g.id);
                const video = await getLastVideo();
                await sendVideoToGroups(groupIds, video);
                console.log(`Vídeo enviado automaticamente em ${hour}:${minute} do dia ${day}`);
            } catch (err) { console.error(err); }
        }
    }
}, 60000);

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));