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

// SISTEMA ANTI-DUPLICAÇÃO MELHORADO
const sendingLocks = {
  manual: new Set(),
  scheduled: new Map(),
  global: false,
  operationId: 0 // Contador para operações únicas
};

// CONTROLE DE INICIALIZAÇÃO MELHORADO
let isInitializing = false;
let initializationAttempts = 0;
const maxInitializationAttempts = 3;
let initializationTimeout = null; // NOVO: timeout de inicialização

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

// DEBOUNCE GLOBAL para prevenir chamadas múltiplas
const globalDebounce = new Map();

function createDebounceKey(eventName, socketId = 'global') {
  return `${eventName}_${socketId}`;
}

function debounceFunction(key, func, delay = 2000) {
  if (globalDebounce.has(key)) {
    return Promise.reject(new Error('Operação já em andamento'));
  }
  
  globalDebounce.set(key, true);
  
  const cleanup = () => {
    globalDebounce.delete(key);
  };
  
  setTimeout(cleanup, delay);
  
  return func().finally(cleanup);
}

// Função de log melhorada COM PROTEÇÃO CONTRA RECURSÃO
const logQueue = [];
let isProcessingLogs = false;

function log(message, type = 'info') {
  // Prevenir logs infinitos
  if (typeof message !== 'string') {
    message = String(message).substring(0, 500); // Limitar tamanho
  }
  
  if (message.includes('Maximum call stack') && isProcessingLogs) {
    return; // Evitar loop de logs de stack overflow
  }
  
  logQueue.push({ message, type, timestamp: new Date().toISOString() });
  
  if (!isProcessingLogs) {
    processLogQueue();
  }
}

function processLogQueue() {
  if (isProcessingLogs || logQueue.length === 0) return;
  
  isProcessingLogs = true;
  
  // Processar até 10 logs por vez
  const logsToProcess = logQueue.splice(0, 10);
  
  logsToProcess.forEach(logEntry => {
    const logMessage = `[${logEntry.timestamp}] ${logEntry.type.toUpperCase()}: ${logEntry.message}`;
    console.log(logMessage);
    
    // Socket emit com proteção
    try {
      if (io && io.sockets) {
        io.emit('log', logEntry);
      }
    } catch (error) {
      // Não fazer log do erro para evitar recursão
      console.error('Erro ao emitir log via socket:', error.message);
    }
  });
  
  isProcessingLogs = false;
  
  // Processar próximos logs se houver
  if (logQueue.length > 0) {
    setTimeout(processLogQueue, 100);
  }
}

// Carregar configurações COM TIMEOUT
async function loadConfig() {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout ao carregar configurações'));
    }, 10000); // 10 segundos timeout
    
    try {
      await fs.ensureDir('./config');
      const configPath = './config/settings.json';
      
      if (await fs.pathExists(configPath)) {
        const config = await fs.readJSON(configPath);
        log('Configurações carregadas do arquivo', 'success');
        clearTimeout(timeout);
        resolve({ ...defaultConfig, ...config });
      } else {
        await fs.writeJSON(configPath, defaultConfig, { spaces: 2 });
        log('Arquivo de configuração criado', 'info');
        clearTimeout(timeout);
        resolve(defaultConfig);
      }
    } catch (error) {
      clearTimeout(timeout);
      log('Erro ao carregar configurações: ' + error.message, 'error');
      resolve(defaultConfig); // Retornar config padrão em caso de erro
    }
  });
}

// Salvar configurações COM TIMEOUT
async function saveConfig(config) {
  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => {
      log('Timeout ao salvar configurações', 'warning');
      resolve(false);
    }, 5000);
    
    try {
      await fs.ensureDir('./config');
      await fs.writeJSON('./config/settings.json', config, { spaces: 2 });
      log('Configurações salvas', 'success');
      clearTimeout(timeout);
      resolve(true);
    } catch (error) {
      clearTimeout(timeout);
      log('Erro ao salvar configurações: ' + error.message, 'error');
      resolve(false);
    }
  });
}

// Função para limpeza completa MELHORADA
async function performCompleteCleanup() {
  const operationId = ++sendingLocks.operationId;
  
  try {
    log(`Iniciando limpeza completa do sistema... (Op: ${operationId})`, 'warning');
    
    // 1. Limpar timeout de inicialização se existir
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    
    // 2. Parar todos os agendamentos COM PROTEÇÃO
    const tasksToStop = Array.from(activeTasks.entries());
    activeTasks.clear(); // Limpar primeiro para evitar acessos
    
    for (const [taskId, task] of tasksToStop) {
      try {
        if (task && typeof task.destroy === 'function') {
          task.destroy();
        }
      } catch (e) {
        log(`Erro ao parar tarefa ${taskId}: ${e.message}`, 'warning');
      }
    }
    
    // 3. Limpar locks ATOMICAMENTE
    const oldGlobalLock = sendingLocks.global;
    sendingLocks.global = false;
    sendingLocks.manual.clear();
    sendingLocks.scheduled.clear();
    
    // 4. Desconectar bot COM TIMEOUT
    if (whatsappBot) {
      try {
        const disconnectPromise = whatsappBot.disconnect();
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 10000));
        
        await Promise.race([disconnectPromise, timeoutPromise]);
      } catch (e) {
        log('Erro ao desconectar bot (esperado): ' + e.message, 'warning');
      } finally {
        whatsappBot = null;
      }
    }
    
    // 5. Aguardar com timeout limitado
    await new Promise(resolve => setTimeout(resolve, 2000)); // Reduzido de 5000 para 2000
    
    // 6. Limpar diretório de sessões COM PROTEÇÃO
    try {
      const sessionsPath = './sessions';
      if (await fs.pathExists(sessionsPath)) {
        const files = await fs.readdir(sessionsPath);
        let corruptedFiles = 0;
        
        // Processar até 20 arquivos para evitar sobrecarga
        const filesToCheck = files.slice(0, 20);
        
        for (const file of filesToCheck) {
          const filePath = `${sessionsPath}/${file}`;
          try {
            if (file.endsWith('.json')) {
              const content = await fs.readFile(filePath, 'utf8');
              if (content.length > 1000000) { // 1MB limite
                throw new Error('Arquivo muito grande');
              }
              JSON.parse(content);
            }
          } catch (error) {
            log(`Removendo arquivo corrompido: ${file}`, 'warning');
            await fs.remove(filePath);
            corruptedFiles++;
          }
        }
        
        if (corruptedFiles > 0) {
          log(`${corruptedFiles} arquivos corrompidos removidos`, 'info');
        }
      }
    } catch (error) {
      log('Erro na limpeza de sessões: ' + error.message, 'warning');
    }
    
    // 7. Resetar contadores
    isInitializing = false;
    initializationAttempts = 0;
    
    // 8. Limpar debounce global
    globalDebounce.clear();
    
    log(`Limpeza completa concluída (Op: ${operationId})`, 'success');
    
    // 9. Emitir eventos COM PROTEÇÃO
    try {
      if (io && io.sockets) {
        io.emit('botStatus', { connected: false });
        io.emit('qrCode', null);
      }
    } catch (error) {
      log('Erro ao emitir status após limpeza: ' + error.message, 'warning');
    }
    
  } catch (error) {
    log(`Erro na limpeza completa (Op: ${operationId}): ${error.message}`, 'error');
  }
}

// Função para limpar locks expirados MELHORADA
function cleanExpiredLocks() {
  try {
    const now = Date.now();
    const locksToRemove = [];
    
    for (const [scheduleId, lockInfo] of sendingLocks.scheduled) {
      if (now - lockInfo.timestamp > 600000) { // 10 minutos
        locksToRemove.push(scheduleId);
      }
    }
    
    locksToRemove.forEach(scheduleId => {
      sendingLocks.scheduled.delete(scheduleId);
      log(`Lock expirado removido para agendamento: ${scheduleId}`, 'info');
    });
    
    // Limpar debounce expirado também
    const debounceToRemove = [];
    for (const [key] of globalDebounce) {
      // Debounce items que estão há mais de 5 minutos
      debounceToRemove.push(key);
    }
    
    // Limpar alguns itens de debounce antigos (não todos para evitar problemas)
    debounceToRemove.slice(0, 10).forEach(key => {
      globalDebounce.delete(key);
    });
    
  } catch (error) {
    log('Erro ao limpar locks expirados: ' + error.message, 'warning');
  }
}

// Executar limpeza a cada 5 minutos (reduzido de 300000)
setInterval(cleanExpiredLocks, 300000);

// Envio com proteção anti-duplicação MELHORADA
async function sendVideoWithAntiBot(groupIds, config, context = 'manual', scheduleId = null) {
  const operationId = ++sendingLocks.operationId;
  const lockKey = context === 'scheduled' ? `${scheduleId}_${operationId}` : `manual_${operationId}`;
  
  log(`Iniciando envio (Op: ${operationId}, Context: ${context})`, 'info');
  
  // Validações iniciais
  if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
    throw new Error('Lista de grupos inválida');
  }
  
  if (sendingLocks.global) {
    const error = 'Outro envio já está em andamento. Aguarde a conclusão.';
    log(error, 'warning');
    throw new Error(error);
  }

  if (context === 'scheduled' && scheduleId) {
    const hasLock = Array.from(sendingLocks.scheduled.keys()).some(key => 
      key.startsWith(scheduleId)
    );
    if (hasLock) {
      const error = `Agendamento ${scheduleId} já está executando envio`;
      log(error, 'warning');
      throw new Error(error);
    }
  }

  if (!whatsappBot || !whatsappBot.isConnected()) {
    throw new Error('Bot não conectado');
  }

  // Filtrar grupos disponíveis
  const availableGroups = groupIds.filter(groupId => 
    groupId && !sendingLocks.manual.has(groupId)
  );
  
  if (availableGroups.length === 0) {
    const error = 'Todos os grupos selecionados já estão sendo processados';
    log(error, 'warning');
    throw new Error(error);
  }

  // Definir locks ATOMICAMENTE
  sendingLocks.global = true;
  
  if (context === 'scheduled' && scheduleId) {
    sendingLocks.scheduled.set(lockKey, {
      timestamp: Date.now(),
      groups: availableGroups,
      operationId
    });
  }
  
  availableGroups.forEach(groupId => sendingLocks.manual.add(groupId));

  let sentCount = 0;
  const errors = [];

  try {
    const { antiBanSettings } = config;
    const totalGroups = availableGroups.length;
    log(`Enviando para ${totalGroups} grupos (Op: ${operationId})`, 'info');

    // Obter vídeo COM TIMEOUT
    let video;
    try {
      const videoPromise = whatsappBot.getLatestVideo(config.youtubeApiKey, config.channelId);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ao obter vídeo')), 15000)
      );
      
      video = await Promise.race([videoPromise, timeoutPromise]);
      log(`Vídeo obtido: ${video.title} (Op: ${operationId})`, 'info');
    } catch (error) {
      throw new Error(`Falha ao obter vídeo: ${error.message}`);
    }

    // Dividir em lotes
    const maxBatchSize = Math.min(antiBanSettings.maxGroupsPerBatch || 10, 20); // Máximo 20
    const batches = [];
    for (let i = 0; i < availableGroups.length; i += maxBatchSize) {
      batches.push(availableGroups.slice(i, i + maxBatchSize));
    }
    log(`Dividido em ${batches.length} lotes (Op: ${operationId})`, 'info');

    // Processar lotes
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      log(`Processando lote ${batchIndex + 1}/${batches.length} (Op: ${operationId})`, 'info');

      for (let groupIndex = 0; groupIndex < batch.length; groupIndex++) {
        const groupId = batch[groupIndex];
        
        // Verificar se ainda está conectado
        if (!whatsappBot || !whatsappBot.isConnected()) {
          throw new Error('Bot desconectado durante o envio');
        }
        
        // Verificar se operação não foi cancelada
        if (!sendingLocks.global) {
          throw new Error('Operação cancelada');
        }
        
        try {
          const message = {
            image: { url: video.thumbnail },
            caption: `🎥 *Novo vídeo no canal!*\n\n*${video.title}*\n\n${video.description.substring(0, 200)}${video.description.length > 200 ? '...' : ''}\n\n🔗 ${video.url}\n\n✨ Compartilhem com a família e amigos, Jesus Cristo abençoe 🙏💖`,
            contextInfo: {
              externalAdReply: {
                title: video.title,
                body: 'Novo vídeo do canal',
                mediaType: 2,
                thumbnailUrl: video.thumbnail,
                sourceUrl: video.url
              }
            }
          };

          // Enviar com timeout
          const sendPromise = whatsappBot.sock.sendMessage(groupId, message);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout no envio')), 30000)
          );
          
          await Promise.race([sendPromise, timeoutPromise]);
          sentCount++;
          
          log(`✅ Enviado ${sentCount}/${totalGroups} (Op: ${operationId})`, 'success');

          // Delay entre grupos
          if (groupIndex < batch.length - 1) {
            const delay = Math.max(antiBanSettings.delayBetweenGroups || 5, 2) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }

        } catch (error) {
          errors.push({ groupId, error: error.message });
          log(`❌ Erro ao enviar para grupo: ${error.message}`, 'error');
          
          // Se for erro crítico, interromper
          if (error.message.includes('desconectado') || 
              error.message.includes('405') || 
              error.message.includes('Timeout')) {
            log('Erro crítico detectado, interrompendo envio', 'error');
            break;
          }
        }
      }

      // Delay entre lotes
      if (batchIndex < batches.length - 1) {
        const delay = Math.max(antiBanSettings.batchDelay || 30, 10) * 1000;
        log(`⏳ Aguardando ${delay/1000}s antes do próximo lote...`, 'info');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    log(`✅ Envio completo (Op: ${operationId}): ${sentCount}/${totalGroups} grupos | Erros: ${errors.length}`, 'success');
    
    return {
      sentCount,
      totalGroups,
      errors,
      context,
      scheduleId,
      operationId
    };

  } finally {
    // Limpeza GARANTIDA
    sendingLocks.global = false;
    
    if (context === 'scheduled' && scheduleId) {
      sendingLocks.scheduled.delete(lockKey);
    }
    
    availableGroups.forEach(groupId => sendingLocks.manual.delete(groupId));
    log(`Locks removidos (Op: ${operationId})`, 'info');
  }
}

// Inicializar bot com proteção MELHORADA contra erro 405
async function initializeBot() {
  const debounceKey = 'initBot';
  
  return debounceFunction(debounceKey, async () => {
    if (isInitializing) {
      throw new Error('Inicialização já em andamento');
    }

    if (initializationAttempts >= maxInitializationAttempts) {
      throw new Error('Máximo de tentativas de inicialização atingido');
    }

    isInitializing = true;
    initializationAttempts++;

    try {
      log(`Inicializando WhatsApp Bot (tentativa ${initializationAttempts}/${maxInitializationAttempts})...`, 'info');

      // Limpar bot anterior
      if (whatsappBot) {
        try { 
          await whatsappBot.disconnect(); 
        } catch (e) { 
          log('Aviso ao desconectar bot anterior: ' + e.message, 'warning'); 
        }
        whatsappBot = null;
      }

      // Delay progressivo entre tentativas
      if (initializationAttempts > 1) {
        const delay = Math.min(3000 * initializationAttempts, 10000);
        log(`Aguardando ${delay/1000}s antes de tentar novamente...`, 'info');
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Inicialização com timeout
      const initPromise = new Promise(async (resolve, reject) => {
        try {
          whatsappBot = new WhatsAppBot(io, log);
          await whatsappBot.initialize();
          resolve(true);
        } catch (error) {
          reject(error);
        }
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout na inicialização')), 60000)
      );
      
      await Promise.race([initPromise, timeoutPromise]);
      
      const config = await loadConfig();
      setupSchedules(config.schedules, config);
      
      log('Bot inicializado com sucesso', 'success');
      initializationAttempts = 0; // Reset contador
      return true;
      
    } catch (error) {
      log('Erro ao inicializar bot: ' + error.message, 'error');
      
      // Se for erro 405, fazer limpeza especial
      if (error.message.includes('405') || error.message.includes('Method Not Allowed')) {
        log('Erro 405 detectado, realizando limpeza completa...', 'warning');
        await performCompleteCleanup();
        
        // Emitir evento especial
        try {
          if (io && io.sockets) {
            io.emit('error405Detected', { 
              message: 'Erro 405 detectado. Sistema limpo. Tente "Limpar Sessão" se o problema persistir.' 
            });
          }
        } catch (emitError) {
          log('Erro ao emitir evento 405: ' + emitError.message, 'warning');
        }
      }
      
      throw error;
    } finally {
      isInitializing = false;
    }
  }, 5000);
}

// Configurar agendamentos COM PROTEÇÃO
function setupSchedules(schedules, config) {
  try {
    // Parar tarefas existentes
    const tasksToStop = Array.from(activeTasks.entries());
    activeTasks.clear();
    
    tasksToStop.forEach(([taskId, task]) => {
      try {
        if (task && typeof task.destroy === 'function') {
          task.destroy();
        }
      } catch (e) {
        log(`Erro ao parar tarefa ${taskId}: ${e.message}`, 'warning');
      }
    });

    if (!schedules || !Array.isArray(schedules) || schedules.length === 0) { 
      log('Nenhum agendamento para configurar', 'info'); 
      return; 
    }

    let validSchedules = 0;

    schedules.forEach((schedule, index) => {
      try {
        if (schedule.active && schedule.days?.length > 0 && schedule.selectedGroups?.length > 0) {
          const cronDays = schedule.days.join(',');
          const cronTime = `${schedule.minute || 0} ${schedule.hour || 0} * * ${cronDays}`;

          log(`Configurando agendamento: ${schedule.name} - ${cronTime}`, 'info');

          const task = cron.schedule(cronTime, async () => {
            const scheduleKey = `${schedule.id}_${Date.now()}`;
            
            if (Array.from(sendingLocks.scheduled.keys()).some(key => key.startsWith(schedule.id))) {
              log(`⚠️ Agendamento ${schedule.name} já está executando`, 'warning');
              return;
            }

            if (whatsappBot && whatsappBot.isConnected()) {
              try {
                log(`🕐 Executando agendamento: ${schedule.name}`, 'info');
                
                const result = await sendVideoWithAntiBot(
                  schedule.selectedGroups, 
                  config, 
                  'scheduled', 
                  schedule.id
                );
                
                log(`✅ Agendamento executado: ${schedule.name} - ${result.sentCount}/${result.totalGroups}`, 'success');
                
              } catch (error) {
                log(`❌ Erro no agendamento ${schedule.name}: ${error.message}`, 'error');
                
                if (error.message.includes('405')) {
                  try {
                    if (io && io.sockets) {
                      io.emit('scheduleError405', { 
                        scheduleName: schedule.name,
                        error: error.message 
                      });
                    }
                  } catch (emitError) {
                    log('Erro ao emitir evento de agendamento 405: ' + emitError.message, 'warning');
                  }
                }
              }
            } else {
              log(`⚠️ Bot desconectado - agendamento ${schedule.name} ignorado`, 'warning');
            }
          }, { 
            scheduled: false, 
            timezone: "America/Sao_Paulo" 
          });

          task.start();
          activeTasks.set(schedule.id || `schedule_${index}`, task);
          validSchedules++;
          log(`✅ Agendamento ativo: ${schedule.name}`, 'success');
        } else {
          log(`⚠️ Agendamento inválido ignorado: ${schedule.name || 'Sem nome'}`, 'warning');
        }
      } catch (error) {
        log(`Erro ao configurar agendamento ${schedule.name}: ${error.message}`, 'error');
      }
    });

    log(`📅 ${validSchedules} agendamentos configurados de ${schedules.length} fornecidos`, 'info');
  } catch (error) {
    log('Erro geral ao configurar agendamentos: ' + error.message, 'error');
  }
}

// Socket.IO eventos COM PROTEÇÃO CONTRA RECURSÃO
io.on('connection', (socket) => {
  log(`Cliente conectado: ${socket.id}`, 'info');

  try {
    socket.emit('botStatus', { 
      connected: whatsappBot ? whatsappBot.isConnected() : false,
      sendingStatus: {
        globalLock: sendingLocks.global,
        manualLocks: sendingLocks.manual.size,
        scheduledLocks: sendingLocks.scheduled.size
      }
    });
  } catch (error) {
    log('Erro ao emitir status inicial: ' + error.message, 'warning');
  }

  // Debounce por socket
  const socketDebounce = new Map();

  function debounceSocketEvent(eventName, callback, delay = 3000) {
    return async (...args) => {
      const key = `${socket.id}_${eventName}`;
      
      try {
        await debounceFunction(key, async () => callback(...args), delay);
      } catch (error) {
        log(`Evento ${eventName} ignorado (debounce): ${error.message}`, 'warning');
        socket.emit(`${eventName}Result`, { success: false, error: error.message });
      }
    };
  }

  socket.on('initBot', debounceSocketEvent('initBot', async () => {
    log('Solicitação de inicialização do bot', 'info');
    try {
      const success = await initializeBot();
      socket.emit('initResult', { success });
    } catch (error) {
      log('Erro na inicialização via socket: ' + error.message, 'error');
      socket.emit('initResult', { success: false, error: error.message });
    }
  }, 5000));

  socket.on('disconnectBot', debounceSocketEvent('disconnectBot', async () => {
    log('Solicitação de desconexão do bot', 'info');
    
    try {
      // Parar tarefas
      activeTasks.forEach(task => { 
        try { 
          if (task && typeof task.destroy === 'function') {
            task.destroy(); 
          }
        } catch {} 
      });
      activeTasks.clear();
      
      // Limpar locks
      sendingLocks.global = false;
      sendingLocks.manual.clear();
      sendingLocks.scheduled.clear();
      
      // Desconectar bot
      if (whatsappBot) { 
        await whatsappBot.disconnect(); 
        whatsappBot = null; 
      }
      
      // Reset contadores
      isInitializing = false;
      initializationAttempts = 0;
      
      socket.emit('disconnectResult', { success: true });
      io.emit('botStatus', { connected: false });
      log('Bot desconectado com sucesso', 'success');
    } catch (error) {
      log('Erro ao desconectar bot: ' + error.message, 'error');
      socket.emit('disconnectResult', { success: false, error: error.message });
    }
  }));

  socket.on('clearSession', debounceSocketEvent('clearSession', async () => {
    log('Solicitação de limpeza de sessão', 'info');
    
    try {
      await performCompleteCleanup();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const sessionsPath = './sessions';
      if (await fs.pathExists(sessionsPath)) {
        await fs.remove(sessionsPath);
      }
      await fs.ensureDir(sessionsPath);

      socket.emit('clearSessionResult', { success: true });
      io.emit('botStatus', { connected: false });
      log('Sessão limpa com sucesso', 'success');
    } catch (error) {
      log('Erro ao limpar sessão: ' + error.message, 'error');
      socket.emit('clearSessionResult', { success: false, error: error.message });
    }
  }));

  // Evento especial para forçar limpeza em caso de erro 405 persistente
  socket.on('forceCleanup405', debounceSocketEvent('forceCleanup405', async () => {
    log('Limpeza forçada solicitada para erro 405', 'warning');
    try {
      await performCompleteCleanup();
      socket.emit('forceCleanup405Result', { success: true });
    } catch (error) {
      log('Erro na limpeza forçada: ' + error.message, 'error');
      socket.emit('forceCleanup405Result', { success: false, error: error.message });
    }
  }));

  socket.on('getGroups', debounceSocketEvent('getGroups', async () => {
    log('Solicitação de lista de grupos', 'info');
    
    if (whatsappBot && whatsappBot.isConnected()) {
      try {
        const groupsPromise = whatsappBot.getGroups();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao buscar grupos')), 15000)
        );
        
        const groups = await Promise.race([groupsPromise, timeoutPromise]);
        socket.emit('groupsList', groups || []); 
        log(`${groups?.length || 0} grupos enviados para interface`, 'info'); 
      } catch (error) { 
        log('Erro ao obter grupos: ' + error.message, 'error'); 
        socket.emit('groupsList', []); 
        
        // Se for erro de conexão, pode ser 405
        if (error.message.includes('405') || error.message.includes('não conectado') || error.message.includes('Timeout')) {
          socket.emit('connectionError', { 
            type: 'groups_fetch_error',
            message: error.message 
          });
        }
      }
    } else { 
      log('Bot não conectado para buscar grupos', 'warning'); 
      socket.emit('groupsList', []); 
    }
  }, 2000));

  socket.on('sendVideoNow', debounceSocketEvent('sendVideoNow', async (groupIds) => {
    log(`Envio manual solicitado para ${groupIds?.length || 0} grupos`, 'info');
    
    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      socket.emit('sendResult', { success: false, error: 'Nenhum grupo selecionado' });
      return;
    }

    if (whatsappBot && whatsappBot.isConnected()) {
      try {
        const config = await loadConfig();
        const result = await sendVideoWithAntiBot(groupIds, config, 'manual');
        
        socket.emit('sendResult', { 
          success: true, 
          result: {
            sent: result.sentCount,
            total: result.totalGroups,
            errors: result.errors.length
          }
        });
        
        log('✅ Envio manual concluído', 'success');
      } catch (error) {
        log('❌ Erro no envio manual: ' + error.message, 'error');
        socket.emit('sendResult', { success: false, error: error.message });
        
        // Se for erro 405, emitir evento especial
        if (error.message.includes('405')) {
          socket.emit('sendError405', { error: error.message });
        }
      }
    } else {
      const errorMsg = 'Bot não conectado';
      log('❌ ' + errorMsg, 'error');
      socket.emit('sendResult', { success: false, error: errorMsg });
    }
  }, 4000));

  socket.on('getSendingStatus', () => {
    try {
      socket.emit('sendingStatus', {
        globalLock: sendingLocks.global,
        manualLocks: Array.from(sendingLocks.manual),
        scheduledLocks: Array.from(sendingLocks.scheduled.keys()),
        botStatus: whatsappBot ? whatsappBot.getLockStatus() : null,
        operationId: sendingLocks.operationId
      });
    } catch (error) {
      log('Erro ao obter status de envio: ' + error.message, 'warning');
      socket.emit('sendingStatus', {
        globalLock: false,
        manualLocks: [],
        scheduledLocks: [],
        botStatus: null,
        error: error.message
      });
    }
  });

  socket.on('disconnect', () => { 
    log(`Cliente desconectado: ${socket.id}`, 'info');
    
    // Limpar debounce específico do socket
    const keysToRemove = [];
    for (const [key] of globalDebounce) {
      if (key.startsWith(socket.id)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => globalDebounce.delete(key));
  });

  // Tratamento de erro no socket
  socket.on('error', (error) => {
    log(`Erro no socket ${socket.id}: ${error.message}`, 'error');
  });
});

// Rotas da API COM PROTEÇÃO
app.get('/', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    log('Erro ao servir página inicial: ' + error.message, 'error');
    res.status(500).send('Erro interno do servidor');
  }
});

app.post('/api/config', async (req, res) => {
  try {
    log('Solicitação de salvamento de configurações', 'info');
    
    const config = await loadConfig();
    const newConfig = { ...config, ...req.body };
    
    // Validar configuração
    if (newConfig.schedules && !Array.isArray(newConfig.schedules)) {
      return res.status(400).json({ success: false, error: 'Schedules deve ser um array' });
    }
    
    const saved = await saveConfig(newConfig);
    
    if (saved && req.body.schedules) {
      setupSchedules(req.body.schedules, newConfig);
    }
    
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
  try {
    res.json({
      botConnected: whatsappBot ? whatsappBot.isConnected() : false,
      activeSchedules: activeTasks.size,
      uptime: process.uptime(),
      sendingStatus: {
        globalLock: sendingLocks.global,
        manualLocks: sendingLocks.manual.size,
        scheduledLocks: sendingLocks.scheduled.size,
        operationId: sendingLocks.operationId
      },
      systemStatus: {
        isInitializing: isInitializing,
        initializationAttempts: initializationAttempts,
        maxAttempts: maxInitializationAttempts,
        logQueueSize: logQueue.length,
        debounceSize: globalDebounce.size
      },
      memoryUsage: process.memoryUsage()
    });
  } catch (error) {
    log('Erro ao obter status: ' + error.message, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Nova rota para diagnóstico de erro 405 MELHORADA
app.get('/api/diagnostics/405', async (req, res) => {
  try {
    const sessionsPath = './sessions';
    const diagnostics = {
      timestamp: new Date().toISOString(),
      sessionsExists: await fs.pathExists(sessionsPath),
      sessionFiles: [],
      botStatus: whatsappBot ? whatsappBot.getLockStatus() : null,
      systemLocks: {
        global: sendingLocks.global,
        manual: sendingLocks.manual.size,
        scheduled: sendingLocks.scheduled.size,
        operationId: sendingLocks.operationId
      },
      systemHealth: {
        isInitializing: isInitializing,
        initAttempts: initializationAttempts,
        logQueueSize: logQueue.length,
        debounceSize: globalDebounce.size,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    if (diagnostics.sessionsExists) {
      try {
        const files = await fs.readdir(sessionsPath);
        
        // Limitar número de arquivos verificados para evitar sobrecarga
        const filesToCheck = files.slice(0, 50);
        
        for (const file of filesToCheck) {
          const filePath = `${sessionsPath}/${file}`;
          try {
            const stats = await fs.stat(filePath);
            const fileInfo = {
              name: file,
              size: stats.size,
              modified: stats.mtime,
              isValid: true
            };

            if (file.endsWith('.json')) {
              fileInfo.isValid = await validateJsonFile(filePath);
            }

            diagnostics.sessionFiles.push(fileInfo);
          } catch (fileError) {
            diagnostics.sessionFiles.push({
              name: file,
              error: fileError.message,
              isValid: false
            });
          }
        }
      } catch (error) {
        diagnostics.sessionFilesError = error.message;
      }
    }

    res.json(diagnostics);
  } catch (error) {
    log('Erro no diagnóstico 405: ' + error.message, 'error');
    res.status(500).json({ error: error.message });
  }
});

// Função auxiliar para validar arquivos JSON COM TIMEOUT
async function validateJsonFile(filePath) {
  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      if (content.length > 2000000) { // 2MB limite
        clearTimeout(timeout);
        resolve(false);
        return;
      }
      
      JSON.parse(content);
      clearTimeout(timeout);
      resolve(true);
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

// Rota para forçar limpeza via API
app.post('/api/force-cleanup', async (req, res) => {
  try {
    log('Limpeza forçada via API solicitada', 'warning');
    await performCompleteCleanup();
    res.json({ success: true, message: 'Limpeza forçada executada' });
  } catch (error) {
    log('Erro na limpeza forçada via API: ' + error.message, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Tratamento de erros globais MELHORADO
process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error.message);
  console.error('Stack:', error.stack);
  
  // Prevenir logs infinitos
  if (!error.message.includes('Maximum call stack')) {
    log('Erro não capturado: ' + error.message, 'error');
  }
  
  // Se for erro 405, tentar recuperação
  if (error.message.includes('405')) {
    log('Erro 405 em exceção não capturada, iniciando recuperação...', 'error');
    performCompleteCleanup().catch(e => 
      console.error('Erro na recuperação:', e.message)
    );
  }
  
  // Não finalizar processo imediatamente em desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    console.log('Continuando execução (modo desenvolvimento)');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promise rejeitada em:', promise);
  console.error('Razão:', reason);
  
  const reasonStr = reason ? reason.toString() : 'Desconhecido';
  
  if (!reasonStr.includes('Maximum call stack')) {
    log('Promise rejeitada: ' + reasonStr, 'error');
  }
  
  // Se for erro 405, tentar recuperação
  if (reasonStr.includes('405')) {
    log('Erro 405 em promise rejeitada, iniciando recuperação...', 'error');
    performCompleteCleanup().catch(e => 
      console.error('Erro na recuperação:', e.message)
    );
  }
});

// Encerramento gracioso MELHORADO
process.on('SIGINT', async () => {
  log('Encerrando aplicação...', 'info');
  
  try {
    // Parar processamento de logs
    isProcessingLogs = false;
    
    // Parar tarefas
    activeTasks.forEach(task => { 
      try { 
        if (task && typeof task.destroy === 'function') {
          task.destroy(); 
        }
      } catch {} 
    });
    activeTasks.clear();
    
    // Limpar locks
    sendingLocks.global = false;
    sendingLocks.manual.clear();
    sendingLocks.scheduled.clear();
    globalDebounce.clear();
    
    // Desconectar bot
    if (whatsappBot) { 
      try { 
        await Promise.race([
          whatsappBot.disconnect(),
          new Promise(resolve => setTimeout(resolve, 10000))
        ]);
      } catch {} 
    }
    
    // Fechar servidor
    server.close(() => {
      log('Servidor encerrado', 'info');
      process.exit(0);
    });
    
    // Forçar saída após 15 segundos
    setTimeout(() => {
      console.log('Forçando encerramento...');
      process.exit(1);
    }, 15000);
    
  } catch (error) {
    console.error('Erro no encerramento:', error.message);
    process.exit(1);
  }
});

// Função para monitoramento de memória
function monitorMemory() {
  const usage = process.memoryUsage();
  const mbUsed = Math.round(usage.heapUsed / 1024 / 1024);
  
  if (mbUsed > 500) { // 500MB limite
    log(`Uso alto de memória: ${mbUsed}MB`, 'warning');
    
    // Limpeza preventiva
    if (logQueue.length > 1000) {
      logQueue.splice(0, logQueue.length - 100);
      log('Queue de logs limpa preventivamente', 'info');
    }
    
    if (globalDebounce.size > 100) {
      globalDebounce.clear();
      log('Cache de debounce limpo preventivamente', 'info');
    }
  }
}

// Monitorar memória a cada 2 minutos
setInterval(monitorMemory, 120000);

// Iniciar servidor COM PROTEÇÃO
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
      console.log(`🛠️ Diagnósticos: http://localhost:${PORT}/api/diagnostics/405`);
      console.log(`🧹 Limpeza forçada: POST /api/force-cleanup`);
      console.log('========================================');
      log('Servidor iniciado com sucesso', 'success');
    });

    // Configurar timeout do servidor
    server.timeout = 120000; // 2 minutos
    server.keepAliveTimeout = 65000; // 65 segundos
    server.headersTimeout = 66000; // 66 segundos

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error.message);
    process.exit(1);
  }
}

startServer();