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
        this.autoScheduleEnabled = false;
        
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
            this.setupAutoSchedule();
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
                    const autoStatus = this.autoScheduleEnabled ? '🟢 ATIVADO' : '🔴 DESATIVADO';
                    message.reply(`🤖 Disparador Status: ${status}\n📋 Grupo: ${chat.name}\n⏰ Envio Automático: ${autoStatus}\n🕒 Horários: 08:00, 12:00, 18:00\n\n✨ Wallysson Studio DV 2025`);
                }
            }
        });
    }

    // Configura agendamento automático para 8h, 12h e 18h
    setupAutoSchedule() {
        if (this.autoScheduleEnabled) {
            console.log(chalk.green('⏰ Agendamento automático já está ativo!'));
            return;
        }

        try {
            // Agendamento para 8:00
            const morning = cron.schedule('0 8 * * *', () => {
                console.log(chalk.blue('\n⏰ VERIFICAÇÃO AUTOMÁTICA - 08:00'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
                this.checkAndSendNewVideos();
            });

            // Agendamento para 12:00
            const noon = cron.schedule('0 12 * * *', () => {
                console.log(chalk.blue('\n⏰ VERIFICAÇÃO AUTOMÁTICA - 12:00'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
                this.checkAndSendNewVideos();
            });

            // Agendamento para 18:00
            const evening = cron.schedule('0 18 * * *', () => {
                console.log(chalk.blue('\n⏰ VERIFICAÇÃO AUTOMÁTICA - 18:00'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
                this.checkAndSendNewVideos();
            });

            // Salva os agendamentos
            this.schedules.set('auto_08h', {
                cron: '0 8 * * *',
                task: morning,
                created: new Date().toISOString(),
                type: 'auto',
                description: 'Envio automático - 08:00'
            });

            this.schedules.set('auto_12h', {
                cron: '0 12 * * *',
                task: noon,
                created: new Date().toISOString(),
                type: 'auto',
                description: 'Envio automático - 12:00'
            });

            this.schedules.set('auto_18h', {
                cron: '0 18 * * *',
                task: evening,
                created: new Date().toISOString(),
                type: 'auto',
                description: 'Envio automático - 18:00'
            });

            this.autoScheduleEnabled = true;
            this.saveData();

            console.log(chalk.green('\n✅ AGENDAMENTO AUTOMÁTICO CONFIGURADO!'));
            console.log(chalk.white('🕰️  Horários programados:'));
            console.log(chalk.yellow('    • 08:00 - Verificação matinal'));
            console.log(chalk.yellow('    • 12:00 - Verificação do meio-dia'));
            console.log(chalk.yellow('    • 18:00 - Verificação noturna'));
            console.log(chalk.green('🤖 O bot verificará automaticamente novos vídeos nesses horários!'));

        } catch (error) {
            console.log(chalk.red('❌ Erro ao configurar agendamentos automáticos:', error.message));
        }
    }

    // Desativa agendamento automático
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

        console.log(chalk.yellow('🔴 Agendamento automático DESATIVADO!'));
        console.log(chalk.gray('💡 Use "auto-ativar" para reativar.'));
    }

    // Carrega dados salvos
    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                this.schedules = new Map(data.schedules || []);
                this.lastVideoId = data.lastVideoId || null;
                this.autoScheduleEnabled = data.autoScheduleEnabled || false;
                
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
                console.log(chalk.blue(`\n⏰ ${scheduleData.description || 'VERIFICAÇÃO AUTOMÁTICA'}`));
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
                    created: schedule.created,
                    type: schedule.type || 'manual',
                    description: schedule.description || ''
                });
            }

            const data = {
                schedules: Array.from(schedulesToSave),
                lastVideoId: this.lastVideoId,
                autoScheduleEnabled: this.autoScheduleEnabled
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

            const message = `🚨 *VÍDEO NOVO DO PR MARCELO OLIVEIRA!*\n\n🎬 *${videoData.title}*\n\n👉 *Assista agora:* ${videoData.link}\n\n🙏 Compartilhe com família e amigos!\n\n✨ *Deus abençoe!*\n\n━━━━━━━━━━━━━━━━━━\n`;
            
            // Envia a mensagem de texto
            await this.client.sendMessage(groupId, message);
            

            return true;
        } catch (error) {
            console.log(chalk.red(`❌ Erro ao enviar mensagem:`, error.message));
            return false;
        }
    }

    // Verifica novos vídeos e envia
    async checkAndSendNewVideos(forceCheck = false) {
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

        if (videoData.isNew || forceCheck) {
            if (forceCheck && !videoData.isNew) {
                console.log(chalk.blue(`🔄 ENVIO MANUAL FORÇADO!`));
                console.log(chalk.white(`📺 Reenviando: ${videoData.title}`));
            } else {
                console.log(chalk.green(`🆕 NOVO VÍDEO ENCONTRADO!`));
                console.log(chalk.white(`📺 Título: ${videoData.title}`));
                this.lastVideoId = videoData.videoId;
                this.saveData();
            }

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

    // Envio manual forçado (mesmo que já tenha sido enviado)
    async forceManualSend() {
        if (!this.isConnected) {
            console.log(chalk.red('❌ WhatsApp não está conectado!'));
            return;
        }

        console.log(chalk.blue('\n🚀 ENVIO MANUAL INICIADO'));
        console.log(chalk.yellow('⚠️  Este comando enviará o último vídeo mesmo que já tenha sido enviado antes.'));
        
        this.rl.question(chalk.cyan('\n❓ Confirma o envio manual? (s/N): '), async (answer) => {
            if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'sim') {
                await this.checkAndSendNewVideos(true);
            } else {
                console.log(chalk.gray('❌ Envio manual cancelado.'));
            }
            this.showPrompt();
        });
        return;
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
                case 'verificar':
                case '7':
                    await this.checkAndSendNewVideos();
                    break;
                case 'enviar-manual':
                case 'manual':
                case '8':
                    await this.forceManualSend();
                    break;
                case 'auto-ativar':
                case '9':
                    this.setupAutoSchedule();
                    break;
                case 'auto-desativar':
                case '10':
                    this.disableAutoSchedule();
                    break;
                case 'agendar':
                case '11':
                    this.scheduleMenu();
                    break;
                case 'agendamentos':
                case '12':
                    this.listSchedules();
                    break;
                case 'testar':
                case '13':
                    await this.testVideo();
                    break;
                case 'limpar':
                case '14':
                    this.cleanSession();
                    break;
                case 'reiniciar':
                case '15':
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
                case 'remover':
                    this.removeSchedule(args[0]);
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
        console.log(chalk.yellow('║    1. conectar         - Conectar ao WhatsApp                           ║'));
        console.log(chalk.yellow('║    2. desconectar      - Desconectar do WhatsApp                        ║'));
        console.log(chalk.yellow('║    3. status           - Ver status da conexão                          ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  📋 GRUPOS:                                                              ║'));
        console.log(chalk.green('║    4. grupos           - Listar todos os grupos                         ║'));
        console.log(chalk.green('║    5. ativar           - Ativar grupo (ex: ativar Família)              ║'));
        console.log(chalk.green('║    6. desativar        - Desativar grupo                                ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🤖 ENVIOS:                                                              ║'));
        console.log(chalk.blue('║    7. verificar        - Verificar novos vídeos (apenas novos)          ║'));
        console.log(chalk.magenta('║    8. enviar-manual    - Enviar último vídeo (forçado)                  ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  ⏰ AUTOMAÇÃO (8h, 12h, 18h):                                            ║'));
        console.log(chalk.blue('║    9. auto-ativar      - Ativar envios automáticos                      ║'));
        console.log(chalk.yellow('║    10. auto-desativar  - Desativar envios automáticos                   ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🛠️  AGENDAMENTO PERSONALIZADO:                                          ║'));
        console.log(chalk.gray('║    11. agendar         - Criar agendamento personalizado                ║'));
        console.log(chalk.gray('║    12. agendamentos    - Ver todos os agendamentos                      ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  🔧 FERRAMENTAS:                                                         ║'));
        console.log(chalk.magenta('║    13. testar          - Testar busca de vídeos                        ║'));
        console.log(chalk.magenta('║    14. limpar          - Resetar sessão do WhatsApp                    ║'));
        console.log(chalk.magenta('║    15. reiniciar       - Reiniciar conexão                             ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.white('║  📱 OUTROS:                                                              ║'));
        console.log(chalk.gray('║    cls/clear           - Limpar tela                                    ║'));
        console.log(chalk.gray('║    creditos            - Ver créditos                                   ║'));
        console.log(chalk.red('║    0. sair             - Encerrar bot                                   ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        console.log(chalk.green('\n💡 NOVIDADE: Agendamento automático para 08h, 12h e 18h!'));
        console.log(chalk.gray('   Use "auto-ativar" para ativar e "enviar-manual" para envio imediato.\n'));
    }

    // Menu de agendamento
    scheduleMenu() {
        console.log(chalk.cyan('\n╔══════════════════════════════════════════════════════════════════════════╗'));
        console.log(chalk.cyan('║                        ⏰ MENU DE AGENDAMENTO                            ║'));
        console.log(chalk.cyan('╠══════════════════════════════════════════════════════════════════════════╣'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.green('║  🎯 AGENDAMENTO AUTOMÁTICO (RECOMENDADO):                               ║'));
        console.log(chalk.yellow('║     • auto-ativar    - Ativa envios em 08h, 12h e 18h                  ║'));
        console.log(chalk.yellow('║     • auto-desativar - Desativa envios automáticos                     ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.blue('║  🛠️  AGENDAMENTO PERSONALIZADO:                                          ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.yellow('║  📅 EXEMPLOS DE HORÁRIOS:                                                ║'));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.green('║  • A cada 30 minutos:    agendar */30 * * * *                           ║'));
        console.log(chalk.green('║  • A cada hora:          agendar 0 * * * *                              ║'));
        console.log(chalk.green('║  • 9h e 21h todo dia:    agendar 0 9,21 * * *                          ║'));
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
        
        const autoStatus = this.autoScheduleEnabled ? 
            chalk.green('🟢 ATIVO (8h, 12h, 18h)') : chalk.red('🔴 DESATIVADO');
        
        const totalGroups = this.groups.size;
        const activeGroups = Array.from(this.groups.values()).filter(g => g.active).length;
        const totalSchedules = this.schedules.size;
        const lastVideo = this.lastVideoId ? this.lastVideoId.substring(0, 15) + '...' : 'Nenhum';
        
        console.log(chalk.white(`║  🔗 Conexão WhatsApp:     ${connectionStatus.padEnd(30)} ║`));
        console.log(chalk.white(`║  ⏰ Envio Automático:     ${autoStatus.padEnd(30)} ║`));
        console.log(chalk.white(`║  📋 Total de Grupos:      ${totalGroups.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  ✅ Grupos Ativos:        ${activeGroups.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  🛠️  Agendamentos Extras:  ${totalSchedules.toString().padEnd(30)} ║`));
        console.log(chalk.white(`║  📺 Último Vídeo:         ${lastVideo.padEnd(30)} ║`));
        console.log(chalk.white('║                                                                          ║'));
        console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════════════════╝'));
        
        if (!this.isConnected && !this.isConnecting) {
            console.log(chalk.yellow('\n💡 Para começar:'));
            console.log(chalk.white('   1. Use "conectar" para conectar ao WhatsApp'));
            console.log(chalk.white('   2. Use "auto-ativar" para ativar envios automáticos'));
            console.log(chalk.white('   3. Use "ativar [nome]" para ativar grupos'));
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
                console.log(chalk.blue('\n⏰ VERIFICAÇÃO AUTOMÁTICA PERSONALIZADA'));
                console.log(chalk.gray('📅 ' + new Date().toLocaleString()));
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

            console.log(chalk.green('✅ AGENDAMENTO PERSONALIZADO CRIADO!'));
            console.log(chalk.white(`🆔 ID: ${scheduleId}`));
            console.log(chalk.white(`⏰ Horário: ${cronExpr}`));
            console.log(chalk.green('🤖 O bot verificará automaticamente novos vídeos neste horário!'));
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
            console.log(chalk.gray('║                Use "auto-ativar" ou "agendar"                          ║'));
            console.log(chalk.white('║                                                                          ║'));
        } else {
            console.log(chalk.white('║                                                                          ║'));
            
            // Mostra status do agendamento automático
            if (this.autoScheduleEnabled) {
                console.log(chalk.green('║  🎯 AGENDAMENTO AUTOMÁTICO: ATIVO                                       ║'));
                console.log(chalk.yellow('║     • 08:00 - Verificação matinal                                       ║'));
                console.log(chalk.yellow('║     • 12:00 - Verificação do meio-dia                                   ║'));
                console.log(chalk.yellow('║     • 18:00 - Verificação noturna                                       ║'));
                console.log(chalk.white('║                                                                          ║'));
            }
            
            // Mostra agendamentos personalizados
            const customSchedules = Array.from(this.schedules.entries()).filter(([id, schedule]) => 
                schedule.type === 'custom' || schedule.type === 'manual'
            );
            
            if (customSchedules.length > 0) {
                console.log(chalk.blue('║  🛠️  AGENDAMENTOS PERSONALIZADOS:                                        ║'));
                console.log(chalk.white('║                                                                          ║'));
                
                let index = 1;
                for (const [id, schedule] of customSchedules) {
                    const createdDate = new Date(schedule.created).toLocaleDateString();
                    const idShort = id.substring(0, 10) + '...';
                    
                    console.log(chalk.white(`║  ${index}. ID: ${idShort.padEnd(15)} ║`));
                    console.log(chalk.gray(`║     ⏰ Horário: ${schedule.cron.padEnd(20)} ║`));
                    console.log(chalk.gray(`║     📅 Criado: ${createdDate.padEnd(15)} ║`));
                    console.log(chalk.white('║                                                                          ║'));
                    index++;
                }
                console.log(chalk.yellow('║  💡 Para remover: remover [ID completo]                                  ║'));
                console.log(chalk.white('║                                                                          ║'));
            }
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

        // Não permite remover agendamentos automáticos
        if (id.startsWith('auto_')) {
            console.log(chalk.red('❌ Não é possível remover agendamentos automáticos!'));
            console.log(chalk.yellow('💡 Use "auto-desativar" para desativar os envios automáticos.'));
            return;
        }

        const schedule = this.schedules.get(id);
        if (schedule) {
            schedule.task.stop();
            this.schedules.delete(id);
            this.saveData();
            console.log(chalk.green(`✅ Agendamento ${id.substring(0, 10)}... removido com sucesso!`));
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
                console.log(chalk.blue('💡 Use "enviar-manual" para reenviar mesmo assim.'));
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
        console.log(chalk.green('║  🚀 Disparador Canal PR Marcelo Oliveira - Versão 2.1                  ║'));
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
        const autoIcon = this.autoScheduleEnabled ? '⏰' : '⏸️';
        process.stdout.write(chalk.cyan(`\n${statusIcon}${autoIcon} Disparador> `));
    }

    // Sair com confirmação
    exit() {
        console.log(chalk.yellow('\n👋 Encerrando Disparador Canal PR Marcelo Oliveira...'));
        
        console.log(chalk.blue('🔄 Salvando configurações...'));
        this.saveData();
        
        console.log(chalk.blue('⏰ Parando agendamentos...'));
        for (const [id, schedule] of this.schedules) {
            if (schedule.task) {
                schedule.task.stop();
            }
        }
        
        console.log(chalk.blue('🚪 Desconectando do WhatsApp...'));
        this.disconnect();
        
        console.log(chalk.green('\n✅ Disparador encerrado com sucesso!'));
        console.log(chalk.yellow('🎯 Obrigado por usar Wallysson Studio DV 2025!'));
        console.log(chalk.gray('❤️  Até a próxima!\n'));
        
        process.exit(0);
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