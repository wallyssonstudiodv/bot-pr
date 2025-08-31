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
        this.showWelcome();
        this.setupCommands();
        this.initializeClient();
    }

    // Mostra boas-vindas
    showWelcome() {
        console.clear();
        console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                 🚀 DISPARADOR CANAL PR MARCELO OLIVEIRA                  ║'));
        console.log(chalk.cyan('║                                                                          ║'));
        console.log(chalk.yellow('║                     Criado por: WALLYSSON STUDIO DV 2025                ║'));
        console.log(chalk.cyan('║                                                                          ║'));
        console.log(chalk.cyan('║         Automatize o envio de novos vídeos do Pastor Marcelo            ║'));
        console.log(chalk.cyan('║                  para seus grupos do WhatsApp!                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        console.log(chalk.green('\n🚀 Disparador iniciado com sucesso!'));
        console.log(chalk.gray('Digite "menu" para ver todas as opções disponíveis.\n'));
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
            console.log(chalk.yellow('\n📱 CÓDIGO QR GERADO!'));
            console.log(chalk.white('Abra o WhatsApp no seu celular e escaneie o código abaixo:\n'));
            qrcode.generate(qr, { small: true });
            console.log(chalk.gray('\nAguardando conexão...\n'));
        });

        this.client.on('ready', async () => {
            this.isConnected = true;
            this.isConnecting = false;
            console.log(chalk.green('\n✅ CONECTADO COM SUCESSO!'));
            console.log(chalk.green('WhatsApp Web está pronto para uso!\n'));
            await this.loadGroups();
            this.showPrompt();
        });

        this.client.on('authenticated', () => {
            console.log(chalk.blue('🔐 Autenticação realizada com sucesso!'));
        });

        this.client.on('auth_failure', (msg) => {
            this.isConnecting = false;
            console.log(chalk.red('\n❌ ERRO DE AUTENTICAÇÃO!'));
            console.log(chalk.red('Motivo:', msg));
            console.log(chalk.yellow('💡 Dica: Use o comando "limpar" para resetar a sessão\n'));
            this.showPrompt();
        });

        this.client.on('disconnected', (reason) => {
            this.isConnected = false;
            this.isConnecting = false;
            console.log(chalk.red('\n❌ DESCONECTADO!'));
            console.log(chalk.red('Motivo:', reason));
            console.log(chalk.yellow('💡 Use o comando "conectar" para reconectar\n'));
            this.showPrompt();
        });

        this.client.on('message_create', async (message) => {
            // Responder a comandos diretos nos grupos
            if (message.fromMe) return;
            
            if (message.body === '!status' && message.from.includes('@g.us')) {
                const chat = await message.getChat();
                if (chat.isGroup) {
                    const groupInfo = this.groups.get(chat.id._serialized);
                    const status = groupInfo?.active ? '🟢 ATIVO' : '🔴 INATIVO';
                    message.reply(`🤖 Disparador Status: ${status}\n📋 Grupo: ${chat.name}\n\n✨ Wallysson Studio DV 2025`);
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
                
                console.log(chalk.green('📊 Configurações carregadas!'));
            }
        } catch (error) {
            console.log(chalk.red('⚠️ Erro ao carregar configurações:', error.message));
        }
    }

    // Recria agendamento após carregar dados
    recreateSchedule(id, scheduleData) {
        try {
            const task = cron.schedule(scheduleData.cron, () => {
                console.log(chalk.blue('\n⏰ Executando verificação automática...'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
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
            console.log(chalk.red(`❌ Erro ao restaurar agendamento ${id}:`, error.message));
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
            console.log(chalk.red('⚠️ Erro ao salvar configurações:', error.message));
        }
    }

    // Conecta ao WhatsApp
    async connect() {
        if (this.isConnected) {
            console.log(chalk.green('✅ Já está conectado ao WhatsApp!'));
            return;
        }

        if (this.isConnecting) {
            console.log(chalk.yellow('⏳ Conexão em andamento, aguarde...'));
            return;
        }

        this.isConnecting = true;
        console.log(chalk.blue('\n🔗 Iniciando conexão com WhatsApp...'));
        console.log(chalk.gray('Aguarde o código QR aparecer...\n'));

        try {
            await this.client.initialize();
        } catch (error) {
            this.isConnecting = false;
            console.log(chalk.red('❌ Erro na conexão:', error.message));
            this.showPrompt();
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
            
            console.log(chalk.green(`📋 ${groupCount} grupos encontrados e carregados!`));
        } catch (error) {
            console.log(chalk.red('❌ Erro ao carregar grupos:', error.message));
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
            console.log(chalk.red('❌ Erro ao buscar vídeo no YouTube:', error.message));
            return null;
        }
    }

    // Envia mensagem com vídeo para um grupo
    async sendVideoToGroup(groupId, videoData) {
        if (!this.client || !this.isConnected) {
            console.log(chalk.red('❌ WhatsApp não está conectado!'));
            return false;
        }

        try {
            const group = this.groups.get(groupId);
            if (!group) {
                console.log(chalk.red(`❌ Grupo não encontrado!`));
                return false;
            }

            const message = `🚨 *VÍDEO NOVO DO PR MARCELO OLIVEIRA!*\n\n🎬 *${videoData.title}*\n\n👉 *Assista agora:* ${videoData.link}\n\n🙏 Compartilhe com família e amigos!\n\n✨ *Deus abençoe!*\n\n━━━━━━━━━━━━━━━━━━\n🤖 Disparador by Wallysson Studio DV 2025`;
            
            // Envia a mensagem de texto
            await this.client.sendMessage(groupId, message);
            
            // Tenta enviar a thumbnail
            try {
                const media = await MessageMedia.fromUrl(videoData.thumbnail);
                const caption = `🆕 *${videoData.title}*\n\n🎥 *Link:* ${videoData.link}\n\n✨ Wallysson Studio DV 2025`;
                await this.client.sendMessage(groupId, media, { caption: caption });
            } catch (mediaError) {
                console.log(chalk.yellow(`⚠️ Erro ao enviar imagem para ${group.name}`));
            }

            return true;
        } catch (error) {
            console.log(chalk.red(`❌ Erro ao enviar mensagem:`, error.message));
            return false;
        }
    }

    // Verifica novos vídeos e envia
    async checkAndSendNewVideos() {
        if (!this.isConnected) {
            console.log(chalk.red('❌ WhatsApp não está conectado!'));
            return;
        }

        console.log(chalk.blue('🔍 Verificando novos vídeos no YouTube...'));
        
        const videoData = await this.getLatestVideo();
        if (!videoData) {
            console.log(chalk.yellow('⚠️ Nenhum vídeo encontrado no canal'));
            return;
        }

        if (videoData.isNew) {
            console.log(chalk.green(`🆕 NOVO VÍDEO ENCONTRADO!`));
            console.log(chalk.white(`📺 Título: ${videoData.title}`));
            
            this.lastVideoId = videoData.videoId;
            this.saveData();

            // Envia para todos os grupos ativos
            const activeGroups = Array.from(this.groups.entries()).filter(([id, data]) => data.active);
            
            if (activeGroups.length === 0) {
                console.log(chalk.yellow('⚠️ Nenhum grupo ativo! Use "ativar" para ativar grupos.'));
                return;
            }

            console.log(chalk.blue(`📤 Enviando para ${activeGroups.length} grupos...`));
            let sentCount = 0;
            
            for (const [groupId, groupData] of activeGroups) {
                console.log(chalk.gray(`  📤 Enviando para: ${groupData.name}`));
                const success = await this.sendVideoToGroup(groupId, videoData);
                if (success) {
                    sentCount++;
                    console.log(chalk.green(`  ✅ Enviado com sucesso!`));
                } else {
                    console.log(chalk.red(`  ❌ Falha no envio!`));
                }
                await this.delay(3000); // Delay de 3 segundos entre envios
            }
            
            console.log(chalk.green(`\n🎉 SUCESSO! Vídeo enviado para ${sentCount}/${activeGroups.length} grupos!`));
        } else {
            console.log(chalk.gray('📺 Nenhum vídeo novo encontrado (já foi enviado)'));
        }
    }

    // Delay helper
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Configura comandos do terminal
    setupCommands() {
        this.rl.on('line', async (input) => {
            const [command, ...args] = input.trim().split(' ');
            
            switch (command.toLowerCase()) {
                case 'menu':
                case 'ajuda':
                case 'help':
                    this.showMenu();
                    break;
                case 'conectar':
                case '1':
                    await this.connect();
                    break;
                case 'desconectar':
                case '2':
                    this.disconnect();
                    break;
                case 'status':
                case '3':
                    this.showStatus();
                    break;
                case 'grupos':
                case '4':
                    this.listGroups();
                    break;
                case 'ativar':
                case '5':
                    this.activateGroup(args.join(' '));
                    break;
                case 'desativar':
                case '6':
                    this.deactivateGroup(args.join(' '));
                    break;
                case 'enviar':
                case '7':
                    await this.checkAndSendNewVideos();
                    break;
                case 'agendar':
                case '8':
                    this.scheduleMenu();
                    break;
                case 'agendamentos':
                case '9':
                    this.listSchedules();
                    break;
                case 'testar':
                case '10':
                    await this.testVideo();
                    break;
                case 'limpar':
                case '11':
                    this.cleanSession();
                    break;
                case 'reiniciar':
                case '12':
                    await this.restart();
                    break;
                case 'cls':
                case 'clear':
                case 'limpatela':
                    this.clearScreen();
                    break;
                case 'sair':
                case 'exit':
                case '0':
                    this.exit();
                    break;
                case 'creditos':
                    this.showCredits();
                    break;
                default:
                    if (command.trim() !== '') {
                        console.log(chalk.red('❌ Comando não encontrado!'));
                        console.log(chalk.yellow('💡 Digite "menu" para ver todos os comandos disponíveis.'));
                    }
            }
            
            this.showPrompt();
        });

        this.showPrompt();
    }

    // Mostra menu principal
    showMenu() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                           📋 MENU PRINCIPAL                              ║'));
        console.log(chalk.yellow('║                    🚀 DISPARADOR PR MARCELO OLIVEIRA                     ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🔗 CONEXÃO:                                                             ║'));
        console.log(chalk.yellow('║    1. conectar      - Conectar ao WhatsApp                              ║'));
        console.log(chalk.yellow('║    2. desconectar   - Desconectar do WhatsApp                           ║'));
        console.log(chalk.yellow('║    3. status        - Ver status da conexão                             ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  📋 GRUPOS:                                                              ║'));
        console.log(chalk.green('║    4. grupos        - Listar todos os grupos                            ║'));
        console.log(chalk.green('║    5. ativar        - Ativar grupo (ex: ativar Família)                 ║'));
        console.log(chalk.green('║    6. desativar     - Desativar grupo                                   ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🤖 AUTOMAÇÃO:                                                           ║'));
        console.log(chalk.blue('║    7. enviar        - Verificar e enviar vídeos novos                   ║'));
        console.log(chalk.blue('║    8. agendar       - Programar envios automáticos                      ║'));
        console.log(chalk.blue('║    9. agendamentos  - Ver programações ativas                           ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🛠️  FERRAMENTAS:                                                        ║'));
        console.log(chalk.magenta('║    10. testar       - Testar busca de vídeos                           ║'));
        console.log(chalk.magenta('║    11. limpar       - Resetar sessão do WhatsApp                       ║'));
        console.log(chalk.magenta('║    12. reiniciar    - Reiniciar conexão                                ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  📱 OUTROS:                                                              ║'));
        console.log(chalk.gray('║    cls/clear        - Limpar tela                                       ║'));
        console.log(chalk.gray('║    creditos         - Ver créditos                                      ║'));
        console.log(chalk.red('║    0. sair          - Encerrar bot                                      ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        console.log(chalk.gray('💡 Dica: Você pode usar números ou nomes dos comandos\n'));
    }

    // Menu de agendamento
    scheduleMenu() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                        ⏰ MENU DE AGENDAMENTO                            ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.yellow('║  📅 EXEMPLOS DE HORÁRIOS:                                                ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.green('║  • A cada 30 minutos:    agendar */30 * * * *                           ║'));
        console.log(chalk.green('║  • A cada hora:          agendar 0 * * * *                              ║'));
        console.log(chalk.green('║  • 9h e 18h todo dia:    agendar 0 9,18 * * *                          ║'));
        console.log(chalk.green('║  • 8h segunda a sexta:   agendar 0 8 * * 1-5                           ║'));
        console.log(chalk.green('║  • Todo domingo às 10h:  agendar 0 10 * * 0                            ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.blue('║  📝 FORMATO: agendar "minuto hora dia mês dia_semana"                   ║'));
        console.log(chalk.gray('║     * = qualquer valor                                                   ║'));
        console.log(chalk.gray('║     0-6 = domingo a sábado                                               ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.yellow('║  🗑️  GERENCIAR:                                                          ║'));
        console.log(chalk.white('║  • Ver ativos:           agendamentos                                   ║'));
        console.log(chalk.white('║  • Remover:              remover [ID]                                   ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        
        console.log(chalk.cyan('\n💡 Digite seu comando de agendamento:'));
    }

    // Mostra status detalhado
    showStatus() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                           📊 STATUS DO SISTEMA                           ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.white('║                                                                          ║'));
        
        const connectionStatus = this.isConnected ? 
            chalk.green('🟢 CONECTADO') : 
            this.isConnecting ? chalk.yellow('🟡 CONECTANDO...') : chalk.red('🔴 DESCONECTADO');
        
        const totalGroups = this.groups.size;
        const activeGroups = Array.from(this.groups.values()).filter(g => g.active).length;
        const totalSchedules = this.schedules.size;
        const lastVideo = this.lastVideoId ? this.lastVideoId.substring(0, 15) + '...' : 'Nenhum';
        
        console.log(chalk.white(`║  🔗 Conexão WhatsApp:     ${connectionStatus.padEnd(30)} ║`));
        console.log(chalk.white(`║  📋 Total de Grupos:      ${totalGroups.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  ✅ Grupos Ativos:        ${activeGroups.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  ⏰ Agendamentos:         ${totalSchedules.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  📺 Último Vídeo:         ${lastVideo.padEnd(30)} ║`));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        
        if (!this.isConnected && !this.isConnecting) {
            console.log(chalk.yellow('\n💡 Para começar, use o comando "conectar"'));
        }
    }

    // Lista grupos de forma organizada
    listGroups() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                           📋 GRUPOS DISPONÍVEIS                          ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        
        if (this.groups.size === 0) {
            console.log(chalk.white('║                                                                          ║'));
            console.log(chalk.gray('║                    ⚠️  Nenhum grupo carregado                           ║'));
            console.log(chalk.gray('║                   Use "conectar" primeiro                               ║'));
            console.log(chalk.white('║                                                                          ║'));
        } else {
            console.log(chalk.white('║                                                                          ║'));
            let index = 1;
            for (const [id, group] of this.groups) {
                const status = group.active ? chalk.green('🟢 ATIVO  ') : chalk.red('🔴 INATIVO');
                const groupName = group.name.length > 40 ? group.name.substring(0, 37) + '...' : group.name;
                const line = `║  ${index.toString().padStart(2)}. ${groupName.padEnd(40)} ${status} ║`;
                console.log(chalk.white(line));
                index++;
            }
            console.log(chalk.white('║                                                                          ║'));
            console.log(chalk.yellow('║  💡 Para ativar: ativar [nome do grupo]                                 ║'));
            console.log(chalk.yellow('║     Exemplo: ativar Família                                             ║'));
            console.log(chalk.white('║                                                                          ║'));
        }
        
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
    }

    // Ativa grupo com melhor interface
    activateGroup(groupName) {
        if (!groupName) {
            console.log(chalk.red('❌ Você precisa informar o nome do grupo!'));
            console.log(chalk.yellow('💡 Exemplo: ativar Família'));
            return;
        }

        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            if (group[1].active) {
                console.log(chalk.yellow(`⚠️ O grupo "${group[1].name}" já está ativo!`));
            } else {
                group[1].active = true;
                console.log(chalk.green(`✅ SUCESSO!`));
                console.log(chalk.green(`📋 Grupo "${group[1].name}" foi ATIVADO!`));
                console.log(chalk.gray(`🤖 Agora este grupo receberá os novos vídeos automaticamente.`));
                this.saveData();
            }
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
            console.log(chalk.yellow('💡 Use "grupos" para ver todos os grupos disponíveis.'));
        }
    }

    // Desativa grupo com melhor interface
    deactivateGroup(groupName) {
        if (!groupName) {
            console.log(chalk.red('❌ Você precisa informar o nome do grupo!'));
            console.log(chalk.yellow('💡 Exemplo: desativar Família'));
            return;
        }

        const group = Array.from(this.groups.entries()).find(([id, data]) => 
            data.name.toLowerCase().includes(groupName.toLowerCase())
        );
        
        if (group) {
            if (!group[1].active) {
                console.log(chalk.yellow(`⚠️ O grupo "${group[1].name}" já está inativo!`));
            } else {
                group[1].active = false;
                console.log(chalk.yellow(`🔴 Grupo "${group[1].name}" foi DESATIVADO!`));
                console.log(chalk.gray(`🤖 Este grupo não receberá mais os vídeos automaticamente.`));
                this.saveData();
            }
        } else {
            console.log(chalk.red('❌ Grupo não encontrado!'));
            console.log(chalk.yellow('💡 Use "grupos" para ver todos os grupos disponíveis.'));
        }
    }

    // Agenda mensagens com interface melhorada
    scheduleMessage(args) {
        if (args.length === 0) {
            this.scheduleMenu();
            return;
        }

        const cronExpr = args.join(' ').replace(/"/g, '');
        const scheduleId = Date.now().toString();

        try {
            // Valida a expressão cron
            const task = cron.schedule(cronExpr, () => {
                console.log(chalk.blue('\n⏰ VERIFICAÇÃO AUTOMÁTICA INICIADA'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
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

            console.log(chalk.green('✅ AGENDAMENTO CRIADO COM SUCESSO!'));
            console.log(chalk.white(`🆔 ID: ${scheduleId}`));
            console.log(chalk.white(`⏰ Horário: ${cronExpr}`));
            console.log(chalk.green('🤖 O disparador agora verificará automaticamente novos vídeos!'));
        } catch (error) {
            console.log(chalk.red('❌ ERRO: Expressão de horário inválida!'));
            console.log(chalk.yellow('💡 Use "agendar" sem parâmetros para ver exemplos.'));
        }
    }

    // Lista agendamentos com interface melhorada
    listSchedules() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                        📅 AGENDAMENTOS ATIVOS                            ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        
        if (this.schedules.size === 0) {
            console.log(chalk.white('║                                                                          ║'));
            console.log(chalk.gray('║                   ⚠️  Nenhum agendamento ativo                          ║'));
            console.log(chalk.gray('║                Use "agendar" para criar um                              ║'));
            console.log(chalk.white('║                                                                          ║'));
        } else {
            console.log(chalk.white('║                                                                          ║'));
            let index = 1;
            for (const [id, schedule] of this.schedules) {
                const createdDate = new Date(schedule.created).toLocaleDateString();
                const createdTime = new Date(schedule.created).toLocaleTimeString();
                
                console.log(chalk.white(`║  ${index}. ID: ${id.padEnd(15)} ║`));
                console.log(chalk.gray(`║     ⏰ Horário: ${schedule.cron.padEnd(20)} ║`));
                console.log(chalk.gray(`║     📅 Criado: ${createdDate} ${createdTime.padEnd(15)} ║`));
                console.log(chalk.white('║                                                                          ║'));
                index++;
            }
            console.log(chalk.yellow('║  💡 Para remover: remover [ID]                                           ║'));
            console.log(chalk.white('║                                                                          ║'));
        }
        
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
    }

    // Remove agendamento
    removeSchedule(id) {
        if (!id) {
            console.log(chalk.red('❌ Você precisa informar o ID do agendamento!'));
            console.log(chalk.yellow('💡 Use "agendamentos" para ver os IDs disponíveis.'));
            return;
        }

        const schedule = this.schedules.get(id);
        if (schedule) {
            schedule.task.stop();
            this.schedules.delete(id);
            this.saveData();
            console.log(chalk.green(`✅ Agendamento ${id} removido com sucesso!`));
        } else {
            console.log(chalk.red('❌ Agendamento não encontrado!'));
            console.log(chalk.yellow('💡 Verifique o ID com o comando "agendamentos".'));
        }
    }

    // Testa busca de vídeo com interface melhorada
    async testVideo() {
        console.log(chalk.blue('\n🧪 TESTANDO CONEXÃO COM YOUTUBE...'));
        console.log(chalk.gray('Buscando o último vídeo do canal do PR Marcelo Oliveira...\n'));
        
        const videoData = await this.getLatestVideo();
        
        if (videoData) {
            console.log(chalk.green('✅ SUCESSO! Vídeo encontrado:\n'));
            console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════════════════╗'));
            console.log(chalk.cyan('║                            📺 DADOS DO VÍDEO                            ║'));
            console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
            console.log(chalk.white('║                                                                          ║'));
            
            // Quebra o título em linhas se for muito grande
            const titleLines = this.wrapText(videoData.title, 64);
            titleLines.forEach((line, index) => {
                const label = index === 0 ? '🎬 Título: ' : '          ';
                console.log(chalk.white(`║  ${label}${line.padEnd(64 - label.length)} ║`));
            });
            
            console.log(chalk.white('║                                                                          ║'));
            console.log(chalk.white(`║  🔗 Link: ${videoData.link.padEnd(55)} ║`));
            console.log(chalk.white(`║  🆔 ID: ${videoData.videoId.padEnd(57)} ║`));
            
            const isNewText = videoData.isNew ? '✅ SIM (será enviado)' : '❌ NÃO (já foi enviado)';
            console.log(chalk.white(`║  🆕 Novo: ${isNewText.padEnd(55)} ║`));
            
            console.log(chalk.white('║                                                                          ║'));
            console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
            
            if (videoData.isNew) {
                console.log(chalk.green('\n🎉 Este vídeo será enviado na próxima execução!'));
            } else {
                console.log(chalk.yellow('\n⚠️ Este vídeo já foi enviado anteriormente.'));
            }
        } else {
            console.log(chalk.red('❌ ERRO! Não foi possível buscar vídeos.'));
            console.log(chalk.yellow('💡 Verifique sua conexão com a internet ou a API do YouTube.'));
        }
    }

    // Quebra texto em linhas
    wrapText(text, maxLength) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach(word => {
            if ((currentLine + word).length <= maxLength) {
                currentLine += (currentLine ? ' ' : '') + word;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        });
        
        if (currentLine) lines.push(currentLine);
        return lines;
    }

    // Limpa sessão com confirmação
    cleanSession() {
        console.log(chalk.yellow('\n⚠️  ATENÇÃO!'));
        console.log(chalk.yellow('Esta ação irá resetar completamente a sessão do WhatsApp.'));
        console.log(chalk.yellow('Você precisará escanear o QR Code novamente.'));
        
        this.rl.question(chalk.cyan('\n❓ Tem certeza? (s/N): '), (answer) => {
            if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'sim') {
                console.log(chalk.blue('\n🧹 Limpando sessão...'));
                
                if (this.client) {
                    this.disconnect();
                }
                
                const sessionDir = './.wwebjs_auth';
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    console.log(chalk.green('✅ Sessão removida com sucesso!'));
                    console.log(chalk.yellow('💡 Use "conectar" para criar uma nova sessão.'));
                } else {
                    console.log(chalk.gray('ℹ️  Nenhuma sessão encontrada para limpar.'));
                }
            } else {
                console.log(chalk.gray('❌ Operação cancelada.'));
            }
            this.showPrompt();
        });
        return;
    }

    // Mostra créditos
    showCredits() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                              👨‍💻 CRÉDITOS                                 ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.yellow('║                        🎯 WALLYSSON STUDIO DV                            ║'));
        console.log(chalk.yellow('║                              © 2025                                     ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.green('║  🚀 Disparador Canal PR Marcelo Oliveira - Versão 2.0                  ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.blue('║  📧 Desenvolvido com dedicação para automação                           ║'));
        console.log(chalk.blue('║     de conteúdo do Pastor Marcelo Oliveira                              ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.magenta('║  🛠️  Tecnologias utilizadas:                                            ║'));
        console.log(chalk.gray('║     • Node.js                                                            ║'));
        console.log(chalk.gray('║     • whatsapp-web.js                                                    ║'));
        console.log(chalk.gray('║     • YouTube API v3                                                     ║'));
        console.log(chalk.gray('║     • Node Cron                                                          ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.red('║  ❤️  Feito com amor e código limpo!                                      ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
    }

    // Limpa tela de forma organizada
    clearScreen() {
        console.clear();
        this.showWelcome();
    }

    // Desconecta com interface melhorada
    disconnect() {
        if (this.client) {
            this.client.destroy();
        }
        this.isConnected = false;
        this.isConnecting = false;
        console.log(chalk.yellow('\n🚪 Desconectado do WhatsApp com sucesso!'));
        console.log(chalk.gray('💡 Use "conectar" para reconectar.'));
    }

    // Reinicia conexão com interface melhorada
    async restart() {
        console.log(chalk.blue('\n🔄 REINICIANDO CONEXÃO...'));
        console.log(chalk.gray('1/3 Desconectando...'));
        this.disconnect();
        
        console.log(chalk.gray('2/3 Aguardando 3 segundos...'));
        await this.delay(3000);
        
        console.log(chalk.gray('3/3 Reinicializando cliente...'));
        this.initializeClient();
        await this.connect();
        
        console.log(chalk.green('✅ Reinicialização concluída!'));
    }

    // Mostra prompt personalizado
    showPrompt() {
        const statusIcon = this.isConnected ? '🟢' : this.isConnecting ? '🟡' : '🔴';
        process.stdout.write(chalk.cyan(`\n${statusIcon} Disparador> `));
    }

    // Sair com confirmação
    exit() {
        console.log(chalk.yellow('\n👋 Encerrando Disparador Canal PR Marcelo Oliveira...'));
        
        console.log(chalk.blue('🔄 Salvando configurações...'));
        this.saveData();
        
        console.log(chalk.blue('⏰ Parando agendamentos...'));
        for (const [id, schedule] of this.schedules) {
            schedule.task.stop();
        }
        
        console.log(chalk.blue('🚪 Desconectando do WhatsApp...'));
        this.disconnect();
        
        console.log(chalk.green('\n✅ Disparador encerrado com sucesso!'));
        console.log(chalk.yellow('🎯 Obrigado por usar Wallysson Studio DV 2025!'));
        console.log(chalk.gray('❤️  Até a próxima!\n'));
        
        process.exit(0);
    }

    // Processa comando de agendamento
    async processScheduleCommand(input) {
        const [command, ...args] = input.trim().split(' ');
        
        switch (command.toLowerCase()) {
            case 'agendar':
                this.scheduleMessage(args);
                break;
            case 'remover':
                this.removeSchedule(args[0]);
                break;
            default:
                console.log(chalk.red('❌ Comando de agendamento inválido!'));
                console.log(chalk.yellow('💡 Use "agendar" para ver as opções.'));
        }
    }
}

// Função principal de inicialização
function initializeBot() {
    console.log(chalk.green('🚀 Iniciando Disparador Canal PR Marcelo Oliveira...'));
    console.log(chalk.gray('📦 Carregando módulos...'));
    
    const bot = new YouTubeWhatsAppBot();
    
    // Captura Ctrl+C para sair graciosamente
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\n⚠️  Interrupção detectada!'));
        bot.exit();
    });
    
    // Captura erros não tratados
    process.on('unhandledRejection', (reason, promise) => {
        console.log(chalk.red('❌ Erro não tratado:'), reason);
    });
    
    process.on('uncaughtException', (error) => {
        console.log(chalk.red('❌ Exceção não capturada:'), error.message);
    });
    
    return bot;
}

// Inicia o bot
const bot = initializeBot();

module.exports = YouTubeWhatsAppBot;