const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const axios = require('axios');
const P = require('pino');

class WhatsAppBot {
  constructor(io, logger) {
    this.io = io;
    this.log = logger;
    this.sock = null;
    this.isConnectedFlag = false;
    this.groups = [];
    this.retryCount = 0;
    this.maxRetries = 3;
    
    // SISTEMA ANTI-DUPLICAÇÃO
    this.sendingQueue = new Map();
    this.lastVideoCache = null;
    this.videoCacheExpiry = 5 * 60 * 1000; // 5 minutos
    this.messageLocks = new Set();
    this.groupLocks = new Set();
    this.requestCounter = 0;
    
    // CONTROLE DE SESSÃO
    this.isInitializing = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
    this.reconnectDelay = 5000; // 5 segundos
  }

  async initialize() {
    if (this.isInitializing) {
      this.log('Inicialização já em andamento, ignorando...', 'warning');
      return false;
    }

    this.isInitializing = true;

    try {
      this.log('Iniciando conexão com WhatsApp...', 'info');

      // Limpar conexão anterior se existir
      if (this.sock) {
        try {
          await this.sock.logout();
          this.sock.ev.removeAllListeners();
          this.sock = null;
        } catch (error) {
          this.log('Erro ao limpar conexão anterior: ' + error.message, 'warning');
        }
      }

      // Garantir que o diretório de sessões existe
      await fs.ensureDir('./sessions');

      // Obter versão mais recente do Baileys
      let version;
      try {
        const { version: latestVersion } = await fetchLatestBaileysVersion();
        version = latestVersion;
        this.log(`Usando Baileys versão: ${version}`, 'info');
      } catch (error) {
        this.log('Erro ao obter versão do Baileys, usando padrão: ' + error.message, 'warning');
      }

      // Configurar autenticação com retry
      let authState, saveCreds;
      let authRetries = 0;
      const maxAuthRetries = 3;

      while (authRetries < maxAuthRetries) {
        try {
          const result = await useMultiFileAuthState('./sessions');
          authState = result.state;
          saveCreds = result.saveCreds;
          break;
        } catch (error) {
          authRetries++;
          this.log(`Erro na autenticação (tentativa ${authRetries}/${maxAuthRetries}): ${error.message}`, 'warning');
          
          if (authRetries >= maxAuthRetries) {
            // Limpar sessões corrompidas
            await this.clearCorruptedSessions();
            const result = await useMultiFileAuthState('./sessions');
            authState = result.state;
            saveCreds = result.saveCreds;
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Configurar socket com parâmetros otimizados
      this.sock = makeWASocket({
        auth: authState,
        version: version,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }), // Reduzir logs para debug
        browser: ['Auto Envios Bot', 'Chrome', '1.0.0'],
        
        // Timeouts otimizados
        defaultQueryTimeoutMs: 30000, // Reduzido de 60s
        connectTimeoutMs: 30000,      // Reduzido de 60s
        keepAliveIntervalMs: 25000,   // Aumentado de 10s
        
        // Configurações de rede
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 2,
        
        // Configurações específicas para evitar erro 405
        emitOwnEvents: false,         // Mudado para false
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false, // Desabilitado temporariamente
        
        // Configurações de reconexão
        shouldIgnoreJid: jid => isJidBroadcast(jid) || isJidNewsletter(jid),
        getMessage: async (key) => {
          if (this.messageStore && this.messageStore[key.remoteJid]) {
            return this.messageStore[key.remoteJid][key.id] || {};
          }
          return {};
        }
      });

      // Configurar eventos
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
      this.sock.ev.on('messages.upsert', this.handleMessages.bind(this));

      // Adicionar evento para detectar erro 405 específico
      this.sock.ev.on('CB:call', (callUpdate) => {
        this.log('Chamada detectada, rejeitando para evitar problemas', 'warning');
        // Rejeitar chamadas automaticamente
        if (callUpdate.status === 'ringing') {
          this.sock.rejectCall(callUpdate.id, callUpdate.from);
        }
      });

      this.connectionAttempts++;
      this.log(`Tentativa de conexão ${this.connectionAttempts}/${this.maxConnectionAttempts}`, 'info');

      return true;

    } catch (error) {
      this.log('Erro crítico ao inicializar bot: ' + error.message, 'error');
      
      // Se for erro 405, tentar limpeza completa
      if (error.message.includes('405') || error.message.includes('Method Not Allowed')) {
        this.log('Erro 405 detectado, realizando limpeza completa...', 'warning');
        await this.handleError405();
      }
      
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  // Função para lidar especificamente com erro 405
  async handleError405() {
    try {
      this.log('Iniciando correção para erro 405...', 'info');
      
      // 1. Desconectar completamente
      if (this.sock) {
        try {
          await this.sock.logout();
          this.sock.ev.removeAllListeners();
          this.sock = null;
        } catch (e) {
          this.log('Erro ao desconectar (esperado): ' + e.message, 'warning');
        }
      }

      // 2. Limpar todos os locks e estados
      this.clearAllLocks();
      this.isConnectedFlag = false;
      this.connectionAttempts = 0;

      // 3. Aguardar antes de tentar novamente
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 segundos

      // 4. Limpar cache de sessão se necessário
      await this.clearCorruptedSessions();

      this.log('Correção para erro 405 concluída', 'success');
      
    } catch (error) {
      this.log('Erro na correção 405: ' + error.message, 'error');
    }
  }

  // Limpar sessões corrompidas
  async clearCorruptedSessions() {
    try {
      const sessionsPath = './sessions';
      
      // Verificar se existem arquivos corrompidos
      if (await fs.pathExists(sessionsPath)) {
        const files = await fs.readdir(sessionsPath);
        
        for (const file of files) {
          const filePath = `${sessionsPath}/${file}`;
          try {
            if (file.endsWith('.json')) {
              // Verificar se o JSON é válido
              const content = await fs.readFile(filePath, 'utf8');
              JSON.parse(content);
            }
          } catch (error) {
            this.log(`Removendo arquivo corrompido: ${file}`, 'warning');
            await fs.remove(filePath);
          }
        }
      }
      
      this.log('Verificação de sessões concluída', 'info');
    } catch (error) {
      this.log('Erro ao limpar sessões: ' + error.message, 'error');
    }
  }

  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.log('QR Code recebido', 'info');
      const QRCode = require('qrcode');
      QRCode.toDataURL(qr)
        .then(qrDataUrl => this.io.emit('qrCode', qrDataUrl))
        .catch(err => this.log('Erro ao gerar QR Code: ' + err.message, 'error'));
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      this.log(`Conexão fechada. Motivo: ${statusCode}`, 'warning');
      
      // Log específico para diferentes tipos de desconexão
      switch (statusCode) {
        case DisconnectReason.badSession:
          this.log('Sessão inválida - será necessário novo QR Code', 'error');
          break;
        case DisconnectReason.connectionClosed:
          this.log('Conexão fechada pelo servidor', 'warning');
          break;
        case DisconnectReason.connectionLost:
          this.log('Conexão perdida', 'warning');
          break;
        case DisconnectReason.connectionReplaced:
          this.log('Conexão substituída por outro dispositivo', 'error');
          break;
        case DisconnectReason.loggedOut:
          this.log('Usuário deslogado', 'info');
          break;
        case DisconnectReason.restartRequired:
          this.log('Reinicialização necessária', 'warning');
          break;
        case DisconnectReason.timedOut:
          this.log('Timeout na conexão', 'warning');
          break;
        case 405:
          this.log('Erro 405 - Method Not Allowed detectado', 'error');
          break;
        default:
          this.log(`Código de desconexão desconhecido: ${statusCode}`, 'warning');
      }

      this.isConnectedFlag = false;
      this.clearAllLocks();
      
      this.io.emit('botStatus', { connected: false });
      this.io.emit('qrCode', null);

      // Lógica de reconexão melhorada
      if (shouldReconnect && this.connectionAttempts < this.maxConnectionAttempts) {
        this.retryCount++;
        
        // Delay progressivo baseado no número de tentativas
        const delay = Math.min(this.reconnectDelay * this.retryCount, 30000); // Max 30s
        
        this.log(`Tentativa de reconexão ${this.retryCount}/${this.maxRetries} em ${delay/1000}s...`, 'info');
        
        setTimeout(async () => {
          try {
            // Se for erro 405, fazer limpeza especial
            if (statusCode === 405) {
              await this.handleError405();
            }
            await this.initialize();
          } catch (error) {
            this.log('Erro na reconexão: ' + error.message, 'error');
          }
        }, delay);
        
      } else if (this.retryCount >= this.maxRetries || this.connectionAttempts >= this.maxConnectionAttempts) {
        this.log('Máximo de tentativas atingido', 'error');
        this.retryCount = 0;
        this.connectionAttempts = 0;
        
        // Para erro 405 persistente, sugerir limpeza manual
        if (statusCode === 405) {
          this.log('ERRO 405 PERSISTENTE: Execute "Limpar Sessão" na interface', 'error');
          this.io.emit('error405', { 
            message: 'Erro 405 persistente. Clique em "Limpar Sessão" para resolver.' 
          });
        }
      }
      
    } else if (connection === 'open') {
      this.log('Conectado ao WhatsApp com sucesso!', 'success');
      this.isConnectedFlag = true;
      this.retryCount = 0;
      this.connectionAttempts = 0; // Reset contador na conexão bem-sucedida
      this.clearAllLocks();
      
      this.io.emit('botStatus', { connected: true });
      this.io.emit('qrCode', null);

      // Aguardar um pouco antes de carregar grupos
      setTimeout(() => this.loadGroups(), 3000); // Aumentado para 3s
      
    } else if (connection === 'connecting') {
      this.log('Conectando...', 'info');
    }
  }

  // Função auxiliar para verificar JIDs
  isJidBroadcast(jid) {
    return jid && jid.includes('@broadcast');
  }

  isJidNewsletter(jid) {
    return jid && jid.includes('@newsletter');
  }

  // Limpar todos os locks
  clearAllLocks() {
    this.sendingQueue.clear();
    this.messageLocks.clear();
    this.groupLocks.clear();
    this.log('Locks limpos', 'info');
  }

  handleMessages(m) {
    try {
      const msg = m.messages[0];
      if (msg?.key?.fromMe === false) {
        // Log mais silencioso
        // this.log('Nova mensagem recebida', 'info');
      }
    } catch (error) {
      // Silencioso para evitar spam
    }
  }

  async loadGroups() {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        this.log('Bot não conectado para carregar grupos', 'warning');
        return;
      }

      this.log('Carregando grupos...', 'info');
      
      // Timeout para busca de grupos
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ao carregar grupos')), 15000)
      );
      
      const groupsPromise = this.sock.groupFetchAllParticipating();
      
      const groups = await Promise.race([groupsPromise, timeout]);
      
      this.groups = Object.values(groups).map(group => ({
        id: group.id,
        name: group.subject || 'Grupo sem nome',
        participants: group.participants ? group.participants.length : 0,
        description: group.desc || '',
        owner: group.owner || ''
      }));

      this.log(`${this.groups.length} grupos carregados`, 'success');
      this.io.emit('groupsList', this.groups);
      
    } catch (error) {
      this.log('Erro ao carregar grupos: ' + error.message, 'error');
      this.groups = [];
      this.io.emit('groupsList', []);
    }
  }

  async getGroups() {
    if (this.groups.length === 0) {
      await this.loadGroups();
    }
    return this.groups;
  }

  // Buscar último vídeo com cache
  async getLatestVideo(youtubeApiKey, channelId, forceRefresh = false) {
    try {
      if (!youtubeApiKey || !channelId) {
        throw new Error('API Key ou Channel ID não configurados');
      }

      const now = Date.now();
      if (!forceRefresh && this.lastVideoCache && 
          (now - this.lastVideoCache.timestamp) < this.videoCacheExpiry) {
        this.log('Usando vídeo do cache', 'info');
        return this.lastVideoCache.data;
      }

      this.requestCounter++;
      const requestId = this.requestCounter;
      
      this.log(`Buscando último vídeo do canal... (Req: ${requestId})`, 'info');
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key: youtubeApiKey,
          channelId: channelId,
          part: 'snippet',
          order: 'date',
          maxResults: 1,
          type: 'video'
        },
        timeout: 15000
      });

      if (response.data.items && response.data.items.length > 0) {
        const video = response.data.items[0];
        const videoData = {
          id: video.id.videoId,
          title: video.snippet.title,
          description: video.snippet.description,
          thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url,
          publishedAt: video.snippet.publishedAt,
          url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
          requestId: requestId
        };

        this.lastVideoCache = {
          data: videoData,
          timestamp: now
        };

        this.log(`Vídeo obtido: ${videoData.title} (Req: ${requestId})`, 'success');
        return videoData;
      } else {
        throw new Error('Nenhum vídeo encontrado no canal');
      }
    } catch (error) {
      this.log('Erro ao buscar vídeo: ' + error.message, 'error');
      throw error;
    }
  }

  // Enviar mensagem com proteção
  async sendMessageWithLock(groupId, message, context = 'default') {
    if (this.groupLocks.has(groupId)) {
      throw new Error(`Grupo ${groupId} já está sendo processado`);
    }

    const messageHash = this.generateMessageHash(message);
    if (this.messageLocks.has(messageHash)) {
      throw new Error('Mensagem similar já está sendo enviada');
    }

    this.groupLocks.add(groupId);
    this.messageLocks.add(messageHash);

    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não está conectado');
      }

      const result = await this.sock.sendMessage(groupId, message);
      this.log(`Mensagem enviada para ${groupId} (${context})`, 'success');
      return result;

    } finally {
      this.groupLocks.delete(groupId);
      this.messageLocks.delete(messageHash);
      
      setTimeout(() => {
        this.messageLocks.delete(messageHash);
      }, 30000);
    }
  }

  generateMessageHash(message) {
    const content = JSON.stringify(message);
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  async sendLatestVideoToGroup(groupId) {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }

      if (this.groupLocks.has(groupId)) {
        throw new Error(`Envio já em andamento para grupo: ${groupId}`);
      }

      const configPath = './config/settings.json';
      let config = {};
      if (await fs.pathExists(configPath)) {
        config = await fs.readJSON(configPath);
      }

      const video = await this.getLatestVideo(config.youtubeApiKey, config.channelId);

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

      await this.sendMessageWithLock(groupId, message, 'single');
      return true;
      
    } catch (error) {
      this.log(`Erro ao enviar vídeo para grupo ${groupId}: ${error.message}`, 'error');
      throw error;
    }
  }

  async sendLatestVideo(groupIds) {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }
      
      if (!groupIds || groupIds.length === 0) {
        throw new Error('Nenhum grupo selecionado');
      }

      const availableGroups = groupIds.filter(groupId => !this.groupLocks.has(groupId));
      
      if (availableGroups.length === 0) {
        throw new Error('Todos os grupos selecionados já estão sendo processados');
      }

      if (availableGroups.length < groupIds.length) {
        this.log(`${groupIds.length - availableGroups.length} grupos ignorados (já processando)`, 'warning');
      }

      const configPath = './config/settings.json';
      let config = {};
      if (await fs.pathExists(configPath)) {
        config = await fs.readJSON(configPath);
      }

      const video = await this.getLatestVideo(config.youtubeApiKey, config.channelId);
      
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

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      this.log(`Iniciando envio para ${availableGroups.length} grupos`, 'info');

      for (let i = 0; i < availableGroups.length; i++) {
        const groupId = availableGroups[i];
        
        try {
          if (!this.sock || !this.isConnectedFlag) {
            throw new Error('Bot desconectado durante envio');
          }

          await this.sendMessageWithLock(groupId, message, 'batch');
          successCount++;
          
          this.log(`Enviado para grupo ${i + 1}/${availableGroups.length}`, 'success');

          if (i < availableGroups.length - 1) {
            const delay = config.antiBanSettings?.delayBetweenGroups || 5;
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
          }

        } catch (error) {
          errorCount++;
          errors.push({ groupId, error: error.message });
          this.log(`Erro ao enviar para grupo ${i + 1}: ${error.message}`, 'error');
        }
      }

      this.log(`Envio concluído: ${successCount} sucessos, ${errorCount} erros`, 'info');
      
      return { 
        successCount, 
        errorCount, 
        errors,
        total: availableGroups.length,
        skipped: groupIds.length - availableGroups.length
      };

    } catch (error) {
      this.log('Erro no envio em lote: ' + error.message, 'error');
      throw error;
    }
  }

  async disconnect() {
    try {
      this.log('Desconectando bot...', 'info');
      this.isConnectedFlag = false;
      this.isInitializing = false;
      this.clearAllLocks();

      if (this.sock) {
        await this.sock.logout();
        this.sock.ev.removeAllListeners();
        this.sock = null;
      }

      this.lastVideoCache = null;
      this.groups = [];
      this.retryCount = 0;
      this.connectionAttempts = 0;

      this.io.emit('botStatus', { connected: false });
      this.io.emit('qrCode', null);

      this.log('Bot desconectado', 'success');
      return true;
    } catch (error) {
      this.log('Erro ao desconectar: ' + error.message, 'error');
      this.isConnectedFlag = false;
      this.sock = null;
      this.clearAllLocks();
      this.io.emit('botStatus', { connected: false });
      return true;
    }
  }

  isConnected() {
    return this.isConnectedFlag && this.sock;
  }

  async getGroupInfo(groupId) {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }
      
      const groupMetadata = await this.sock.groupMetadata(groupId);
      return {
        id: groupId,
        name: groupMetadata.subject,
        participants: groupMetadata.participants.length,
        description: groupMetadata.desc || '',
        owner: groupMetadata.owner
      };
    } catch (error) {
      this.log(`Erro ao obter info do grupo ${groupId}: ${error.message}`, 'error');
      return null;
    }
  }

  async sendCustomMessage(groupId, messageText) {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }

      const message = { text: messageText };
      await this.sendMessageWithLock(groupId, message, 'custom');
      
      this.log(`Mensagem personalizada enviada para: ${groupId}`, 'success');
      return true;
    } catch (error) {
      this.log(`Erro ao enviar mensagem para ${groupId}: ${error.message}`, 'error');
      throw error;
    }
  }

  getLockStatus() {
    return {
      groupLocks: Array.from(this.groupLocks),
      messageLocks: this.messageLocks.size,
      queueSize: this.sendingQueue.size,
      cacheStatus: this.lastVideoCache ? 'ativo' : 'vazio',
      cacheAge: this.lastVideoCache ? Date.now() - this.lastVideoCache.timestamp : 0,
      connectionAttempts: this.connectionAttempts,
      isInitializing: this.isInitializing
    };
  }

  forceClearLocks() {
    this.clearAllLocks();
    this.log('Locks forçadamente limpos', 'warning');
  }
}

// Função auxiliar para verificar JIDs
function isJidBroadcast(jid) {
  return jid && jid.includes('@broadcast');
}

function isJidNewsletter(jid) {
  return jid && jid.includes('@newsletter');
}

module.exports = WhatsAppBot;