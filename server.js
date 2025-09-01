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
        this.reconnectDelay = 10000;
        
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
            
            // Envia status completo para o cliente conectado
            this.emitStatus();
            
            // CORRIGIDO: Eventos do socket com nomes padronizados
            socket.on('connect_whatsapp', () => {
                this.connectWhatsApp();
            });

            socket.on('disconnect_whatsapp', () => {
                this.disconnectWhatsApp();
            });

            socket.on('restart_connection', () => {
                this.restartConnection();
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

            // CORRIGIDO: Eventos de status e dados
            socket.on('get_status', () => {
                this.emitStatus();
            });

            socket.on('get_groups', () => {
                this.emitGroups();
            });

            socket.on('get_schedules', () => {
                this.emitSchedules();
            });

            // CORRIGIDO: Toggle de grupo
            socket.on('toggle_group', (groupId) => {
                const group = this.groups.get(groupId);
                if (group) {
                    group.active = !group.active;
                    this.saveData();
                    this.emitGroups();
                    this.io.emit('log', { 
                        message: `Grupo "${group.name}" foi ${group.active ? 'ATIVADO' : 'DESATIVADO'}!`, 
                        type: group.active ? 'success' : 'info' 
                    });
                }
            });

            socket.on('disconnect', () => {
                console.log('Cliente desconectado:', socket.id);
            });
        });
    }

    // NOVO: Método para emitir status completo
    emitStatus() {
        this.io.emit('status', {
            connected: this.isConnected,
            connecting: this.isConnecting,
            connectionState: this.connectionState,
            autoScheduleEnabled: this.autoScheduleEnabled,
            totalGroups: this.groups.size,
            activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
            lastVideo: this.lastVideoId,
            reconnectAttempts: this.reconnectAttempts
        });
    }

    // NOVO: Método para emitir grupos
    emitGroups() {
        const groupsArray = Array.from(this.groups.entries()).map(([id, data]) => ({
            id,
            name: data.name,
            active: data.active,
            participants: data.participants || 0
        }));
        
        this.io.emit('groups_updated', groupsArray);
    }

    // NOVO: Método para emitir agendamentos
    emitSchedules() {
        const schedulesArray = Array.from(this.schedules.entries()).map(([id, data]) => ({
            id,
            cron: data.cron,
            type: data.type,
            description: data.description,
            created: data.created
        }));
        
        this.io.emit('schedules_updated', schedulesArray);
    }

    setupRoutes() {
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

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
        this.connectionState = 'connecting';
        
        // CORRIGIDO: Emitir eventos corretos
        this.io.emit('connecting');
        this.emitStatus();
        this.io.emit('log', { message: 'Iniciando conexão com WhatsApp (Baileys)...', type: 'info' });

        try {
            // Garantir que o diretório existe
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            console.log(`Usando WA v${version.join('.')}, é a mais recente: ${isLatest}`);

            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }),
                printQRInTerminal: false, // IMPORTANTE: Sempre false
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
                generateHighQualityLinkPreview: false,
                // ADICIONADO: Configurações para melhor estabilidade
                getMessage: async (key) => {
                    return { conversation: 'Bot message' };
                }
            });

            this.setupBaileysEvents(saveCreds);
            
        } catch (error) {
            console.error('Erro na inicialização:', error);
            this.isConnecting = false;
            this.connectionState = 'close';
            this.emitStatus();
            this.io.emit('error', { message: 'Erro na conexão: ' + error.message });
        }
    }

    setupBaileysEvents(saveCreds) {
        if (!this.sock) return;

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log('Connection update:', connection, 'QR:', !!qr);
            this.connectionState = connection || this.connectionState;
            
            // CORRIGIDO: QR Code handling
            if (qr) {
                console.log('🔲 QR Code gerado');
                try {
                    const qrDataURL = await qrcode.toDataURL(qr, {
                        width: 300,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });
                    
                    this.qrCode = qrDataURL;
                    
                    // CORRIGIDO: Emitir com o nome correto esperado pelo frontend
                    this.io.emit('qr', qrDataURL);
                    this.io.emit('log', { message: 'QR Code gerado! Escaneie para conectar.', type: 'info' });
                    
                } catch (error) {
                    console.error('Erro ao gerar QR Code:', error);
                    this.io.emit('error', { message: 'Erro ao gerar QR Code: ' + error.message });
                }
            }

            if (connection === 'close') {
                this.isConnected = false;
                this.isConnecting = false;
                this.qrCode = null;
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = this.getDisconnectReason(statusCode);
                
                console.log('Conexão fechada:', reason, 'Reconectando:', shouldReconnect);
                
                // CORRIGIDO: Emitir evento correto
                this.io.emit('disconnected');
                this.emitStatus();
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
                
                console.log('✅ WhatsApp conectado com sucesso!');
                
                // CORRIGIDO: Emitir evento correto
                this.io.emit('connected');
                this.emitStatus();
                this.io.emit('log', { message: 'WhatsApp conectado com sucesso!', type: 'success' });
                
                // Carregar grupos após conexão
                setTimeout(() => {
                    this.loadGroups();
                    if (!this.autoScheduleEnabled) {
                        this.setupAutoSchedule();
                    }
                }, 3000);
                
            } else if (connection === 'connecting') {
                this.io.emit('log', { message: 'Conectando ao WhatsApp...', type: 'info' });
            }
            
            // Sempre emitir status atualizado
            this.emitStatus();
        });

        this.sock.ev.on('creds.update', saveCreds);

        // ADICIONADO: Melhor handling de mensagens
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

        // ADICIONADO: Melhor handling de grupos
        this.sock.ev.on('groups.update', async (updates) => {
            for (const update of updates) {
                if (this.groups.has(update.id)) {
                    const groupData = this.groups.get(update.id);
                    if (update.subject) {
                        groupData.name = update.subject;
                        this.saveData();
                        this.emitGroups();
                    }
                }
            }
        });
    }

    // NOVO: Função para obter razão da desconexão
    getDisconnectReason(statusCode) {
        const reasons = {
            [DisconnectReason.badSession]: 'Sessão inválida',
            [DisconnectReason.connectionClosed]: 'Conexão fechada',
            [DisconnectReason.connectionLost]: 'Conexão perdida',
            [DisconnectReason.connectionReplaced]: 'Conexão substituída',
            [DisconnectReason.loggedOut]: 'Usuário deslogado',
            [DisconnectReason.restartRequired]: 'Reinicialização necessária',
            [DisconnectReason.timedOut]: 'Tempo esgotado'
        };
        return reasons[statusCode] || 'Motivo desconhecido';
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        
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
        
        this.io.emit('disconnected');
        this.emitStatus();
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
            let newGroupsCount = 0;
            
            for (const [id, group] of Object.entries(groups)) {
                if (!this.groups.has(id)) {
                    newGroupsCount++;
                    this.groups.set(id, {
                        name: group.subject,
                        active: false,
                        participants: group.participants?.length || 0
                    });
                } else {
                    // Atualizar dados existentes
                    const existingGroup = this.groups.get(id);
                    existingGroup.name = group.subject;
                    existingGroup.participants = group.participants?.length || 0;
                }
            }
            
            this.saveData();
            this.emitGroups();
            
            this.io.emit('log', { 
                message: `${this.groups.size} grupos carregados (${newGroupsCount} novos)`, 
                type: 'success' 
            });
            
        } catch (error) {
            console.error('Erro ao carregar grupos:', error);
            this.io.emit('error', { message: 'Erro ao carregar grupos: ' + error.message });
        }
    }

    async getLatestVideo() {
        try {
            const url = `https://www.googleapis.com/youtube/v3/search?key=${this.youtubeApiKey}&channelId=${this.channelId}&order=date&part=snippet&type=video&maxResults=1`;
            const response = await axios.get(url, { timeout: 15000 });
            
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
                await this.delay(3000);
            }
            
            this.io.emit('log', { message: `🎉 SUCESSO! Vídeo enviado para ${sentCount}/${activeGroups.length} grupos!`, type: 'success' });
            
            // CORRIGIDO: Emitir evento correto
            this.io.emit('video_sent', { 
                title: videoData.title,
                groups: sentCount
            });
        } else {
            this.io.emit('log', { message: 'Nenhum vídeo novo encontrado (já foi enviado)', type: 'info' });
        }
        
        // CORRIGIDO: Emitir evento correto
        this.io.emit('video_checked', { 
            newVideo: videoData.isNew || forceCheck,
            title: videoData.title
        });
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
            this.emitStatus();

            this.io.emit('log', { message: '⏰ Agendamento automático ATIVADO! (08h, 12h, 18h)', type: 'success' });
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
        this.emitStatus();

        this.io.emit('log', { message: '⏰ Agendamento automático DESATIVADO!', type: 'warning' });
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
            this.emitSchedules();

            this.io.emit('log', { message: `📅 Agendamento personalizado criado: ${cronExpr}`, type: 'success' });
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
            this.emitSchedules();
            this.io.emit('log', { message: `🗑️ Agendamento removido com sucesso!`, type: 'success' });
        } else {
            this.io.emit('log', { message: 'Agendamento não encontrado!', type: 'error' });
        }
    }

    async testVideo() {
        this.io.emit('log', { message: '🧪 Testando conexão com YouTube...', type: 'info' });
        
        const videoData = await this.getLatestVideo();
        
        if (videoData) {
            this.io.emit('log', { message: `✅ Vídeo encontrado: ${videoData.title}`, type: 'success' });
            // CORRIGIDO: Emitir evento correto
            this.io.emit('video_test', { 
                success: true,
                videos: 1,
                videoData: videoData
            });
        } else {
            this.io.emit('log', { message: '❌ ERRO! Não foi possível buscar vídeos.', type: 'error' });
            this.io.emit('video_test', { 
                success: false,
                error: 'Não foi possível buscar vídeos'
            });
        }
    }

    cleanSession() {
        this.disconnectWhatsApp();
        
        try {
            if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true });
                this.io.emit('log', { message: '🗑️ Sessão removida com sucesso!', type: 'success' });
                this.io.emit('session_cleaned');
            } else {
                this.io.emit('log', { message: 'Nenhuma sessão encontrada para limpar.', type: 'info' });
            }
        } catch (error) {
            this.io.emit('log', { message: 'Erro ao limpar sessão: ' + error.message, type: 'error' });
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

    // Sistema de Keep-Alive melhorado
    startKeepAlive() {
        // Verificar status da conexão a cada 30 segundos
        setInterval(() => {
            if (this.isConnected && this.sock) {
                try {
                    // Ping para manter conexão ativa
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

        // Emitir status periodicamente para clientes conectados
        setInterval(() => {
            this.emitStatus();
        }, 60000); // A cada minuto
    }

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

    async forceReconnect() {
        this.io.emit('log', { message: '🔄 Forçando reconexão...', type: 'warning' });
        
        this.disconnectWhatsApp();
        await this.delay(3000);
        await this.connectWhatsApp();
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

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
        // Middleware para logs de requisições
        this.app.use((req, res, next) => {
            console.log(`${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
            next();
        });

        // Iniciar o servidor
        this.server.listen(port, '0.0.0.0', () => {
            console.log('🚀 ================================');
            console.log(`🚀 Servidor rodando na porta ${port}`);
            console.log(`🌐 Acesse: http://localhost:${port}`);
            console.log('🚀 YouTube WhatsApp Bot - Baileys');
            console.log('🚀 ================================');
        });

        // Conectar automaticamente ao iniciar (opcional)
        setTimeout(() => {
            console.log('🔄 Iniciando conexão automática...');
            // Descomente a linha abaixo se quiser conectar automaticamente
            // this.connectWhatsApp();
        }, 3000);

        // Handlers para encerramento graceful
        const gracefulShutdown = () => {
            console.log('\n🛑 Encerrando bot graciosamente...');
            
            // Parar todos os agendamentos
            this.schedules.forEach(schedule => {
                if (schedule.task) {
                    schedule.task.stop();
                }
            });
            
            // Desconectar WhatsApp
            this.disconnectWhatsApp();
            
            // Fechar servidor
            this.server.close(() => {
                console.log('✅ Servidor encerrado');
                process.exit(0);
            });
        };

        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);

        // Handler para erros não capturados
        process.on('uncaughtException', (error) => {
            console.error('❌ Erro não capturado:', error);
            this.io.emit('error', { message: 'Erro crítico: ' + error.message });
            
            // Não encerrar o processo, apenas logar
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ Promise rejeitada:', reason);
            this.io.emit('error', { message: 'Promise rejeitada: ' + reason });
        });

        // Monitoramento de memória
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            
            if (memMB > 200) { // Mais de 200MB
                console.warn(`⚠️ Alto uso de memória: ${memMB}MB`);
                this.io.emit('log', { 
                    message: `Alto uso de memória detectado: ${memMB}MB`, 
                    type: 'warning' 
                });
            }
        }, 300000); // Verificar a cada 5 minutos
    }
}

// Inicialização
const bot = new YouTubeWhatsAppBotServer();
bot.start(process.env.PORT || 3000);

module.exports = YouTubeWhatsAppBotServer;