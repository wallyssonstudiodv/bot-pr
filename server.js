import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

import { 
    startBot, getGroups, getLastVideo, sendVideoToGroups, 
    scheduleVideo, getScheduled, deleteScheduled, getHistory 
} from "./bot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

await startBot();

app.get("/groups", async (req,res) => {
    try { res.json(await getGroups()); } catch(e){ res.json([]); }
});

app.get("/scheduled", (req,res)=>res.json(getScheduled()));
app.get("/history", (req,res)=>res.json(getHistory()));

app.post("/schedule", async (req,res)=>{
    const { groupIds, date, time } = req.body;
    scheduleVideo(groupIds, date, time);
    res.json({ message: "Agendamento criado com sucesso!" });
});

app.post("/scheduled/delete", (req,res)=>{
    const { index } = req.body;
    deleteScheduled(index);
    res.json({ message: "Agendamento deletado!" });
});

app.listen(3000, ()=>console.log("Servidor rodando na porta 3000"));