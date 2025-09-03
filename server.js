
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const crypto = require('crypto');
globalThis.crypto = crypto;0

console.log('🚀 Iniciando Auto Envios Bot...');

// Verificar dependências críticas
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
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Instância do bot
let whatsappBot = null;
let activeTasks = new Map(); // Para gerenciar cron jobs

// Configurações padrão
const defaultConfig = {
  youtubeApiKey: "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs",
  channelId: "UCh-ceOeY4WVgS8R0onTaXmw",
  schedules: [],
  activeGroups: [],
  botConnected: false
};

// Função para log
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
  console.log(logEntry);
  
  // Emitir para interface
  io.emit('log', {
    message,
    type,
    timestamp
  });
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
    
    // Criar arquivo padrão
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

// Inicializar bot
async function initializeBot() {
  try {
    log('Inicializando WhatsApp Bot...', 'info');
    
    if (whatsappBot) {
      await whatsappBot.disconnect();
    }
    
    whatsappBot = new WhatsAppBot(io, log);
    await whatsappBot.initialize();
    
    // Carregar e configurar agendamentos
    const config = await loadConfig();
    setupSchedules(config.schedules);
    
    log('Bot inicializado com sucesso', 'success');
    return true;
  } catch (error) {
    log('Erro ao inicializar bot: ' + error.message, 'error');
    return false;
  }
}

// Configurar agendamentos
function setupSchedules(schedules) {
  try {
    // Limpar agendamentos existentes
    activeTasks.forEach(task => task.destroy());
    activeTasks.clear();
    
    if (!schedules || schedules.length === 0) {
      log('Nenhum agendamento para configurar', 'info');
      return;
    }
    
    schedules.forEach(schedule => {
      if (schedule.active && schedule.days && schedule.days.length > 0) {
        // Converter dias para formato cron (0=domingo, 1=segunda, etc)
        const cronDays = schedule.days.join(',');
        const cronTime = `${schedule.minute} ${schedule.hour} * * ${cronDays}`;
        
        log(`Configurando agendamento: ${schedule.name} - ${cronTime}`, 'info');
        
        const task = cron.schedule(cronTime, async () => {
          if (whatsappBot && whatsappBot.isConnected()) {
            try {
              const config = await loadConfig();
              if (config.activeGroups && config.activeGroups.length > 0) {
                await whatsappBot.sendLatestVideo(config.activeGroups);
                log(`✅ Vídeo enviado automaticamente - ${schedule.name}`, 'success');
              } else {
                log(`⚠️ Nenhum grupo ativo para envio - ${schedule.name}`, 'warning');
              }
            } catch (error) {
              log(`❌ Erro no envio automático - ${schedule.name}: ${error.message}`, 'error');
            }
          } else {
            log(`⚠️ Bot desconectado - agendamento ${schedule.name} ignorado`, 'warning');
          }
        }, {
          scheduled: false // Não iniciar imediatamente
        });
        
        task.start();
        activeTasks.set(schedule.id, task);
        
        log(`✅ Agendamento ativo: ${schedule.name}`, 'success');
      }
    });
    
    log(`📅 ${activeTasks.size} agendamentos configurados`, 'info');
  } catch (error) {
    log('Erro ao configurar agendamentos: ' + error.message, 'error');
  }
}

// Socket.IO eventos
io.on('connection', (socket) => {
  log(`Cliente conectado: ${socket.id}`, 'info');
  
  // Enviar status atual
  socket.emit('botStatus', {
    connected: whatsappBot ? whatsappBot.isConnected() : false
  });
  
  // Inicializar bot
  socket.on('initBot', async () => {
    log('Solicitação de inicialização do bot', 'info');
    const success = await initializeBot();
    socket.emit('initResult', { success });
  });
  
  // Desconectar bot
  socket.on('disconnectBot', async () => {
    log('Solicitação de desconexão do bot', 'info');
    
    try {
      if (whatsappBot) {
        await whatsappBot.disconnect();
        whatsappBot = null;
      }
      
      // Limpar agendamentos
      activeTasks.forEach(task => task.destroy());
      activeTasks.clear();
      
      // Limpar sessão
      if (await fs.pathExists('./sessions')) {
        await fs.remove('./sessions');
        log('Sessão limpa', 'info');
      }
      
      socket.emit('disconnectResult', { success: true });
      io.emit('botStatus', { connected: false });
    } catch (error) {
      log('Erro ao desconectar: ' + error.message, 'error');
      socket.emit('disconnectResult', { success: false, error: error.message });
    }
  });
  
  // Obter grupos
  socket.on('getGroups', async () => {
    log('Solicitação de lista de grupos', 'info');
    
    if (whatsappBot && whatsappBot.isConnected()) {
      try {
        const groups = await whatsappBot.getGroups();
        socket.emit('groupsList', groups);
        log(`${groups.length} grupos enviados para interface`, 'info');
      } catch (error) {
        log('Erro ao obter grupos: ' + error.message, 'error');
        socket.emit('groupsList', []);
      }
    } else {
      log('Bot não conectado para buscar grupos', 'warning');
      socket.emit('groupsList', []);
    }
  });
  
  // Enviar vídeo manual
  socket.on('sendVideoNow', async (groupIds) => {
    log(`Envio manual solicitado para ${groupIds.length} grupos`, 'info');
    
    if (whatsappBot && whatsappBot.isConnected()) {
      try {
        await whatsappBot.sendLatestVideo(groupIds);
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
  
  socket.on('disconnect', () => {
    log(`Cliente desconectado: ${socket.id}`, 'info');
  });
});

// Rotas da API
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Salvar configurações
app.post('/api/config', async (req, res) => {
  try {
    log('Solicitação de salvamento de configurações', 'info');
    
    const config = await loadConfig();
    const newConfig = { ...config, ...req.body };
    
    const saved = await saveConfig(newConfig);
    
    if (saved && req.body.schedules) {
      setupSchedules(req.body.schedules);
    }
    
    res.json({ success: saved });
  } catch (error) {
    log('Erro na API de configuração: ' + error.message, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obter configurações
app.get('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    res.json(config);
  } catch (error) {
    log('Erro ao obter configurações: ' + error.message, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rota de status
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

// Graceful shutdown
process.on('SIGINT', async () => {
  log('Encerrando aplicação...', 'info');
  
  if (whatsappBot) {
    await whatsappBot.disconnect();
  }
  
  activeTasks.forEach(task => task.destroy());
  
  server.close(() => {
    log('Servidor encerrado', 'info');
    process.exit(0);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Criar diretórios necessários
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