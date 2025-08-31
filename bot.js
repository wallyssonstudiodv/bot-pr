const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    MessageType
} = require('@whiskeysockets/baileys');
const P = require('pino');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const chalk = require('chalk');

class YouTubeWhatsAppBot {
    constructor() {
        this.sock = null;
        this.qr = null;
        this.groups = new Map();
        this.schedules = new Map();
        this.isConnected = false;
        this.isConnecting = false; // Novo flag para controlar conexão
        this.youtubeApiKey = "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs";
        this.channelId = "UCh-ceOeY4WVgS8R0onTaXmw";
        this.dataFile = './bot_data.json';
        this.lastVideoId = null;
        
        // Interface do terminal
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.loadData();
        this.setupCommands();
    }

    // Carrega dados salvos
    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                this.schedules = new Map(data.schedules || []);
                this.lastVideoId = data.lastVideoId || null;
                console.log(chalk.green('📊 Dados carregados com sucesso!'));
            }
        } catch (error) {
            console.log(chalk.red('⚠️ Erro ao carregar dados:'), error.message);
        }
    }

    // Salva dados
    saveData() {
        try {
            const data = {
                schedules: Array.from(this.schedules),
                lastVideoId: this.lastVideoId
            };
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.log(chalk.red('⚠️ Erro ao salvar dados:'), error.message);
        }
    }

    // Busca o último vídeo do canal
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

                // Baixa a thumbnail
                const imgResponse = await axios.get(thumbnail, { responseType: 'arraybuffer' });
                const base64 = Buffer.from(imgResponse.data).toString('base64');

                return {
                    videoId,
                    title,
                    thumbnail,
                    link,
                    base64,
                    isNew: videoId !== this.lastVideoId
                };
            }
            return null;
        } catch (error) {
            console.log(chalk.red('❌ Erro ao buscar vídeo:'), error.message);
            return null;
        }
    }

    // Envia mensagem com vídeo para um grupo
    async sendVideoToGroup(groupId, videoData) {
        if (!this.sock || !this.isConnected) {
            console.log(chalk.red('❌ Bot não conectado!'));
            return false;
        }

        try {
            const message = `🚨 Saiu vídeo novo no canal!\n\n🎬 *${videoData.title}*\n👉 Assista agora: ${videoData.link}\n\nCompartilhe com a família e amigos 🙏 Jesus abençoe!`;
            
            // Envia a mensagem de texto
            await this.sock.sendMessage(groupId, { text: message });
            
            // Envia a imagem com legenda
            const imageBuffer = Buffer.from(videoData.base64, 'base64');
            await this.sock.sendMessage(groupId, {
                image: imageBuffer,
                caption: `🆕 ${videoData.title}\n🎥 Assista: ${videoData.link}`
            });

            return true;
        } catch (error) {
            console.log(chalk.red(`❌ Erro ao enviar para ${groupId}:`), error.message);
            return false;
        }
    }

    // Verifica novos vídeos e envia
    async checkAndSendNewVideos() {
        console.log(chalk.blue('🔍 Verificando novos vídeos...'));
        
        const videoData = await this.getLatestVideo();
        if (!videoData) {
            console.log(chalk.yellow('⚠️ Nenhum vídeo encontrado'));
            return;
        }

        if (videoData.isNew) {
            console.log(chalk.green(`🆕 Novo vídeo encontrado: ${videoData.title}`));
            this.lastVideoId = videoData.videoId;
            this.saveData();

            // Envia para todos os grupos ativos
            for (const [groupId, groupData] of this.groups) {
                if (groupData.active) {
                    console.log(chalk.blue(`📤 Enviando para: ${groupData.name}`));
                    await this.sendVideoToGroup(groupId, videoData);
                    await this.delay(2000); // Delay entre envios
                }
            }
        } else {
            console.log(chalk.gray('📺 Nenhum vídeo novo encontrado'));
        }
    }

    // Delay helper
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Conecta ao WhatsApp
    async connectToWhatsApp() {
        if (this.isConnecting) {
            console.log(chalk.yellow('⏳ Já está conectando, aguarde...'));
            return;
        }

        this.isConnecting = true;

        try {
            const { state, saveCreds } = await useMultiFileAuthState('./auth');
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.macOS('Desktop'),
                auth: state,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 10000,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                markOnlineOnConnect: true
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qr = qr;
                    console.log(chalk.yellow('📱 QR Code gerado! Use o comando "qr" para visualizar.'));
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    this.isConnecting = false;
                    
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(chalk.red('❌ Conexão fechada.'));
                    console.log(chalk.gray(`Código: ${statusCode}, Reconectar: ${shouldReconnect}`));
                    
                    if (shouldReconnect) {
                        console.log(chalk.yellow('🔄 Tentando reconectar em 5 segundos...'));
                        setTimeout(() => {
                            this.connectToWhatsApp();
                        }, 5000);
                    } else {
                        console.log(chalk.red('🚪 Desconectado permanentemente. Use "connect" para reconectar.'));
                    }
                } else if (connection === 'open') {
                    this.isConnecting = false;
                    this.isConnected = true;
                    console.log(chalk.green('✅ Conectado ao WhatsApp!'));
                    await this.loadGroups();
                } else if (connection === 'connecting') {
                    console.log(chalk.blue('🔗 Conectando...'));
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

        } catch (error) {
            this.isConnecting = false;
            console.log(chalk.red('❌ Erro na conexão:'), error.message);
            
            // Tentar reconectar após erro
            setTimeout(() => {
                console.log(chalk.yellow('🔄 Tentando reconectar após erro...'));
                this.connectToWhatsApp();
            }, 10000);
        }
    }

    // Carrega grupos
    async loadGroups() {
        try {
            const groups = await this.sock.groupFetchAllParticipating();
            this.groups.clear();
            
            for (const [id, group] of Object.entries(groups)) {
                this.groups.set(id, {
                    name: group.subject,
                    active: false
                });
            }
            
            console.log(chalk.green(`📋 ${this.groups.size} grupos carregados!`));
        } catch (error) {
            console.log(chalk.red('❌ Erro ao carregar grupos:'), error.message);
        }
    }

    // Configura comandos do terminal
    setupCommands() {
        console.log(chalk.cyan('🤖 Bot YouTube WhatsApp iniciado!'));
        console.log(chalk.gray('Digite "help" para ver os comandos disponíveis.'));
        
        this.rl.on('line', async (input) => {
            const [command, ...args] = input.trim().split(' ');
            
            switch (command.toLowerCase()) {
                case 'help':
                    this.showHelp();
                    break;
                case 'connect':
                    if (this.isConnected) {
                        console.log(chalk.green('✅ Já está conectado!'));
                    } else if (this.isConnecting) {
                        console.log(chalk.yellow('⏳ Já está conectando, aguarde...'));
                    } else {
                        await this.connectToWhatsApp();
                    }
                    break;
                case 'disconnect':
                    this.disconnect();
                    break;
                case 'restart':
                    await this.restart();
                    break;
                case 'qr':
                    this.showQR();
                    break;
                case 'status':
                    this.showStatus();
                    break;
                case 'groups':
                    this.listGroups();
                    break;
                case 'activate':
                    this.activateGroup(args.join(' '));
                    break;
                case 'deactivate':
                    this.deactivateGroup(args.join(' '));
                    break;
                case 'schedule':
                    this.scheduleMessage(args);
                    break;
                case 'schedules':
                    this.listSchedules();
                    break;
                case 'remove':
                    this.removeSchedule(args[0]);
                    break;
                case 'test':
                    await this.testVideo();
                    break;
                case 'send':
                    await this.checkAndSendNewVideos();
                    break;
                case 'clear':
                    console.clear();
                    break;
                case 'exit':
                    this.exit();
                    break;
                default:
                    console.log(chalk.red('❌ Comando não reconhecido. Digite "help" para ajuda.'));
            }
            
            this.showPrompt();
        });

        this.showPrompt();
    }

    // Mostra ajuda
    showHelp() {
        console.log(chalk.cyan('\n📖 COMANDOS DISPONÍVEIS:'));
        console.log(chalk.white('connect         - Conecta ao WhatsApp'));
        console.log(chalk.white('disconnect      - Desconecta do WhatsApp'));
        console.log(chalk.white('restart         - Reinicia a conexão'));
        console.log(chalk.white('qr              - Mostra o QR Code'));
        console.log(chalk.white('status          - Status da conexão'));
        console.log(chalk.white('groups          - Lista todos os grupos'));
        console.log(chalk.white('activate <nome> - Ativa grupo para envios'));
        console.log(chalk.white('deactivate <nome> - Desativa grupo'));
        console.log(chalk.white('schedule <cron> - Agenda verificação (ex: 0 9,18 * * *)'));
        console.log(chalk.white('schedules       - Lista agendamentos'));
        console.log(chalk.white('remove <id>     - Remove agendamento'));
        console.log(chalk.white('test            - Testa busca de vídeo'));
        console.log(chalk.white('send            - Verifica e envia vídeos novos'));
        console.log(chalk.white('clear           - Limpa a tela'));
        console.log(chalk.white('exit            - Sair do bot\n'));
    }

    // Mostra QR Code
    showQR() {
        if (this.qr) {
            console.log(chalk.yellow('📱 Escaneie este QR Code:'));
            const qrcode = require('qrcode-terminal');
            qrcode.generate(this.qr, { small: true });
        } else {
            console.log(chalk.red('❌ Nenhum QR Code disponível.'));
        }
    }

    // Mostra status
    showStatus() {
        console.log(chalk.cyan('\n📊 STATUS DO BOT:'));
        console.log(chalk.white(`Conexão: ${this.isConnected ? chalk.green('✅ Conectado') : chalk.red('❌ Desconectado')}`));
        console.log(chalk.white(`Grupos: ${this.groups.size}`));
        console.log(chalk.white(`Grupos Ativos: ${Array.from(this.groups.values()).filter(g => g.active).length}`));
        console.log(chalk.white(`Agendamentos: ${this.schedules.size}`));
        console.log(chalk.white(`Último Vídeo ID: ${this.lastVideoId || 'Nenhum'}\n`));
    }

    // Lista grupos
    listGroups() {
        console.log(chalk.cyan('\n📋 GRUPOS DISPONÍVEIS:'));
        let index = 1;
        for (const [id, group] of this.groups) {
            const status = group.active ? chalk.green('🟢 ATIVO') : chalk.red('🔴 INATIVO');
            console.log(chalk.white(`${index}. ${group.name} - ${status}`));
            index++;
        }
        console.log();
    }

    // Ativa grupo
    activateGroup(groupName) {
        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            group[1].active = true;
            console.log(chalk.green(`✅ Grupo "${group[1].name}" ativado!`));
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
        }
    }

    // Desativa grupo
    deactivateGroup(groupName) {
        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            group[1].active = false;
            console.log(chalk.yellow(`🔴 Grupo "${group[1].name}" desativado!`));
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
        }
    }

    // Agenda mensagens
    scheduleMessage(args) {
        if (args.length === 0) {
            console.log(chalk.yellow('📅 Formato: schedule <cron_expression>'));
            console.log(chalk.gray('Exemplo: schedule "0 9,18 * * *" (às 9h e 18h todos os dias)'));
            return;
        }

        const cronExpr = args.join(' ').replace(/"/g, '');
        const scheduleId = Date.now().toString();

        try {
            const task = cron.schedule(cronExpr, () => {
                console.log(chalk.blue('⏰ Executando verificação agendada...'));
                this.checkAndSendNewVideos();
            }, {
                scheduled: false
            });

            this.schedules.set(scheduleId, {
                cron: cronExpr,
                task: task,
                created: new Date().toISOString()
            });

            task.start();
            this.saveData();

            console.log(chalk.green(`✅ Agendamento criado! ID: ${scheduleId}`));
            console.log(chalk.gray(`Expressão: ${cronExpr}`));
        } catch (error) {
            console.log(chalk.red('❌ Expressão cron inválida:'), error.message);
        }
    }

    // Lista agendamentos
    listSchedules() {
        console.log(chalk.cyan('\n📅 AGENDAMENTOS ATIVOS:'));
        if (this.schedules.size === 0) {
            console.log(chalk.gray('Nenhum agendamento ativo.'));
        } else {
            for (const [id, schedule] of this.schedules) {
                console.log(chalk.white(`ID: ${id}`));
                console.log(chalk.gray(`Cron: ${schedule.cron}`));
                console.log(chalk.gray(`Criado: ${new Date(schedule.created).toLocaleString()}\n`));
            }
        }
    }

    // Remove agendamento
    removeSchedule(id) {
        if (!id) {
            console.log(chalk.yellow('❌ Informe o ID do agendamento.'));
            return;
        }

        const schedule = this.schedules.get(id);
        if (schedule) {
            schedule.task.stop();
            this.schedules.delete(id);
            this.saveData();
            console.log(chalk.green(`✅ Agendamento ${id} removido!`));
        } else {
            console.log(chalk.red('❌ Agendamento não encontrado!'));
        }
    }

    // Testa busca de vídeo
    async testVideo() {
        console.log(chalk.blue('🧪 Testando busca de vídeo...'));
        const videoData = await this.getLatestVideo();
        
        if (videoData) {
            console.log(chalk.green('✅ Vídeo encontrado:'));
            console.log(chalk.white(`Título: ${videoData.title}`));
            console.log(chalk.white(`Link: ${videoData.link}`));
            console.log(chalk.white(`Novo: ${videoData.isNew ? 'Sim' : 'Não'}`));
        } else {
            console.log(chalk.red('❌ Nenhum vídeo encontrado.'));
        }
    }

    // Mostra prompt
    showPrompt() {
        process.stdout.write(chalk.cyan('\n🤖 Bot> '));
    }

    // Desconecta
    disconnect() {
        if (this.sock) {
            this.sock.end();
            this.sock = null;
        }
        this.isConnected = false;
        this.isConnecting = false;
        this.qr = null;
        console.log(chalk.yellow('🚪 Desconectado do WhatsApp'));
    }

    // Reinicia conexão
    async restart() {
        console.log(chalk.blue('🔄 Reiniciando conexão...'));
        this.disconnect();
        await this.delay(2000);
        await this.connectToWhatsApp();
    }

    // Sair
    exit() {
        console.log(chalk.yellow('👋 Encerrando bot...'));
        this.saveData();
        
        // Para todos os agendamentos
        for (const [id, schedule] of this.schedules) {
            schedule.task.stop();
        }
        
        // Desconecta
        this.disconnect();
        
        process.exit(0);
    }
}

// Inicia o bot
const bot = new YouTubeWhatsAppBot();

// Não conecta automaticamente - usuário deve usar comando "connect"
console.log(chalk.green('🤖 Bot iniciado! Digite "connect" para conectar ao WhatsApp.'));

module.exports = YouTubeWhatsAppBot;