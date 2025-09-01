const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, isJidBroadcast, jidNormalizedUser, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
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

        this.sock = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.connectionState = 'close';
        this.groups = new Map();
        this.schedules = new Map();
        this.youtubeApiKey = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
        this.channelId = "UCh-ceOeY4WVgS8R0onTaXmw";
        this.dataFile = './bot_data.json';
        this.lastVideoId = null;
        this.autoScheduleEnabled = false;
        this.qrCode = null;
        this.authDir = './auth_info_baileys';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 10000; // 10 segundos
        
        this.setupExpress();
        this.setupSocket();
        this.setupRoutes();
        this.loadData();
        this.startKeepAlive();
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
                connectionState: this.connectionState,
                autoScheduleEnabled: this.autoScheduleEnabled,
                qrCode: this.qrCode,
                totalGroups: this.groups.size,
                activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
                lastVideoId: this.lastVideoId,
                reconnectAttempts: this.reconnectAttempts
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

            socket.on('restart_connection', () => {
                this.restartConnection();
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
                connectionState: this.connectionState,
                autoScheduleEnabled: this.autoScheduleEnabled,
                totalGroups: this.groups.size,
                activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
                lastVideoId: this.lastVideoId,
                reconnectAttempts: this.reconnectAttempts
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

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                connection: {
                    state: this.connectionState,
                    isConnected: this.isConnected,
                    reconnectAttempts: this.reconnectAttempts
                }
            });
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
        this.io.emit('log', { message: 'Iniciando conexão com WhatsApp (Baileys)...', type: 'info' });

        try {
            // Garantir que o diretório de autenticação existe
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            console.log(`Usando WA v${version.join('.')}, é a mais recente: ${isLatest}`);

            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }), // Log silencioso
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
                },
                browser: ['YouTube Bot', 'Chrome', '3.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                fireInitQueries: false,
                emitOwnEvents: true,
                maxMsgRetryCount: 5,
                retryRequestDelayMs: 250,
                msgRetryCounterMap: {},
                generateHighQualityLinkPreview: false
            });

            this.setupBaileysEvents(saveCreds);
            
        } catch (error) {
            console.error('Erro na inicialização:', error);
            this.isConnecting = false;
            this.io.emit('error', { message: 'Erro na conexão: ' + error.message });
        }
    }

    setupBaileysEvents(saveCreds) {
        if (!this.sock) return;

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log('Connection update:', connection);
            this.connectionState = connection;
            
            if (qr) {
                console.log('QR Code gerado');
                try {
                    this.qrCode = await qrcode.toDataURL(qr);
                    this.io.emit('qr_code', { qrCode: this.qrCode });
                    this.io.emit('log', { message: 'QR Code gerado! Escaneie para conectar.', type: 'info' });
                } catch (error) {
                    console.error('Erro ao gerar QR Code:', error);
                }
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.isConnecting = false;
                this.qrCode = null;
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                const reason = lastDisconnect?.error?.output?.payload?.message || 'Desconhecido';
                
                console.log('Conexão fechada devido a:', reason, 'Reconectando...', shouldReconnect);
                this.io.emit('disconnected', { reason: reason });
                this.io.emit('log', { message: `Desconectado: ${reason}`, type: 'warning' });
                
                if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect();
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    this.io.emit('log', { message: 'Máximo de tentativas de reconexão atingido!', type: 'error' });
                    this.reconnectAttempts = 0;
                } else {
                    this.io.emit('log', { message: 'Usuário foi deslogado. Necessário novo QR Code.', type: 'warning' });
                }
            } else if (connection === 'open') {
                this.isConnected = true;
                this.isConnecting = false;
                this.qrCode = null;
                this.reconnectAttempts = 0;
                
                console.log('WhatsApp conectado com sucesso!');
                this.io.emit('connected', { isConnected: this.isConnected });
                this.io.emit('log', { message: 'WhatsApp conectado com sucesso!', type: 'success' });
                
                // Aguardar um pouco antes de carregar grupos
                setTimeout(() => {
                    this.loadGroups();
                    if (!this.autoScheduleEnabled) {
                        this.setupAutoSchedule();
                    }
                }, 3000);
            } else if (connection === 'connecting') {
                this.io.emit('log', { message: 'Conectando ao WhatsApp...', type: 'info' });
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (!message.message || message.key.fromMe) return;

            const messageText = message.message.conversation || 
                              message.message.extendedTextMessage?.text || '';
            
            if (messageText === '!status' && message.key.remoteJid?.endsWith('@g.us')) {
                try {
                    const groupMetadata = await this.sock.groupMetadata(message.key.remoteJid);
                    const groupInfo = this.groups.get(message.key.remoteJid);
                    const status = groupInfo?.active ? '🟢 ATIVO' : '🔴 INATIVO';
                    const autoStatus = this.autoScheduleEnabled ? '🟢 ATIVADO' : '🔴 DESATIVADO';
                    
                    const statusMessage = `🤖 Disparador Status: ${status}\n📋 Grupo: ${groupMetadata.subject}\n⏰ Envio Automático: ${autoStatus}\n🕒 Horários: 08:00, 12:00, 18:00\n\n✨ Wallysson Studio DV 2025`;
                    
                    await this.sock.sendMessage(message.key.remoteJid, { text: statusMessage });
                } catch (error) {
                    console.error('Erro ao responder status:', error);
                }
            }
        });

        // Event para grupos atualizados
        this.sock.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                if (this.groups.has(update.id)) {
                    const groupData = this.groups.get(update.id);
                    if (update.subject) {
                        groupData.name = update.subject;
                        this.saveData();
                    }
                }
            }
        });
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts; // Delay crescente
        
        this.io.emit('log', { 
            message: `Tentativa de reconexão ${this.reconnectAttempts}/${this.maxReconnectAttempts} em ${delay/1000}s...`, 
            type: 'info' 
        });
        
        setTimeout(() => {
            this.connectWhatsApp();
        }, delay);
    }

    restartConnection() {
        this.io.emit('log', { message: 'Reiniciando conexão...', type: 'info' });
        this.disconnectWhatsApp();
        setTimeout(() => {
            this.connectWhatsApp();
        }, 2000);
    }

    disconnectWhatsApp() {
        if (this.sock) {
            try {
                this.sock.end(undefined);
            } catch (error) {
                console.error('Erro ao desconectar:', error);
            }
            this.sock = null;
        }
        
        this.isConnected = false;
        this.isConnecting = false;
        this.qrCode = null;
        this.connectionState = 'close';
        
        this.io.emit('disconnected', { reason: 'Manual disconnect' });
        this.io.emit('log', { message: 'Desconectado do WhatsApp', type: 'info' });
    }

    async loadGroups() {
        if (!this.sock || !this.isConnected) {
            this.io.emit('log', { message: 'WhatsApp não conectado para carregar grupos', type: 'warning' });
            return;
        }

        try {
            this.io.emit('log', { message: 'Carregando grupos...', type: 'info' });
            
            const groups = await this.sock.groupFetchAllParticipating();
            this.groups.clear();
            
            for (const [id, group] of Object.entries(groups)) {
                this.groups.set(id, {
                    name: group.subject,
                    active: false,
                    participants: group.participants?.length || 0
                });
            }
            
            this.io.emit('groups_loaded', {
                groups: Array.from(this.groups.entries()).map(([id, data]) => ({
                    id,
                    name: data.name,
                    active: data.active,
                    participants: data.participants
                }))
            });
            
            this.io.emit('log', { message: `${this.groups.size} grupos carregados com sucesso!`, type: 'success' });
        } catch (error) {
            console.error('Erro ao carregar grupos:', error);
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
            const response = await axios.get(url, {
                timeout: 10000 // 10 segundos timeout
            });
            
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
            console.error('Erro ao buscar vídeo:', error);
            this.io.emit('error', { message: 'Erro ao buscar vídeo no YouTube: ' + error.message });
            return null;
        }
    }

    async sendVideoToGroup(groupId, videoData) {
        if (!this.sock || !this.isConnected) {
            return false;
        }

        try {
            const group = this.groups.get(groupId);
            if (!group) {
                return false;
            }

            const message = `🚨 *VÍDEO NOVO DO PR MARCELO OLIVEIRA!*\n\n🎬 *${videoData.title}*\n\n👉 *Assista agora:* ${videoData.link}\n\n🙏 Compartilhe com família e amigos!\n\n✨ *Deus abençoe!*\n\n━━━━━━━━━━━━━━━━━━\n`;
            
            await this.sock.sendMessage(groupId, { text: message });
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
                    this.io.emit('log', { message: `✅ Enviado para ${groupData.name}`, type: 'success' });
                } else {
                    this.io.emit('log', { message: `❌ Falha no envio para ${groupData.name}`, type: 'error' });
                }
                await this.delay(3000); // 3 segundos entre envios
            }
            
            this.io.emit('log', { message: `🎉 SUCESSO! Vídeo enviado para ${sentCount}/${activeGroups.length} grupos!`, type: 'success' });
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
                    this.io.emit('log', { message: `⏰ VERIFICAÇÃO AUTOMÁTICA - ${config.desc}`, type: 'info' });
                    this.checkAndSendNewVideos();
                }, {
                    scheduled: true,
                    timezone: "America/Sao_Paulo"
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

            this.io.emit('log', { message: '⏰ Agendamento automático ATIVADO! (08h, 12h, 18h)', type: 'success' });
            this.io.emit('auto_schedule_changed', { enabled: true });
        } catch (error) {
            console.error('Erro ao configurar agendamentos:', error);
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

        this.io.emit('log', { message: '⏰ Agendamento automático DESATIVADO!', type: 'warning' });
        this.io.emit('auto_schedule_changed', { enabled: false });
    }

    createCustomSchedule(cronExpr) {
        const scheduleId = Date.now().toString();

        try {
            const task = cron.schedule(cronExpr, () => {
                this.io.emit('log', { message: `⏰ VERIFICAÇÃO AUTOMÁTICA PERSONALIZADA: ${cronExpr}`, type: 'info' });
                this.checkAndSendNewVideos();
            }, {
                scheduled: false,
                timezone: "America/Sao_Paulo"
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

            this.io.emit('log', { message: `📅 Agendamento personalizado criado: ${cronExpr}`, type: 'success' });
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
            this.io.emit('log', { message: `🗑️ Agendamento removido com sucesso!`, type: 'success' });
            this.io.emit('schedule_removed', { id: scheduleId });
        } else {
            this.io.emit('log', { message: 'Agendamento não encontrado!', type: 'error' });
        }
    }

    async testVideo() {
        this.io.emit('log', { message: '🧪 Testando conexão com YouTube...', type: 'info' });
        
        const videoData = await this.getLatestVideo();
        
        if (videoData) {
            this.io.emit('log', { message: `✅ Vídeo encontrado: ${videoData.title}`, type: 'success' });
            this.io.emit('video_test', { 
                videoData: videoData,
                isNew: videoData.isNew
            });
        } else {
            this.io.emit('log', { message: '❌ ERRO! Não foi possível buscar vídeos.', type: 'error' });
        }
    }

    cleanSession() {
        this.disconnectWhatsApp();
        
        if (fs.existsSync(this.authDir)) {
            fs.rmSync(this.authDir, { recursive: true, force: true });
            this.io.emit('log', { message: '🗑️ Sessão removida com sucesso!', type: 'success' });
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
                
                // Carregar dados dos grupos ativos
                if (data.groups) {
                    for (const [groupId, groupData] of Object.entries(data.groups)) {
                        this.groups.set(groupId, groupData);
                    }
                }
                
                console.log('✅ Configurações carregadas!');
            }
        } catch (error) {
            console.error('❌ Erro ao carregar configurações:', error.message);
        }
    }

    saveData() {
        try {
            const groupsData = {};
            this.groups.forEach((value, key) => {
                groupsData[key] = value;
            });

            const data = {
                lastVideoId: this.lastVideoId,
                autoScheduleEnabled: this.autoScheduleEnabled,
                groups: groupsData,
                savedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('❌ Erro ao salvar configurações:', error.message);
        }
    }

    // Sistema de Keep-Alive para manter a conexão estável
    startKeepAlive() {
        // Verificar status da conexão a cada 30 segundos
        setInterval(() => {
            if (this.isConnected && this.sock) {
                try {
                    // Ping simples para manter conexão ativa
                    this.sock.sendPresenceUpdate('available');
                } catch (error) {
                    console.error('Erro no keep-alive:', error);
                    if (this.connectionState !== 'open') {
                        this.scheduleReconnect();
                    }
                }
            }
        }, 30000);

        // Verificar e reconectar se necessário a cada 2 minutos
        setInterval(() => {
            if (!this.isConnected && !this.isConnecting && this.connectionState === 'close') {
                this.io.emit('log', { message: '🔄 Tentando reconexão automática...', type: 'info' });
                this.connectWhatsApp();
            }
        }, 120000);
    }

    // Sistema de monitoramento de saúde da conexão
    async checkConnectionHealth() {
        if (!this.sock || !this.isConnected) {
            return false;
        }

        try {
            // Tentar uma operação simples para verificar se a conexão está ok
            const result = await Promise.race([
                this.sock.getBusinessProfile(this.sock.user?.id || ''),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
            return true;
        } catch (error) {
            console.error('Problema na conexão detectado:', error);
            return false;
        }
    }

    // Método para forçar reconexão
    async forceReconnect() {
        this.io.emit('log', { message: '🔄 Forçando reconexão...', type: 'warning' });
        
        this.disconnectWhatsApp();
        await this.delay(3000);
        await this.connectWhatsApp();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Função para obter estatísticas do bot
    getStats() {
        return {
            connectionState: this.connectionState,
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            totalGroups: this.groups.size,
            activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
            autoScheduleEnabled: this.autoScheduleEnabled,
            totalSchedules: this.schedules.size,
            lastVideoId: this.lastVideoId,
            reconnectAttempts: this.reconnectAttempts,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }

    start(port = 3000) {
        // Iniciar o servidor
        this.server.listen(port, () => {
            console.log('🚀 ================================');
            console.log(`🚀 Servidor rodando na porta ${port}`);
            console.log(`🌐 Acesse: http://localhost:${port}`);
            console.log('🚀 YouTube WhatsApp Bot - Baileys');
            console.log('🚀 ================================');
        });

        // Conectar automaticamente ao iniciar
        setTimeout(() => {
            this.connectWhatsApp();
        }, 2000);

        // Handlers para encerramento graceful
        process.on('SIGINT', () => {
            console.log('\n🛑 Encerrando bot...');
            this.disconnectWhatsApp();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Encerrando bot...');
            this.disconnectWhatsApp();
            process.exit(0);
        });

        // Handler para erros não capturados
        process.on('uncaughtException', (error) => {
            console.error('❌ Erro não capturado:', error);
            this.io.emit('error', { message: 'Erro crítico: ' + error.message });
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Promise rejeitada:', reason);
            this.io.emit('error', { message: 'Promise rejeitada: ' + reason });
        });
    }
}

// Inicialização
const bot = new YouTubeWhatsAppBotServer();
bot.start(process.env.PORT || 3000);

module.exports = YouTubeWhatsAppBotServer;