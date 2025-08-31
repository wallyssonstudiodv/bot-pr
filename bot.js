const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const fs = require('fs');
const cron = require('node-cron');
const axios = require('axios');
const chalk = require('chalk');

class YouTubeWhatsAppBot {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.groups = new Map();
        this.schedules = new Map();
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
        this.initializeClient();
    }

    // Inicializa o cliente WhatsApp
    initializeClient() {
        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: "youtube-bot"
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

    // Configura eventos do cliente
    setupClientEvents() {
        this.client.on('qr', (qr) => {
            console.log(chalk.yellow('📱 QR Code gerado! Escaneie com seu WhatsApp:'));
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', async () => {
            this.isConnected = true;
            this.isConnecting = false;
            console.log(chalk.green('✅ Cliente WhatsApp conectado e pronto!'));
            await this.loadGroups();
        });

        this.client.on('authenticated', () => {
            console.log(chalk.blue('🔐 Cliente autenticado!'));
        });

        this.client.on('auth_failure', (msg) => {
            this.isConnecting = false;
            console.log(chalk.red('❌ Falha na autenticação:'), msg);
        });

        this.client.on('disconnected', (reason) => {
            this.isConnected = false;
            this.isConnecting = false;
            console.log(chalk.red('❌ Cliente desconectado:'), reason);
        });

        this.client.on('message_create', async (message) => {
            // Opcional: responder a comandos diretos
            if (message.fromMe) return;
            
            if (message.body === '!status' && message.from.includes('@g.us')) {
                const chat = await message.getChat();
                if (chat.isGroup) {
                    const groupInfo = this.groups.get(chat.id._serialized);
                    const status = groupInfo?.active ? '🟢 ATIVO' : '🔴 INATIVO';
                    message.reply(`Bot Status: ${status}\nGrupo: ${chat.name}`);
                }
            }
        });
    }

    // Carrega dados salvos
    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                this.schedules = new Map(data.schedules || []);
                this.lastVideoId = data.lastVideoId || null;
                
                // Recriar os cron jobs
                for (const [id, scheduleData] of this.schedules) {
                    this.recreateSchedule(id, scheduleData);
                }
                
                console.log(chalk.green('📊 Dados carregados com sucesso!'));
            }
        } catch (error) {
            console.log(chalk.red('⚠️ Erro ao carregar dados:'), error.message);
        }
    }

    // Recria agendamento após carregar dados
    recreateSchedule(id, scheduleData) {
        try {
            const task = cron.schedule(scheduleData.cron, () => {
                console.log(chalk.blue('⏰ Executando verificação agendada...'));
                this.checkAndSendNewVideos();
            }, {
                scheduled: false
            });

            this.schedules.set(id, {
                ...scheduleData,
                task: task
            });

            task.start();
        } catch (error) {
            console.log(chalk.red(`❌ Erro ao recriar agendamento ${id}:`, error.message));
            this.schedules.delete(id);
        }
    }

    // Salva dados
    saveData() {
        try {
            const schedulesToSave = new Map();
            for (const [id, schedule] of this.schedules) {
                schedulesToSave.set(id, {
                    cron: schedule.cron,
                    created: schedule.created
                });
            }

            const data = {
                schedules: Array.from(schedulesToSave),
                lastVideoId: this.lastVideoId
            };
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.log(chalk.red('⚠️ Erro ao salvar dados:'), error.message);
        }
    }

    // Conecta ao WhatsApp
    async connect() {
        if (this.isConnected) {
            console.log(chalk.green('✅ Já está conectado!'));
            return;
        }

        if (this.isConnecting) {
            console.log(chalk.yellow('⏳ Já está conectando, aguarde...'));
            return;
        }

        this.isConnecting = true;
        console.log(chalk.blue('🔗 Iniciando conexão...'));

        try {
            await this.client.initialize();
        } catch (error) {
            this.isConnecting = false;
            console.log(chalk.red('❌ Erro ao conectar:'), error.message);
        }
    }

    // Carrega grupos
    async loadGroups() {
        try {
            const chats = await this.client.getChats();
            this.groups.clear();
            
            let groupCount = 0;
            for (const chat of chats) {
                if (chat.isGroup) {
                    this.groups.set(chat.id._serialized, {
                        name: chat.name,
                        active: false,
                        chat: chat
                    });
                    groupCount++;
                }
            }
            
            console.log(chalk.green(`📋 ${groupCount} grupos carregados!`));
        } catch (error) {
            console.log(chalk.red('❌ Erro ao carregar grupos:'), error.message);
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
            console.log(chalk.red('❌ Erro ao buscar vídeo:'), error.message);
            return null;
        }
    }

    // Envia mensagem com vídeo para um grupo
    async sendVideoToGroup(groupId, videoData) {
        if (!this.client || !this.isConnected) {
            console.log(chalk.red('❌ Bot não conectado!'));
            return false;
        }

        try {
            const group = this.groups.get(groupId);
            if (!group) {
                console.log(chalk.red(`❌ Grupo ${groupId} não encontrado!`));
                return false;
            }

            const message = `🚨 Saiu vídeo novo no canal!\n\n🎬 *${videoData.title}*\n👉 Assista agora: ${videoData.link}\n\nCompartilhe com a família e amigos 🙏 Jesus abençoe!`;
            
            // Envia a mensagem de texto
            await this.client.sendMessage(groupId, message);
            
            // Baixa e envia a imagem
            try {
                const media = await MessageMedia.fromUrl(videoData.thumbnail);
                const caption = `🆕 ${videoData.title}\n🎥 Assista: ${videoData.link}`;
                await this.client.sendMessage(groupId, media, { caption: caption });
            } catch (mediaError) {
                console.log(chalk.yellow(`⚠️ Erro ao enviar imagem para ${group.name}:`, mediaError.message));
            }

            return true;
        } catch (error) {
            console.log(chalk.red(`❌ Erro ao enviar para ${groupId}:`), error.message);
            return false;
        }
    }

    // Verifica novos vídeos e envia
    async checkAndSendNewVideos() {
        if (!this.isConnected) {
            console.log(chalk.red('❌ Bot não conectado!'));
            return;
        }

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
            let sentCount = 0;
            for (const [groupId, groupData] of this.groups) {
                if (groupData.active) {
                    console.log(chalk.blue(`📤 Enviando para: ${groupData.name}`));
                    const success = await this.sendVideoToGroup(groupId, videoData);
                    if (success) sentCount++;
                    await this.delay(3000); // Delay de 3 segundos entre envios
                }
            }
            
            console.log(chalk.green(`✅ Vídeo enviado para ${sentCount} grupos!`));
        } else {
            console.log(chalk.gray('📺 Nenhum vídeo novo encontrado'));
        }
    }

    // Delay helper
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                    await this.connect();
                    break;
                case 'disconnect':
                    this.disconnect();
                    break;
                case 'restart':
                    await this.restart();
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
                case 'clean':
                    this.cleanSession();
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
        console.log(chalk.white('status          - Status da conexão'));
        console.log(chalk.white('groups          - Lista todos os grupos'));
        console.log(chalk.white('activate <nome> - Ativa grupo para envios'));
        console.log(chalk.white('deactivate <nome> - Desativa grupo'));
        console.log(chalk.white('schedule <cron> - Agenda verificação (ex: "0 9,18 * * *")'));
        console.log(chalk.white('schedules       - Lista agendamentos'));
        console.log(chalk.white('remove <id>     - Remove agendamento'));
        console.log(chalk.white('test            - Testa busca de vídeo'));
        console.log(chalk.white('send            - Verifica e envia vídeos novos'));
        console.log(chalk.white('clean           - Limpa sessão do WhatsApp'));
        console.log(chalk.white('clear           - Limpa a tela'));
        console.log(chalk.white('exit            - Sair do bot\n'));
    }

    // Mostra status
    showStatus() {
        console.log(chalk.cyan('\n📊 STATUS DO BOT:'));
        console.log(chalk.white(`Conexão: ${this.isConnected ? chalk.green('✅ Conectado') : chalk.red('❌ Desconectado')}`));
        console.log(chalk.white(`Conectando: ${this.isConnecting ? chalk.yellow('⏳ Sim') : chalk.gray('Não')}`));
        console.log(chalk.white(`Grupos: ${this.groups.size}`));
        console.log(chalk.white(`Grupos Ativos: ${Array.from(this.groups.values()).filter(g => g.active).length}`));
        console.log(chalk.white(`Agendamentos: ${this.schedules.size}`));
        console.log(chalk.white(`Último Vídeo ID: ${this.lastVideoId || 'Nenhum'}\n`));
    }

    // Lista grupos
    listGroups() {
        console.log(chalk.cyan('\n📋 GRUPOS DISPONÍVEIS:'));
        if (this.groups.size === 0) {
            console.log(chalk.gray('Nenhum grupo carregado. Conecte primeiro com "connect".'));
            return;
        }

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
        if (!groupName) {
            console.log(chalk.yellow('❌ Informe o nome do grupo.'));
            return;
        }

        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            group[1].active = true;
            console.log(chalk.green(`✅ Grupo "${group[1].name}" ativado!`));
            this.saveData();
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
        }
    }

    // Desativa grupo
    deactivateGroup(groupName) {
        if (!groupName) {
            console.log(chalk.yellow('❌ Informe o nome do grupo.'));
            return;
        }

        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            group[1].active = false;
            console.log(chalk.yellow(`🔴 Grupo "${group[1].name}" desativado!`));
            this.saveData();
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
        }
    }

    // Agenda mensagens
    scheduleMessage(args) {
        if (args.length === 0) {
            console.log(chalk.yellow('📅 Formato: schedule "<cron_expression>"'));
            console.log(chalk.gray('Exemplos:'));
            console.log(chalk.gray('  schedule "0 9,18 * * *"    # 9h e 18h todos os dias'));
            console.log(chalk.gray('  schedule "*/30 * * * *"    # A cada 30 minutos'));
            console.log(chalk.gray('  schedule "0 8 * * 1-5"     # 8h de segunda a sexta'));
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

    // Limpa sessão
    cleanSession() {
        console.log(chalk.yellow('🧹 Limpando sessão...'));
        if (this.client) {
            this.disconnect();
        }
        
        const sessionDir = './.wwebjs_auth';
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(chalk.green('✅ Sessão limpa! Use "connect" para reconectar.'));
        } else {
            console.log(chalk.gray('Nenhuma sessão encontrada.'));
        }
    }

    // Desconecta
    disconnect() {
        if (this.client) {
            this.client.destroy();
        }
        this.isConnected = false;
        this.isConnecting = false;
        console.log(chalk.yellow('🚪 Desconectado do WhatsApp'));
    }

    // Reinicia conexão
    async restart() {
        console.log(chalk.blue('🔄 Reiniciando conexão...'));
        this.disconnect();
        await this.delay(3000);
        this.initializeClient();
        await this.connect();
    }

    // Mostra prompt
    showPrompt() {
        process.stdout.write(chalk.cyan('\n🤖 Bot> '));
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
console.log(chalk.green('🚀 Iniciando Bot YouTube WhatsApp com whatsapp-web.js...'));
const bot = new YouTubeWhatsAppBot();

// Captura Ctrl+C para sair graciosamente
process.on('SIGINT', () => {
    bot.exit();
});

module.exports = YouTubeWhatsAppBot;