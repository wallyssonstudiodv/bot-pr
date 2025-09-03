const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const crypto = require('crypto');
globalThis.crypto = crypto;

console.log('🚀 Iniciando Auto Envios Bot...');

try {
  require('@whiskeysockets/baileys');
  console.log('✅ Baileys carregado');
} catch (error) {
  console.error('❌ Erro ao carregar Baileys:', error.message);
  console.log('📦 Execute: npm install @whiskeysockets/baileys@6.6.0');
  process.exit(1);
}

const WhatsAppBot = require('./bot/whatsapp-bot');

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let whatsappBot = null;
let activeTasks = new Map();

const defaultConfig = {
  youtubeApiKey: "",
  channelId: "",
  schedules: [],
  activeGroups: [],
  botConnected: false,
  antiBanSettings: {
    delayBetweenGroups: 5,
    delayBetweenMessages: 2,
    maxGroupsPerBatch: 10,
    batchDelay: 30
  }
};

// Função de log
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  console.log(logEntry);
  io.emit('log', { message, type, timestamp });
}

// Carregar configurações
async function loadConfig() {
  try {
    await fs.ensureDir('./config');
    const configPath = './config/settings.json';
    if (await fs.pathExists(configPath)) {
      const config = await fs.readJSON(configPath);
      log('Configurações carregadas do arquivo', 'success');
      return { ...defaultConfig, ...config };
    }
    await fs.writeJSON(configPath, defaultConfig, { spaces: 2 });
    log('Arquivo de configuração criado', 'info');
    return defaultConfig;
  } catch (error) {
    log('Erro ao carregar configurações: ' + error.message, 'error');
    return defaultConfig;
  }
}

// Salvar configurações
async function saveConfig(config) {
  try {
    await fs.ensureDir('./config');
    await fs.writeJSON('./config/settings.json', config, { spaces: 2 });
    log('Configurações salvas', 'success');
    return true;
  } catch (error) {
    log('Erro ao salvar configurações: ' + error.message, 'error');
    return false;
  }
}

// Envio de vídeo com thumbnail e mensagem personalizada
async function sendVideoWithAntiBot(groupIds, config) {
  if (!whatsappBot || !whatsappBot.isConnected()) throw new Error('Bot não conectado');
  const { antiBanSettings } = config;
  const totalGroups = groupIds.length;
  log(`Iniciando envio para ${totalGroups} grupos com proteção anti-banimento`, 'info');

  const batches = [];
  for (let i = 0; i < groupIds.length; i += antiBanSettings.maxGroupsPerBatch) {
    batches.push(groupIds.slice(i, i + antiBanSettings.maxGroupsPerBatch));
  }
  log(`Dividido em ${batches.length} lotes de até ${antiBanSettings.maxGroupsPerBatch} grupos`, 'info');

  let sentCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    log(`Processando lote ${batchIndex + 1}/${batches.length}`, 'info');

    for (let groupIndex = 0; groupIndex < batch.length; groupIndex++) {
      const groupId = batch[groupIndex];
      try {
        // Busca último vídeo
        const video = await whatsappBot.getLatestVideo(config.youtubeApiKey, config.channelId);

        const message = {
          image: { url: video.thumbnail },
          caption: `🎥 *Novo vídeo no canal!*\n\n*${video.title}*\n\n${video.description.substring(0, 200)}${video.description.length > 200 ? '...' : ''}\n\n🔗 ${video.url}\n\n✨ Compartilhem com a família e amigos, Jesus Cristo abençoe 🙏💖`
        };

        await whatsappBot.sock.sendMessage(groupId, message);

        sentCount++;
        log(`✅ Enviado para grupo ${sentCount}/${totalGroups}`, 'success');

        if (groupIndex < batch.length - 1) {
          log(`⏳ Aguardando ${antiBanSettings.delayBetweenGroups}s antes do próximo grupo...`, 'info');
          await new Promise(resolve => setTimeout(resolve, antiBanSettings.delayBetweenGroups * 1000));
        }
      } catch (error) {
        log(`❌ Erro ao enviar para grupo: ${error.message}`, 'error');
      }
    }

    if (batchIndex < batches.length - 1) {
      log(`⏳ Aguardando ${antiBanSettings.batchDelay}s antes do próximo lote...`, 'info');
      await new Promise(resolve => setTimeout(resolve, antiBanSettings.batchDelay * 1000));
    }
  }

  log(`✅ Envio completo: ${sentCount}/${totalGroups} grupos`, 'success');
  return sentCount;
}

// Inicializar bot
async function initializeBot() {
  try {
    log('Inicializando WhatsApp Bot...', 'info');

    if (whatsappBot) {
      try { await whatsappBot.disconnect(); } catch (e) { log('Aviso ao desconectar bot anterior: ' + e.message, 'warning'); }
      whatsappBot = null;
    }

    whatsappBot = new WhatsAppBot(io, log);
    await whatsappBot.initialize();
    const config = await loadConfig();
    setupSchedules(config.schedules, config);
    log('Bot inicializado com sucesso', 'success');
    return true;
  } catch (error) {
    log('Erro ao inicializar bot: ' + error.message, 'error');
    return false;
  }
}

// Configurar agendamentos
function setupSchedules(schedules, config) {
  activeTasks.forEach(task => { try { task.destroy(); } catch {} });
  activeTasks.clear();

  if (!schedules || schedules.length === 0) { log('Nenhum agendamento para configurar', 'info'); return; }

  schedules.forEach(schedule => {
    if (schedule.active && schedule.days?.length > 0 && schedule.selectedGroups?.length > 0) {
      const cronDays = schedule.days.join(',');
      const cronTime = `${schedule.minute} ${schedule.hour} * * ${cronDays}`;

      log(`Configurando agendamento: ${schedule.name} - ${cronTime} - ${schedule.selectedGroups.length} grupos`, 'info');

      const task = cron.schedule(cronTime, async () => {
        if (whatsappBot && whatsappBot.isConnected()) {
          try {
            log(`🕐 Executando agendamento: ${schedule.name}`, 'info');
            await sendVideoWithAntiBot(schedule.selectedGroups, config);
            log(`✅ Agendamento executado: ${schedule.name}`, 'success');
          } catch (error) {
            log(`❌ Erro no agendamento ${schedule.name}: ${error.message}`, 'error');
          }
        } else log(`⚠️ Bot desconectado - agendamento ${schedule.name} ignorado`, 'warning');
      }, { scheduled: false, timezone: "America/Sao_Paulo" });

      task.start();
      activeTasks.set(schedule.id, task);
      log(`✅ Agendamento ativo: ${schedule.name}`, 'success');
    } else log(`⚠️ Agendamento inválido ignorado: ${schedule.name}`, 'warning');
  });

  log(`📅 ${activeTasks.size} agendamentos configurados`, 'info');
}

// Socket.IO eventos
io.on('connection', (socket) => {
  log(`Cliente conectado: ${socket.id}`, 'info');

  socket.emit('botStatus', { connected: whatsappBot ? whatsappBot.isConnected() : false });

  socket.on('initBot', async () => {
    log('Solicitação de inicialização do bot', 'info');
    const success = await initializeBot();
    socket.emit('initResult', { success });
  });

  socket.on('disconnectBot', async () => {
    log('Solicitação de desconexão do bot', 'info');
    activeTasks.forEach(task => { try { task.destroy(); } catch {} });
    activeTasks.clear();
    if (whatsappBot) { await whatsappBot.disconnect(); whatsappBot = null; }
    socket.emit('disconnectResult', { success: true });
    io.emit('botStatus', { connected: false });
    log('Bot desconectado com sucesso', 'success');
  });

  socket.on('clearSession', async () => {
    log('Solicitação de limpeza de sessão', 'info');
    activeTasks.forEach(task => { try { task.destroy(); } catch {} });
    activeTasks.clear();
    if (whatsappBot) { await whatsappBot.disconnect(); whatsappBot = null; }

    await new Promise(resolve => setTimeout(resolve, 2000));

    const sessionsPath = './sessions';
    if (await fs.pathExists(sessionsPath)) await fs.remove(sessionsPath);
    await fs.ensureDir(sessionsPath);

    socket.emit('clearSessionResult', { success: true });
    io.emit('botStatus', { connected: false });
    log('Sessão limpa com sucesso', 'success');
  });

  socket.on('getGroups', async () => {
    log('Solicitação de lista de grupos', 'info');
    if (whatsappBot && whatsappBot.isConnected()) {
      try { const groups = await whatsappBot.getGroups(); socket.emit('groupsList', groups); log(`${groups.length} grupos enviados para interface`, 'info'); }
      catch (error) { log('Erro ao obter grupos: ' + error.message, 'error'); socket.emit('groupsList', []); }
    } else { log('Bot não conectado para buscar grupos', 'warning'); socket.emit('groupsList', []); }
  });

  socket.on('sendVideoNow', async (groupIds) => {
    log(`Envio manual solicitado para ${groupIds.length} grupos`, 'info');
    if (whatsappBot && whatsappBot.isConnected()) {
      try {
        const config = await loadConfig();
        await sendVideoWithAntiBot(groupIds, config);
        socket.emit('sendResult', { success: true });
        log('✅ Envio manual concluído', 'success');
      } catch (error) {
        log('❌ Erro no envio manual: ' + error.message, 'error');
        socket.emit('sendResult', { success: false, error: error.message });
      }
    } else {
      const errorMsg = 'Bot não conectado';
      log('❌ ' + errorMsg, 'error');
      socket.emit('sendResult', { success: false, error: errorMsg });
    }
  });

  socket.on('disconnect', () => { log(`Cliente desconectado: ${socket.id}`, 'info'); });
});

// Rotas da API
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/config', async (req, res) => {
  try {
    log('Solicitação de salvamento de configurações', 'info');
    const config = await loadConfig();
    const newConfig = { ...config, ...req.body };
    const saved = await saveConfig(newConfig);
    if (saved && req.body.schedules) setupSchedules(req.body.schedules, newConfig);
    res.json({ success: saved });
  } catch (error) {
    log('Erro na API de configuração: ' + error.message, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    res.json(config);
  } catch (error) {
    log('Erro ao obter configurações: ' + error.message, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    botConnected: whatsappBot ? whatsappBot.isConnected() : false,
    activeSchedules: activeTasks.size,
    uptime: process.uptime()
  });
});

// Tratamento de erros globais
process.on('uncaughtException', (error) => {
  log('Erro não capturado: ' + error.message, 'error');
  console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log('Promise rejeitada: ' + reason, 'error');
  console.error('Promise rejeitada em:', promise, 'razão:', reason);
});

// Encerramento gracioso
process.on('SIGINT', async () => {
  log('Encerrando aplicação...', 'info');
  activeTasks.forEach(task => { try { task.destroy(); } catch {} });
  if (whatsappBot) { try { await whatsappBot.disconnect(); } catch {} }
  server.close(() => {
    log('Servidor encerrado', 'info');
    process.exit(0);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await fs.ensureDir('./config');
    await fs.ensureDir('./sessions');
    await fs.ensureDir('./logs');
    await fs.ensureDir('./bot');
    await fs.ensureDir('./public');

    server.listen(PORT, () => {
      console.log('🎉 ========================================');
      console.log('    AUTO ENVIOS BOT INICIADO');
      console.log('    Wallysson Studio Dv 2025');
      console.log('    "Você sonha, Deus realiza"');
      console.log('========================================');
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`📱 Acesse: http://localhost:${PORT}`);
      console.log(`⚡ Status: ONLINE`);
      console.log('========================================');
      log('Servidor iniciado com sucesso', 'success');
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error.message);
    process.exit(1);
  }
}

startServer();