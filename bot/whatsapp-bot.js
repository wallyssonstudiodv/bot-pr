const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
    this.sendingQueue = new Map(); // Controla envios em fila por grupo
    this.lastVideoCache = null; // Cache do último vídeo
    this.videoCacheExpiry = 5 * 60 * 1000; // 5 minutos
    this.messageLocks = new Set(); // IDs de mensagens sendo enviadas
    this.groupLocks = new Set(); // Grupos com envio em andamento
    this.requestCounter = 0; // Contador para evitar chamadas simultâneas da API
  }

  async initialize() {
    try {
      this.log('Iniciando conexão com WhatsApp...', 'info');

      const { state, saveCreds } = await useMultiFileAuthState('./sessions');

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        browser: ['Auto Envios Bot', 'Chrome', '1.0.0'],
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        generateHighQualityLinkPreview: true,
        // Configurações anti-spam
        retryRequestDelayMs: 5000,
        maxMsgRetryCount: 3,
        markOnlineOnConnect: false
      });

      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
      this.sock.ev.on('messages.upsert', this.handleMessages.bind(this));

      return true;
    } catch (error) {
      this.log('Erro ao inicializar bot: ' + error.message, 'error');
      throw error;
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
      const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
      this.log('Conexão fechada. Motivo: ' + lastDisconnect?.error?.output?.statusCode, 'warning');

      this.isConnectedFlag = false;
      this.clearAllLocks(); // Limpar locks quando desconectar
      
      this.io.emit('botStatus', { connected: false });
      this.io.emit('qrCode', null);

      if (shouldReconnect && this.retryCount < this.maxRetries) {
        this.retryCount++;
        this.log(`Tentando reconectar... (${this.retryCount}/${this.maxRetries})`, 'info');
        setTimeout(() => this.initialize(), 5000);
      } else if (this.retryCount >= this.maxRetries) {
        this.log('Máximo de tentativas de reconexão atingido', 'error');
        this.retryCount = 0;
      }
    } else if (connection === 'open') {
      this.log('Conectado ao WhatsApp com sucesso!', 'success');
      this.isConnectedFlag = true;
      this.retryCount = 0;
      this.clearAllLocks(); // Limpar locks ao reconectar
      
      this.io.emit('botStatus', { connected: true });
      this.io.emit('qrCode', null);

      setTimeout(() => this.loadGroups(), 2000);
    }
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
        this.log('Nova mensagem recebida', 'info');
      }
    } catch (error) {
      // Silencioso para evitar spam de logs
    }
  }

  async loadGroups() {
    try {
      if (!this.sock) return;

      this.log('Carregando grupos...', 'info');
      const groups = await this.sock.groupFetchAllParticipating();
      
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
    }
  }

  async getGroups() {
    if (this.groups.length === 0) {
      await this.loadGroups();
    }
    return this.groups;
  }

  // Buscar último vídeo com cache para evitar chamadas duplicadas da API
  async getLatestVideo(youtubeApiKey, channelId, forceRefresh = false) {
    try {
      if (!youtubeApiKey || !channelId) {
        throw new Error('API Key ou Channel ID não configurados');
      }

      // Verificar cache se não forçar refresh
      const now = Date.now();
      if (!forceRefresh && this.lastVideoCache && 
          (now - this.lastVideoCache.timestamp) < this.videoCacheExpiry) {
        this.log('Usando vídeo do cache', 'info');
        return this.lastVideoCache.data;
      }

      // Incrementar contador para evitar chamadas simultâneas
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
        timeout: 15000 // Aumentar timeout
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

        // Atualizar cache
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

  // Enviar mensagem com proteção anti-duplicação
  async sendMessageWithLock(groupId, message, context = 'default') {
    const lockKey = `${groupId}-${context}-${Date.now()}`;
    
    // Verificar se grupo já está sendo processado
    if (this.groupLocks.has(groupId)) {
      throw new Error(`Grupo ${groupId} já está sendo processado`);
    }

    // Verificar se mensagem similar já está sendo enviada
    const messageHash = this.generateMessageHash(message);
    if (this.messageLocks.has(messageHash)) {
      throw new Error('Mensagem similar já está sendo enviada');
    }

    // Definir locks
    this.groupLocks.add(groupId);
    this.messageLocks.add(messageHash);

    try {
      // Verificar conexão antes do envio
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não está conectado');
      }

      // Enviar mensagem
      const result = await this.sock.sendMessage(groupId, message);
      
      this.log(`Mensagem enviada para ${groupId} (${context})`, 'success');
      return result;

    } finally {
      // Sempre remover locks
      this.groupLocks.delete(groupId);
      this.messageLocks.delete(messageHash);
      
      // Remover hash do cache após um tempo
      setTimeout(() => {
        this.messageLocks.delete(messageHash);
      }, 30000); // 30 segundos
    }
  }

  // Gerar hash da mensagem para detecção de duplicatas
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

      // Verificar se grupo já está processando
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

  // Versão melhorada do envio em lote com controle rigoroso de duplicação
  async sendLatestVideo(groupIds) {
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }
      
      if (!groupIds || groupIds.length === 0) {
        throw new Error('Nenhum grupo selecionado');
      }

      // Filtrar grupos que já estão sendo processados
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

      // Buscar vídeo uma única vez
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
          // Verificar conexão antes de cada envio
          if (!this.sock || !this.isConnectedFlag) {
            throw new Error('Bot desconectado durante envio');
          }

          await this.sendMessageWithLock(groupId, message, 'batch');
          successCount++;
          
          this.log(`Enviado para grupo ${i + 1}/${availableGroups.length}`, 'success');

          // Delay entre envios (exceto no último)
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
      this.clearAllLocks();

      if (this.sock) {
        await this.sock.logout();
        this.sock.ev.removeAllListeners();
        this.sock = null;
      }

      // Limpar cache
      this.lastVideoCache = null;
      this.groups = [];

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

  // Método para verificar status dos locks (útil para debug)
  getLockStatus() {
    return {
      groupLocks: Array.from(this.groupLocks),
      messageLocks: this.messageLocks.size,
      queueSize: this.sendingQueue.size,
      cacheStatus: this.lastVideoCache ? 'ativo' : 'vazio',
      cacheAge: this.lastVideoCache ? Date.now() - this.lastVideoCache.timestamp : 0
    };
  }

  // Método para forçar limpeza de locks (emergência)
  forceClearLocks() {
    this.clearAllLocks();
    this.log('Locks forçadamente limpos', 'warning');
  }
}

module.exports = WhatsAppBot;