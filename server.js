const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const WhatsAppBot = require('./bot/whatsapp-bot');

const app = express();
const server = createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Instância do bot
let whatsappBot = null;

// Configurações padrão
const defaultConfig = {
  youtubeApiKey: "AIzaSyDubEpb0TkgZjiyjA9-1QM_56Kwnn_SMPs",
  channelId: "UCh-ceOeY4WVgS8R0onTaXmw",
  schedules: [],
  activeGroups: [],
  botConnected: false
};

// Carregar configurações
async function loadConfig() {
  try {
    if (await fs.pathExists('./config/settings.json')) {
      const config = await fs.readJSON('./config/settings.json');
      return { ...defaultConfig, ...config };
    }
    return defaultConfig;
  } catch (error) {
    console.error('Erro ao carregar configurações:', error);
    return defaultConfig;
  }
}

// Salvar configurações
async function saveConfig(config) {
  try {
    await fs.ensureDir('./config');
    await fs.writeJSON('./config/settings.json', config, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    return false;
  }
}

// Inicializar bot
async function initializeBot() {
  try {
    whatsappBot = new WhatsAppBot(io);
    await whatsappBot.initialize();
    
    // Carregar agendamentos
    const config = await loadConfig();
    setupSchedules(config.schedules);
    
    return true;
  } catch (error) {
    console.error('Erro ao inicializar bot:', error);
    return false;
  }
}

// Configurar agendamentos
function setupSchedules(schedules) {
  // Limpar agendamentos existentes
  cron.getTasks().forEach(task => task.destroy());
  
  schedules.forEach(schedule => {
    if (schedule.active) {
      const cronTime = `${schedule.minute} ${schedule.hour} * * ${schedule.days.join(',')}`;
      
      cron.schedule(cronTime, async () => {
        if (whatsappBot && whatsappBot.isConnected()) {
          const config = await loadConfig();
          await whatsappBot.sendLatestVideo(config.activeGroups);
          io.emit('log', {
            type: 'info',
            message: `Vídeo enviado automaticamente - ${schedule.name}`,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      console.log(`Agendamento configurado: ${schedule.name} - ${cronTime}`);
    }
  });
}

// Socket.IO eventos
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  
  // Enviar status atual
  socket.emit('botStatus', {
    connected: whatsappBot ? whatsappBot.isConnected() : false
  });
  
  // Inicializar bot
  socket.on('initBot', async () => {
    const success = await initializeBot();
    socket.emit('initResult', { success });
  });
  
  // Desconectar bot
  socket.on('disconnectBot', async () => {
    if (whatsappBot) {
      await whatsappBot.disconnect();
      whatsappBot = null;
    }
    
    // Limpar sessão
    try {
      await fs.remove('./sessions');
      socket.emit('disconnectResult', { success: true });
    } catch (error) {
      socket.emit('disconnectResult', { success: false, error: error.message });
    }
  });
  
  // Obter grupos
  socket.on('getGroups', async () => {
    if (whatsappBot && whatsappBot.isConnected()) {
      const groups = await whatsappBot.getGroups();
      socket.emit('groupsList', groups);
    } else {
      socket.emit('groupsList', []);
    }
  });
  
  // Enviar vídeo manual
  socket.on('sendVideoNow', async (groupIds) => {
    if (whatsappBot && whatsappBot.isConnected()) {
      await whatsappBot.sendLatestVideo(groupIds);
      socket.emit('sendResult', { success: true });
    } else {
      socket.emit('sendResult', { success: false, error: 'Bot não conectado' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Rotas da API
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Salvar configurações
app.post('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    const newConfig = { ...config, ...req.body };
    
    const saved = await saveConfig(newConfig);
    
    if (saved && req.body.schedules) {
      setupSchedules(req.body.schedules);
    }
    
    res.json({ success: saved });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obter configurações
app.get('/api/config', async (req, res) => {
  try {
    const config = await loadConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📱 Acesse: http://localhost:${PORT}`);
  
  // Criar diretórios necessários
  await fs.ensureDir('./config');
  await fs.ensureDir('./sessions');
  await fs.ensureDir('./logs');
});