const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');

class YouTubeWhatsAppBotServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        this.client = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.groups = new Map();
        this.schedules = new Map();
        this.youtubeApiKey = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
        this.channelId = "UCh-ceOeY4WVgS8R0onTaXmw";
        this.dataFile = './bot_data.json';
        this.lastVideoId = null;
        this.autoScheduleEnabled = false;
        this.qrCode = null;
        
        this.setupExpress();
        this.setupSocket();
        this.setupRoutes();
        this.loadData();
        this.initializeClient();
    }

    setupExpress() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    setupSocket() {
        this.io.on('connection', (socket) => {
            console.log('Cliente conectado:', socket.id);
            
            // Envia status atual para o cliente que se conectou
            socket.emit('status', {
                isConnected: this.isConnected,
                isConnecting: this.isConnecting,
                autoScheduleEnabled: this.autoScheduleEnabled,
                qrCode: this.qrCode,
                totalGroups: this.groups.size,
                activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
                lastVideoId: this.lastVideoId
            });

            // Eventos do socket
            socket.on('connect_whatsapp', () => {
                this.connectWhatsApp();
            });

            socket.on('disconnect_whatsapp', () => {
                this.disconnectWhatsApp();
            });

            socket.on('activate_group', (groupName) => {
                this.activateGroup(groupName);
            });

            socket.on('deactivate_group', (groupName) => {
                this.deactivateGroup(groupName);
            });

            socket.on('check_videos', () => {
                this.checkAndSendNewVideos(false);
            });

            socket.on('force_send', () => {
                this.checkAndSendNewVideos(true);
            });

            socket.on('toggle_auto_schedule', () => {
                if (this.autoScheduleEnabled) {
                    this.disableAutoSchedule();
                } else {
                    this.setupAutoSchedule();
                }
            });

            socket.on('test_video', () => {
                this.testVideo();
            });

            socket.on('clean_session', () => {
                this.cleanSession();
            });

            socket.on('create_schedule', (cronExpr) => {
                this.createCustomSchedule(cronExpr);
            });

            socket.on('remove_schedule', (scheduleId) => {
                this.removeSchedule(scheduleId);
            });
        });
    }

    setupRoutes() {
        // Página principal
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // API Routes
        this.app.get('/api/status', (req, res) => {
            res.json({
                isConnected: this.isConnected,
                isConnecting: this.isConnecting,
                autoScheduleEnabled: this.autoScheduleEnabled,
                totalGroups: this.groups.size,
                activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
                lastVideoId: this.lastVideoId
            });
        });

        this.app.get('/api/groups', (req, res) => {
            const groupsArray = Array.from(this.groups.entries()).map(([id, data]) => ({
                id,
                name: data.name,
                active: data.active
            }));
            res.json(groupsArray);
        });

        this.app.get('/api/schedules', (req, res) => {
            const schedulesArray = Array.from(this.schedules.entries()).map(([id, data]) => ({
                id,
                cron: data.cron,
                type: data.type,
                description: data.description,
                created: data.created
            }));
            res.json(schedulesArray);
        });

        this.app.post('/api/connect', async (req, res) => {
            try {
                await this.connectWhatsApp();
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.post('/api/disconnect', (req, res) => {
            this.disconnectWhatsApp();
            res.json({ success: true });
        });
    }

    initializeClient() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: "youtube-bot-web"
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });

        this.setupClientEvents();
    }

    setupClientEvents() {
        this.client.on('qr', async (qr) => {
            console.log('QR Code gerado');
            try {
                this.qrCode = await qrcode.toDataURL(qr);
                this.io.emit('qr_code', { qrCode: this.qrCode });
            } catch (error) {
                console.error('Erro ao gerar QR Code:', error);
            }
        });

        this.client.on('ready', async () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.qrCode = null;
            console.log('WhatsApp conectado!');
            
            await this.loadGroups();
            this.setupAutoSchedule();
            
            this.io.emit('connected', {
                isConnected: this.isConnected,
                totalGroups: this.groups.size
            });
        });

        this.client.on('authenticated', () => {
            console.log('Autenticado com sucesso');
            this.io.emit('authenticated');
        });

        this.client.on('auth_failure', (msg) => {
            this.isConnecting = false;
            console.log('Falha na autenticação:', msg);
            this.io.emit('auth_failure', { message: msg });
        });

        this.client.on('disconnected', (reason) => {
            this.isConnected = false;
            this.isConnecting = false;
            console.log('Desconectado:', reason);
            this.io.emit('disconnected', { reason });
        });

        this.client.on('message_create', async (message) => {
            if (message.fromMe) return;
            
            if (message.body === '!status' && message.from.includes('@g.us')) {
                const chat = await message.getChat();
                if (chat.isGroup) {
                    const groupInfo = this.groups.get(chat.id._serialized);
                    const status = groupInfo?.active ? '🟢 ATIVO' : '🔴 INATIVO';
                    const autoStatus = this.autoScheduleEnabled ? '🟢 ATIVADO' : '🔴 DESATIVADO';
                    message.reply(`🤖 Disparador Status: ${status}\n📋 Grupo: ${chat.name}\n⏰ Envio Automático: ${autoStatus}\n🕒 Horários: 08:00, 12:00, 18:00\n\n✨ Wallysson Studio DV 2025`);
                }
            }
        });
    }

    async connectWhatsApp() {
        if (this.isConnected) {
            this.io.emit('log', { message: 'Já está conectado ao WhatsApp!', type: 'warning' });
            return;
        }

        if (this.isConnecting) {
            this.io.emit('log', { message: 'Conexão em andamento...', type: 'info' });
            return;
        }

        this.isConnecting = true;
        this.io.emit('connecting');
        this.io.emit('log', { message: 'Iniciando conexão com WhatsApp...', type: 'info' });

        try {
            await this.client.initialize();
        } catch (error) {
            this.isConnecting = false;
            this.io.emit('error', { message: 'Erro na conexão: ' + error.message });
        }
    }

    disconnectWhatsApp() {
        if (this.client) {
            this.client.destroy();
        }
        this.isConnected = false;
        this.isConnecting = false;
        this.qrCode = null;
        
        this.io.emit('disconnected', { reason: 'Manual disconnect' });
        this.io.emit('log', { message: 'Desconectado do WhatsApp', type: 'info' });
    }

    async loadGroups() {
        try {
            const chats = await this.client.getChats();
            this.groups.clear();
            
            for (const chat of chats) {
                if (chat.isGroup) {
                    this.groups.set(chat.id._serialized, {
                        name: chat.name,
                        active: false,
                        chat: chat
                    });
                }
            }
            
            this.io.emit('groups_loaded', {
                groups: Array.from(this.groups.entries()).map(([id, data]) => ({
                    id,
                    name: data.name,
                    active: data.active
                }))
            });
            
            this.io.emit('log', { message: `${this.groups.size} grupos carregados`, type: 'success' });
        } catch (error) {
            this.io.emit('error', { message: 'Erro ao carregar grupos: ' + error.message });
        }
    }

    activateGroup(groupName) {
        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            if (group[1].active) {
                this.io.emit('log', { message: `Grupo "${group[1].name}" já está ativo!`, type: 'warning' });
            } else {
                group[1].active = true;
                this.saveData();
                this.io.emit('log', { message: `Grupo "${group[1].name}" foi ATIVADO!`, type: 'success' });
                this.io.emit('group_updated', { groupId: group[0], active: true });
            }
        } else {
            this.io.emit('log', { message: 'Grupo não encontrado!', type: 'error' });
        }
    }

    deactivateGroup(groupName) {
        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            if (!group[1].active) {
                this.io.emit('log', { message: `Grupo "${group[1].name}" já está inativo!`, type: 'warning' });
            } else {
                group[1].active = false;
                this.saveData();
                this.io.emit('log', { message: `Grupo "${group[1].name}" foi DESATIVADO!`, type: 'info' });
                this.io.emit('group_updated', { groupId: group[0], active: false });
            }
        } else {
            this.io.emit('log', { message: 'Grupo não encontrado!', type: 'error' });
        }
    }

    async getLatestVideo() {
        try {
            const url = `https://www.googleapis.com/youtube/v3/search?key=${this.youtubeApiKey}&channelId=${this.channelId}&order=date&part=snippet&type=video&maxResults=1`;
            const response = await axios.get(url);
            
            if (response.data.items && response.data.items.length > 0) {
                const video = response.data.items[0];
                const videoId = video.id.videoId;
                const title = video.snippet.title;
                const thumbnail = video.snippet.thumbnails.high.url;
                const link = `https://www.youtube.com/watch?v=${videoId}`;

                return {
                    videoId,
                    title,
                    thumbnail,
                    link,
                    isNew: videoId !== this.lastVideoId
                };
            }
            return null;
        } catch (error) {
            this.io.emit('error', { message: 'Erro ao buscar vídeo no YouTube: ' + error.message });
            return null;
        }
    }

    async sendVideoToGroup(groupId, videoData) {
        if (!this.client || !this.isConnected) {
            return false;
        }

        try {
            const group = this.groups.get(groupId);
            if (!group) {
                return false;
            }

            const message = `🚨 *VÍDEO NOVO DO PR MARCELO OLIVEIRA!*\n\n🎬 *${videoData.title}*\n\n👉 *Assista agora:* ${videoData.link}\n\n🙏 Compartilhe com família e amigos!\n\n✨ *Deus abençoe!*\n\n━━━━━━━━━━━━━━━━━━\n`;
            
            await this.client.sendMessage(groupId, message);
            return true;
        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);
            return false;
        }
    }

    async checkAndSendNewVideos(forceCheck = false) {
        if (!this.isConnected) {
            this.io.emit('log', { message: 'WhatsApp não está conectado!', type: 'error' });
            return;
        }

        this.io.emit('log', { message: 'Verificando novos vídeos no YouTube...', type: 'info' });
        
        const videoData = await this.getLatestVideo();
        if (!videoData) {
            this.io.emit('log', { message: 'Nenhum vídeo encontrado no canal', type: 'warning' });
            return;
        }

        if (videoData.isNew || forceCheck) {
            if (forceCheck && !videoData.isNew) {
                this.io.emit('log', { message: `ENVIO MANUAL FORÇADO: ${videoData.title}`, type: 'info' });
            } else {
                this.io.emit('log', { message: `NOVO VÍDEO ENCONTRADO: ${videoData.title}`, type: 'success' });
                this.lastVideoId = videoData.videoId;
                this.saveData();
            }

            const activeGroups = Array.from(this.groups.entries()).filter(([id, data]) => data.active);
            
            if (activeGroups.length === 0) {
                this.io.emit('log', { message: 'Nenhum grupo ativo!', type: 'warning' });
                return;
            }

            this.io.emit('log', { message: `Enviando para ${activeGroups.length} grupos...`, type: 'info' });
            let sentCount = 0;
            
            for (const [groupId, groupData] of activeGroups) {
                this.io.emit('log', { message: `Enviando para: ${groupData.name}`, type: 'info' });
                const success = await this.sendVideoToGroup(groupId, videoData);
                if (success) {
                    sentCount++;
                    this.io.emit('log', { message: `Enviado com sucesso para ${groupData.name}`, type: 'success' });
                } else {
                    this.io.emit('log', { message: `Falha no envio para ${groupData.name}`, type: 'error' });
                }
                await this.delay(3000);
            }
            
            this.io.emit('log', { message: `SUCESSO! Vídeo enviado para ${sentCount}/${activeGroups.length} grupos!`, type: 'success' });
            this.io.emit('video_sent', { videoData, sentCount, totalGroups: activeGroups.length });
        } else {
            this.io.emit('log', { message: 'Nenhum vídeo novo encontrado (já foi enviado)', type: 'info' });
        }
    }

    setupAutoSchedule() {
        if (this.autoScheduleEnabled) {
            this.io.emit('log', { message: 'Agendamento automático já está ativo!', type: 'info' });
            return;
        }

        try {
            const scheduleConfigs = [
                { time: '0 8 * * *', id: 'auto_08h', desc: 'Envio automático - 08:00' },
                { time: '0 12 * * *', id: 'auto_12h', desc: 'Envio automático - 12:00' },
                { time: '0 18 * * *', id: 'auto_18h', desc: 'Envio automático - 18:00' }
            ];

            for (const config of scheduleConfigs) {
                const task = cron.schedule(config.time, () => {
                    this.io.emit('log', { message: `VERIFICAÇÃO AUTOMÁTICA - ${config.desc}`, type: 'info' });
                    this.checkAndSendNewVideos();
                });

                this.schedules.set(config.id, {
                    cron: config.time,
                    task: task,
                    created: new Date().toISOString(),
                    type: 'auto',
                    description: config.desc
                });
            }

            this.autoScheduleEnabled = true;
            this.saveData();

            this.io.emit('log', { message: 'Agendamento automático ATIVADO! (08h, 12h, 18h)', type: 'success' });
            this.io.emit('auto_schedule_changed', { enabled: true });
        } catch (error) {
            this.io.emit('error', { message: 'Erro ao configurar agendamentos: ' + error.message });
        }
    }

    disableAutoSchedule() {
        const autoScheduleIds = ['auto_08h', 'auto_12h', 'auto_18h'];
        
        for (const id of autoScheduleIds) {
            const schedule = this.schedules.get(id);
            if (schedule && schedule.task) {
                schedule.task.stop();
                this.schedules.delete(id);
            }
        }

        this.autoScheduleEnabled = false;
        this.saveData();

        this.io.emit('log', { message: 'Agendamento automático DESATIVADO!', type: 'warning' });
        this.io.emit('auto_schedule_changed', { enabled: false });
    }

    createCustomSchedule(cronExpr) {
        const scheduleId = Date.now().toString();

        try {
            const task = cron.schedule(cronExpr, () => {
                this.io.emit('log', { message: `VERIFICAÇÃO AUTOMÁTICA PERSONALIZADA: ${cronExpr}`, type: 'info' });
                this.checkAndSendNewVideos();
            }, {
                scheduled: false
            });

            this.schedules.set(scheduleId, {
                cron: cronExpr,
                task: task,
                created: new Date().toISOString(),
                type: 'custom',
                description: `Agendamento personalizado: ${cronExpr}`
            });

            task.start();
            this.saveData();

            this.io.emit('log', { message: `Agendamento personalizado criado: ${cronExpr}`, type: 'success' });
            this.io.emit('schedule_created', { 
                id: scheduleId, 
                cron: cronExpr, 
                type: 'custom',
                description: `Agendamento personalizado: ${cronExpr}`,
                created: new Date().toISOString()
            });
        } catch (error) {
            this.io.emit('error', { message: 'Expressão de horário inválida!' });
        }
    }

    removeSchedule(scheduleId) {
        if (scheduleId.startsWith('auto_')) {
            this.io.emit('log', { message: 'Não é possível remover agendamentos automáticos!', type: 'error' });
            return;
        }

        const schedule = this.schedules.get(scheduleId);
        if (schedule) {
            schedule.task.stop();
            this.schedules.delete(scheduleId);
            this.saveData();
            this.io.emit('log', { message: `Agendamento removido com sucesso!`, type: 'success' });
            this.io.emit('schedule_removed', { id: scheduleId });
        } else {
            this.io.emit('log', { message: 'Agendamento não encontrado!', type: 'error' });
        }
    }

    async testVideo() {
        this.io.emit('log', { message: 'Testando conexão com YouTube...', type: 'info' });
        
        const videoData = await this.getLatestVideo();
        
        if (videoData) {
            this.io.emit('log', { message: `Vídeo encontrado: ${videoData.title}`, type: 'success' });
            this.io.emit('video_test', { 
                videoData: videoData,
                isNew: videoData.isNew
            });
        } else {
            this.io.emit('log', { message: 'ERRO! Não foi possível buscar vídeos.', type: 'error' });
        }
    }

    cleanSession() {
        if (this.client) {
            this.disconnectWhatsApp();
        }
        
        const sessionDir = './.wwebjs_auth';
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            this.io.emit('log', { message: 'Sessão removida com sucesso!', type: 'success' });
        } else {
            this.io.emit('log', { message: 'Nenhuma sessão encontrada para limpar.', type: 'info' });
        }
    }

    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                this.lastVideoId = data.lastVideoId || null;
                this.autoScheduleEnabled = data.autoScheduleEnabled || false;
                console.log('Configurações carregadas!');
            }
        } catch (error) {
            console.error('Erro ao carregar configurações:', error.message);
        }
    }

    saveData() {
        try {
            const data = {
                lastVideoId: this.lastVideoId,
                autoScheduleEnabled: this.autoScheduleEnabled,
                savedAt: new Date().toISOString()
            };
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar configurações:', error.message);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    start(port = 3000) {
        this.server.listen(port, () => {
            console.log(`🚀 Servidor rodando na porta ${port}`);
            console.log(`🌐 Acesse: http://localhost:${port}`);
        });
    }
}

// Inicialização
const bot = new YouTubeWhatsAppBotServer();
bot.start(process.env.PORT || 3000);

module.exports = YouTubeWhatsAppBotServer;