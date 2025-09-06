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
    
    // SISTEMA ANTI-DUPLICAÇÃO MELHORADO
    this.sendingQueue = new Map();
    this.lastVideoCache = null;
    this.videoCacheExpiry = 5 * 60 * 1000; // 5 minutos
    this.messageLocks = new Set();
    this.groupLocks = new Set();
    this.requestCounter = 0;
    
    // CONTROLE DE SESSÃO MELHORADO
    this.isInitializing = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
    this.reconnectDelay = 5000;
    
    // PROTEÇÕES ANTI-RECURSÃO
    this.eventListeners = new Map(); // Rastrear listeners para evitar duplicação
    this.operationTimeouts = new Map(); // Controlar timeouts
    this.reconnectTimeout = null; // Timeout único para reconexão
    this.loadGroupsTimeout = null; // Timeout único para carregar grupos
    
    // CONTROLE DE CHAMADAS RECURSIVAS
    this.activeOperations = new Set();
    this.operationId = 0;
    
    // RATE LIMITING
    this.lastApiCall = 0;
    this.minApiInterval = 1000; // 1 segundo entre chamadas API
  }

  // Função auxiliar para gerar ID único de operação
  generateOperationId(operation) {
    this.operationId++;
    return `${operation}_${this.operationId}_${Date.now()}`;
  }

  // Função para verificar se operação já está ativa (previne recursão)
  isOperationActive(operationId) {
    return this.activeOperations.has(operationId);
  }

  // Marcar operação como ativa
  markOperationActive(operationId) {
    this.activeOperations.add(operationId);
  }

  // Finalizar operação
  finishOperation(operationId) {
    this.activeOperations.delete(operationId);
  }

  // Rate limiting para APIs
  async waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCall;
    
    if (timeSinceLastCall < this.minApiInterval) {
      const waitTime = this.minApiInterval - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastApiCall = Date.now();
  }

  async initialize() {
    const operationId = this.generateOperationId('initialize');
    
    if (this.isOperationActive(operationId.split('_')[0])) {
      this.log('Inicialização já em andamento, ignorando...', 'warning');
      return false;
    }

    if (this.isInitializing) {
      this.log('Inicialização já em andamento (flag), ignorando...', 'warning');
      return false;
    }

    this.isInitializing = true;
    this.markOperationActive(operationId.split('_')[0]);

    // Timeout de segurança para inicialização
    const initTimeout = setTimeout(() => {
      this.log('Timeout na inicialização, forçando limpeza...', 'error');
      this.isInitializing = false;
      this.finishOperation(operationId.split('_')[0]);
    }, 120000); // 2 minutos

    try {
      this.log(`Iniciando conexão com WhatsApp... (Op: ${operationId})`, 'info');

      // Limpar conexão anterior COM PROTEÇÃO
      await this.safeDisconnect(false); // false = não emitir eventos

      // Garantir que o diretório de sessões existe
      await fs.ensureDir('./sessions');

      // Obter versão do Baileys COM TIMEOUT
      let version;
      try {
        await this.waitForRateLimit();
        
        const versionPromise = fetchLatestBaileysVersion();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout na versão Baileys')), 10000)
        );
        
        const { version: latestVersion } = await Promise.race([versionPromise, timeoutPromise]);
        version = latestVersion;
        this.log(`Usando Baileys versão: ${version}`, 'info');
      } catch (error) {
        this.log('Erro ao obter versão do Baileys, usando padrão: ' + error.message, 'warning');
        // Versão padrão se falhar
        version = [2, 2413, 1];
      }

      // Configurar autenticação COM RETRY LIMITADO
      let authState, saveCreds;
      let authRetries = 0;
      const maxAuthRetries = 2; // Reduzido de 3 para 2

      while (authRetries < maxAuthRetries) {
        try {
          const authResult = await useMultiFileAuthState('./sessions');
          authState = authResult.state;
          saveCreds = authResult.saveCreds;
          break;
        } catch (error) {
          authRetries++;
          this.log(`Erro na autenticação (tentativa ${authRetries}/${maxAuthRetries}): ${error.message}`, 'warning');
          
          if (authRetries >= maxAuthRetries) {
            // Limpar sessões corrompidas
            await this.clearCorruptedSessions();
            const authResult = await useMultiFileAuthState('./sessions');
            authState = authResult.state;
            saveCreds = authResult.saveCreds;
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Configurar socket COM CONFIGURAÇÕES OTIMIZADAS
      this.sock = makeWASocket({
        auth: authState,
        version: version,
        printQRInTerminal: false,
        logger: P({ level: 'fatal' }), // Apenas erros fatais
        browser: ['Auto Envios Bot', 'Chrome', '1.0.0'],
        
        // Timeouts OTIMIZADOS para evitar 405
        defaultQueryTimeoutMs: 20000,    // Reduzido para 20s
        connectTimeoutMs: 25000,         // Reduzido para 25s
        keepAliveIntervalMs: 30000,      // Aumentado para 30s
        
        // Configurações de rede CONSERVADORAS
        retryRequestDelayMs: 3000,       // Aumentado delay
        maxMsgRetryCount: 1,             // Reduzido para 1 tentativa
        
        // Configurações específicas para evitar erro 405
        emitOwnEvents: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,          // NOVO: não sincronizar histórico completo
        
        // Configurações de cache LIMITADAS
        cachedGroupMetadata: false,      // NOVO: desabilitar cache de metadados
        shouldSyncHistoryMessage: () => false, // NOVO: não sincronizar mensagens
        
        // Função getMessage OTIMIZADA
        getMessage: async (key) => {
          // Retorno simples para evitar complexidade
          return { conversation: 'Mensagem não encontrada' };
        }
      });

      // Remover listeners anteriores ANTES de adicionar novos
      if (this.eventListeners.size > 0) {
        for (const [eventName, listener] of this.eventListeners) {
          try {
            this.sock.ev.off(eventName, listener);
          } catch (error) {
            // Ignorar erros de remoção
          }
        }
        this.eventListeners.clear();
      }

      // Configurar eventos COM PROTEÇÃO ANTI-RECURSÃO
      const credListener = this.createSafeListener('creds.update', saveCreds);
      const connectionListener = this.createSafeListener('connection.update', this.handleConnectionUpdate.bind(this));
      const messageListener = this.createSafeListener('messages.upsert', this.handleMessages.bind(this));

      this.sock.ev.on('creds.update', credListener);
      this.sock.ev.on('connection.update', connectionListener);
      this.sock.ev.on('messages.upsert', messageListener);

      // Armazenar listeners para limpeza posterior
      this.eventListeners.set('creds.update', credListener);
      this.eventListeners.set('connection.update', connectionListener);
      this.eventListeners.set('messages.upsert', messageListener);

      // Evento para chamadas COM PROTEÇÃO
      const callListener = this.createSafeListener('CB:call', (callUpdate) => {
        try {
          this.log('Chamada detectada, rejeitando...', 'warning');
          if (callUpdate.status === 'ringing' && this.sock) {
            this.sock.rejectCall(callUpdate.id, callUpdate.from).catch(() => {
              // Ignorar erros de rejeição
            });
          }
        } catch (error) {
          // Ignorar erros de chamada
        }
      });

      this.sock.ev.on('CB:call', callListener);
      this.eventListeners.set('CB:call', callListener);

      this.connectionAttempts++;
      this.log(`Tentativa de conexão ${this.connectionAttempts}/${this.maxConnectionAttempts} (Op: ${operationId})`, 'info');

      clearTimeout(initTimeout);
      return true;

    } catch (error) {
      clearTimeout(initTimeout);
      this.log(`Erro crítico ao inicializar bot (Op: ${operationId}): ${error.message}`, 'error');
      
      // Se for erro 405, fazer limpeza especial
      if (error.message.includes('405') || error.message.includes('Method Not Allowed')) {
        this.log('Erro 405 detectado, realizando limpeza completa...', 'warning');
        await this.handleError405();
      }
      
      throw error;
    } finally {
      clearTimeout(initTimeout);
      this.isInitializing = false;
      this.finishOperation(operationId.split('_')[0]);
    }
  }

  // Criar listener seguro para evitar recursão
  createSafeListener(eventName, originalHandler) {
    const listenerMap = new Map();
    
    return async (...args) => {
      const callId = `${eventName}_${Date.now()}`;
      
      // Prevenir chamadas simultâneas do mesmo evento
      if (listenerMap.has(eventName)) {
        return;
      }
      
      listenerMap.set(eventName, callId);
      
      try {
        await originalHandler(...args);
      } catch (error) {
        this.log(`Erro no listener ${eventName}: ${error.message}`, 'warning');
      } finally {
        // Remover após delay para evitar múltiplas chamadas
        setTimeout(() => {
          listenerMap.delete(eventName);
        }, 1000);
      }
    };
  }

  // Função para lidar especificamente com erro 405 MELHORADA
  async handleError405() {
    const operationId = this.generateOperationId('error405');
    
    if (this.isOperationActive('error405')) {
      this.log('Correção 405 já em andamento', 'warning');
      return;
    }

    this.markOperationActive('error405');

    try {
      this.log(`Iniciando correção para erro 405... (Op: ${operationId})`, 'info');
      
      // 1. Parar reconexão automática
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // 2. Desconectar completamente COM TIMEOUT
      await this.safeDisconnect(false);

      // 3. Limpar todos os locks e estados ATOMICAMENTE
      this.clearAllLocks();
      this.isConnectedFlag = false;
      this.connectionAttempts = 0;
      this.retryCount = 0;

      // 4. Aguardar com timeout controlado
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 5. Limpar cache de sessão se necessário
      await this.clearCorruptedSessions();

      // 6. Limpar listeners
      this.eventListeners.clear();

      this.log(`Correção para erro 405 concluída (Op: ${operationId})`, 'success');
      
    } catch (error) {
      this.log(`Erro na correção 405 (Op: ${operationId}): ${error.message}`, 'error');
    } finally {
      this.finishOperation('error405');
    }
  }

  // Desconexão segura COM PROTEÇÃO
  async safeDisconnect(emitEvents = true) {
    try {
      if (this.sock) {
        // Remover todos os listeners PRIMEIRO
        for (const [eventName, listener] of this.eventListeners) {
          try {
            this.sock.ev.off(eventName, listener);
          } catch (error) {
            // Ignorar erros de remoção
          }
        }
        this.eventListeners.clear();

        // Tentar logout com timeout
        try {
          const logoutPromise = this.sock.logout();
          const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
          await Promise.race([logoutPromise, timeoutPromise]);
        } catch (error) {
          this.log('Erro no logout (esperado): ' + error.message, 'warning');
        }

        this.sock = null;
      }

      // Limpar timeouts
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      if (this.loadGroupsTimeout) {
        clearTimeout(this.loadGroupsTimeout);
        this.loadGroupsTimeout = null;
      }

      // Limpar timeouts de operação
      for (const [opId, timeout] of this.operationTimeouts) {
        clearTimeout(timeout);
      }
      this.operationTimeouts.clear();

      if (emitEvents && this.io) {
        try {
          this.io.emit('botStatus', { connected: false });
          this.io.emit('qrCode', null);
        } catch (error) {
          // Ignorar erros de emissão
        }
      }

    } catch (error) {
      this.log('Erro na desconexão segura: ' + error.message, 'warning');
    }
  }

  // Limpar sessões corrompidas COM PROTEÇÃO
  async clearCorruptedSessions() {
    try {
      const sessionsPath = './sessions';
      
      if (await fs.pathExists(sessionsPath)) {
        const files = await fs.readdir(sessionsPath);
        
        // Processar apenas primeiros 30 arquivos para evitar sobrecarga
        const filesToCheck = files.slice(0, 30);
        
        for (const file of filesToCheck) {
          const filePath = `${sessionsPath}/${file}`;
          try {
            if (file.endsWith('.json')) {
              const content = await fs.readFile(filePath, 'utf8');
              
              // Verificar tamanho do arquivo
              if (content.length > 5000000) { // 5MB limite
                throw new Error('Arquivo muito grande');
              }
              
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
    const operationId = this.generateOperationId('connection');
    
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr && this.io) {
        this.log('QR Code recebido', 'info');
        const QRCode = require('qrcode');
        
        QRCode.toDataURL(qr, { width: 300, margin: 1 })
          .then(qrDataUrl => {
            if (this.io) {
              this.io.emit('qrCode', qrDataUrl);
            }
          })
          .catch(err => this.log('Erro ao gerar QR Code: ' + err.message, 'error'));
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        this.log(`Conexão fechada. Motivo: ${statusCode} (Op: ${operationId})`, 'warning');
        
        // Log específico para diferentes tipos de desconexão
        this.logDisconnectionReason(statusCode);

        this.isConnectedFlag = false;
        this.clearAllLocks();
        
        if (this.io) {
          try {
            this.io.emit('botStatus', { connected: false });
            this.io.emit('qrCode', null);
          } catch (error) {
            // Ignorar erro de emissão
          }
        }

        // Lógica de reconexão MELHORADA com proteção anti-loop
        if (shouldReconnect && 
            this.connectionAttempts < this.maxConnectionAttempts && 
            this.retryCount < this.maxRetries &&
            !this.reconnectTimeout) { // Verificar se já não existe timeout
          
          this.retryCount++;
          
          // Delay progressivo baseado no número de tentativas
          const baseDelay = statusCode === 405 ? 15000 : this.reconnectDelay; // Delay maior para 405
          const delay = Math.min(baseDelay * this.retryCount, 60000); // Max 1 minuto
          
          this.log(`Tentativa de reconexão ${this.retryCount}/${this.maxRetries} em ${delay/1000}s...`, 'info');
          
          this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = null; // Limpar referência
            
            try {
              // Se for erro 405, fazer limpeza especial
              if (statusCode === 405) {
                await this.handleError405();
                await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar mais
              }
              
              await this.initialize();
            } catch (error) {
              this.log('Erro na reconexão: ' + error.message, 'error');
              
              // Se falhar, resetar counters para permitir nova tentativa
              this.retryCount = Math.max(0, this.retryCount - 1);
            }
          }, delay);
          
        } else if (this.retryCount >= this.maxRetries || this.connectionAttempts >= this.maxConnectionAttempts) {
          this.log('Máximo de tentativas atingido, resetando...', 'error');
          this.retryCount = 0;
          this.connectionAttempts = 0;
          
          // Para erro 405 persistente, sugerir limpeza manual
          if (statusCode === 405 && this.io) {
            this.log('ERRO 405 PERSISTENTE: Execute "Limpar Sessão" na interface', 'error');
            try {
              this.io.emit('error405', { 
                message: 'Erro 405 persistente. Clique em "Limpar Sessão" para resolver.' 
              });
            } catch (error) {
              // Ignorar erro de emissão
            }
          }
        }
        
      } else if (connection === 'open') {
        this.log(`Conectado ao WhatsApp com sucesso! (Op: ${operationId})`, 'success');
        this.isConnectedFlag = true;
        this.retryCount = 0;
        this.connectionAttempts = 0;
        this.clearAllLocks();
        
        if (this.io) {
          try {
            this.io.emit('botStatus', { connected: true });
            this.io.emit('qrCode', null);
          } catch (error) {
            // Ignorar erro de emissão
          }
        }

        // Aguardar antes de carregar grupos COM PROTEÇÃO
        if (this.loadGroupsTimeout) {
          clearTimeout(this.loadGroupsTimeout);
        }
        
        this.loadGroupsTimeout = setTimeout(() => {
          this.loadGroupsTimeout = null;
          this.loadGroups().catch(error => {
            this.log('Erro no carregamento automático de grupos: ' + error.message, 'warning');
          });
        }, 5000); // Aumentado para 5s
        
      } else if (connection === 'connecting') {
        this.log('Conectando...', 'info');
      }

    } catch (error) {
      this.log(`Erro no handleConnectionUpdate (Op: ${operationId}): ${error.message}`, 'error');
    }
  }

  logDisconnectionReason(statusCode) {
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
  }

  // Limpar todos os locks ATOMICAMENTE
  clearAllLocks() {
    try {
      this.sendingQueue.clear();
      this.messageLocks.clear();
      this.groupLocks.clear();
      this.activeOperations.clear();
      this.log('Locks limpos', 'info');
    } catch (error) {
      this.log('Erro ao limpar locks: ' + error.message, 'warning');
    }
  }

  handleMessages(m) {
    try {
      // Processamento mínimo para evitar sobrecarga
      if (m?.messages?.length > 0) {
        const msg = m.messages[0];
        if (msg?.key?.fromMe === false) {
          // Log silencioso apenas se necessário
          // this.log('Nova mensagem recebida', 'info');
        }
      }
    } catch (error) {
      // Silencioso para evitar spam de logs
    }
  }

  async loadGroups() {
    const operationId = this.generateOperationId('loadGroups');
    
    if (this.isOperationActive('loadGroups')) {
      this.log('Carregamento de grupos já em andamento', 'warning');
      return this.groups;
    }

    this.markOperationActive('loadGroups');

    try {
      if (!this.sock || !this.isConnectedFlag) {
        this.log('Bot não conectado para carregar grupos', 'warning');
        return [];
      }

      this.log(`Carregando grupos... (Op: ${operationId})`, 'info');
      
      await this.waitForRateLimit();
      
      // Timeout para busca de grupos
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ao carregar grupos')), 20000)
      );
      
      const groupsPromise = this.sock.groupFetchAllParticipating();
      
      const groups = await Promise.race([groupsPromise, timeout]);
      
      if (groups && typeof groups === 'object') {
        this.groups = Object.values(groups)
          .filter(group => group && group.id && group.subject) // Filtrar grupos válidos
          .slice(0, 200) // Limitar número de grupos para evitar sobrecarga
          .map(group => ({
            id: group.id,
            name: (group.subject || 'Grupo sem nome').substring(0, 100), // Limitar tamanho do nome
            participants: group.participants ? Math.min(group.participants.length, 9999) : 0,
            description: (group.desc || '').substring(0, 200), // Limitar descrição
            owner: group.owner || ''
          }));

        this.log(`${this.groups.length} grupos carregados (Op: ${operationId})`, 'success');
        
        if (this.io) {
          try {
            this.io.emit('groupsList', this.groups);
          } catch (error) {
            this.log('Erro ao emitir lista de grupos: ' + error.message, 'warning');
          }
        }
      } else {
        this.log('Resposta inválida ao carregar grupos', 'warning');
        this.groups = [];
      }
      
      return this.groups;
      
    } catch (error) {
      this.log(`Erro ao carregar grupos (Op: ${operationId}): ${error.message}`, 'error');
      this.groups = [];
      
      if (this.io) {
        try {
          this.io.emit('groupsList', []);
        } catch (emitError) {
          // Ignorar erro de emissão
        }
      }
      
      // Se for erro de conexão, pode indicar problema maior
      if (error.message.includes('405') || error.message.includes('não conectado')) {
        this.isConnectedFlag = false;
      }
      
      return [];
    } finally {
      this.finishOperation('loadGroups');
    }
  }

  async getGroups() {
    if (this.groups.length === 0 && this.isConnectedFlag) {
      return await this.loadGroups();
    }
    return this.groups;
  }

  // Buscar último vídeo com cache MELHORADO
  async getLatestVideo(youtubeApiKey, channelId, forceRefresh = false) {
    const operationId = this.generateOperationId('getVideo');
    
    try {
      if (!youtubeApiKey || !channelId) {
        throw new Error('API Key ou Channel ID não configurados');
      }

      const now = Date.now();
      if (!forceRefresh && this.lastVideoCache && 
          (now - this.lastVideoCache.timestamp) < this.videoCacheExpiry) {
        this.log(`Usando vídeo do cache (Op: ${operationId})`, 'info');
        return this.lastVideoCache.data;
      }

      this.requestCounter++;
      const requestId = this.requestCounter;
      
      this.log(`Buscando último vídeo do canal... (Req: ${requestId}, Op: ${operationId})`, 'info');
      
      await this.waitForRateLimit();
      
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          key: youtubeApiKey,
          channelId: channelId,
          part: 'snippet',
          order: 'date',
          maxResults: 1,
          type: 'video'
        },
        timeout: 15000,
        maxContentLength: 1000000, // 1MB limite para resposta
        maxRedirects: 2
      });

      if (response?.data?.items?.length > 0) {
        const video = response.data.items[0];
        
        // Validar dados do vídeo
        if (!video.id?.videoId || !video.snippet?.title) {
          throw new Error('Dados do vídeo inválidos');
        }
        
        const videoData = {
          id: video.id.videoId,
          title: (video.snippet.title || 'Título não disponível').substring(0, 200),
          description: (video.snippet.description || '').substring(0, 500),
          thumbnail: video.snippet.thumbnails?.high?.url || 
                     video.snippet.thumbnails?.medium?.url || 
                     video.snippet.thumbnails?.default?.url || '',
          publishedAt: video.snippet.publishedAt || new Date().toISOString(),
          url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
          requestId: requestId
        };

        this.lastVideoCache = {
          data: videoData,
          timestamp: now
        };

        this.log(`Vídeo obtido: ${videoData.title} (Req: ${requestId}, Op: ${operationId})`, 'success');
        return videoData;
      } else {
        throw new Error('Nenhum vídeo encontrado no canal');
      }
    } catch (error) {
      this.log(`Erro ao buscar vídeo (Op: ${operationId}): ${error.message}`, 'error');
      
      // Se for erro de quota ou 403, cachear por mais tempo
      if (error.response?.status === 403 || error.message.includes('quota')) {
        this.log('Erro de quota detectado, usando cache se disponível', 'warning');
        if (this.lastVideoCache) {
          return this.lastVideoCache.data;
        }
      }
      
      throw error;
    }
  }

  // Enviar mensagem com proteção MELHORADA
  async sendMessageWithLock(groupId, message, context = 'default') {
    const operationId = this.generateOperationId('sendMessage');
    
    if (!groupId || !message) {
      throw new Error('GroupId e message são obrigatórios');
    }

    if (this.groupLocks.has(groupId)) {
      throw new Error(`Grupo ${groupId} já está sendo processado`);
    }

    const messageHash = this.generateMessageHash(message);
    if (this.messageLocks.has(messageHash)) {
      throw new Error('Mensagem similar já está sendo enviada');
    }

    this.groupLocks.add(groupId);
    this.messageLocks.add(messageHash);

    // Timeout para operação de envio
    const sendTimeout = setTimeout(() => {
      this.groupLocks.delete(groupId);
      this.messageLocks.delete(messageHash);
      this.log(`Timeout no envio para ${groupId}`, 'warning');
    }, 45000); // 45 segundos

    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não está conectado');
      }

      await this.waitForRateLimit();

      const sendPromise = this.sock.sendMessage(groupId, message);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout no envio de mensagem')), 30000)
      );

      const result = await Promise.race([sendPromise, timeoutPromise]);
      
      this.log(`Mensagem enviada para ${groupId} (${context}, Op: ${operationId})`, 'success');
      return result;

    } finally {
      clearTimeout(sendTimeout);
      this.groupLocks.delete(groupId);
      this.messageLocks.delete(messageHash);
      
      // Remover hash da mensagem após um tempo
      setTimeout(() => {
        this.messageLocks.delete(messageHash);
      }, 60000); // 1 minuto
    }
  }

  generateMessageHash(message) {
    try {
      const content = JSON.stringify(message);
      const crypto = require('crypto');
      return crypto.createHash('md5').update(content).digest('hex').substring(0, 16); // Apenas 16 chars
    } catch (error) {
      // Fallback hash simples
      return `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
  }

  async sendLatestVideoToGroup(groupId) {
    const operationId = this.generateOperationId('sendVideoToGroup');
    
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }

      if (this.groupLocks.has(groupId)) {
        throw new Error(`Envio já em andamento para grupo: ${groupId}`);
      }

      // Carregar config COM PROTEÇÃO
      let config = {};
      try {
        const configPath = './config/settings.json';
        if (await fs.pathExists(configPath)) {
          const configContent = await fs.readFile(configPath, 'utf8');
          if (configContent.length < 100000) { // 100KB limite
            config = JSON.parse(configContent);
          }
        }
      } catch (configError) {
        this.log(`Erro ao carregar config (Op: ${operationId}): ${configError.message}`, 'warning');
      }

      const video = await this.getLatestVideo(config.youtubeApiKey, config.channelId);

      const message = {
        image: { url: video.thumbnail },
        caption: `🎥 *Novo vídeo no canal!*\n\n*${video.title}*\n\n${video.description.substring(0, 200)}${video.description.length > 200 ? '...' : ''}\n\n🔗 ${video.url}\n\n✨ Compartilhem com a família e amigos, Jesus Cristo abençoe 🙏💖`,
        contextInfo: {
          externalAdReply: {
            title: video.title.substring(0, 60), // Limitar título
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
      this.log(`Erro ao enviar vídeo para grupo ${groupId} (Op: ${operationId}): ${error.message}`, 'error');
      throw error;
    }
  }

  async sendLatestVideo(groupIds) {
    const operationId = this.generateOperationId('sendLatestVideo');
    
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }
      
      if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
        throw new Error('Nenhum grupo selecionado');
      }

      // Limitar número de grupos para evitar sobrecarga
      const maxGroups = 100;
      const limitedGroupIds = groupIds.slice(0, maxGroups);
      
      if (groupIds.length > maxGroups) {
        this.log(`Limitado a ${maxGroups} grupos de ${groupIds.length} fornecidos`, 'warning');
      }

      const availableGroups = limitedGroupIds.filter(groupId => 
        groupId && !this.groupLocks.has(groupId)
      );
      
      if (availableGroups.length === 0) {
        throw new Error('Todos os grupos selecionados já estão sendo processados');
      }

      if (availableGroups.length < limitedGroupIds.length) {
        this.log(`${limitedGroupIds.length - availableGroups.length} grupos ignorados (já processando)`, 'warning');
      }

      // Carregar config COM PROTEÇÃO
      let config = {};
      try {
        const configPath = './config/settings.json';
        if (await fs.pathExists(configPath)) {
          const configContent = await fs.readFile(configPath, 'utf8');
          if (configContent.length < 100000) {
            config = JSON.parse(configContent);
          }
        }
      } catch (configError) {
        this.log(`Erro ao carregar config (Op: ${operationId}): ${configError.message}`, 'warning');
      }

      const video = await this.getLatestVideo(config.youtubeApiKey, config.channelId);
      
      const message = {
        image: { url: video.thumbnail },
        caption: `🎥 *Novo vídeo no canal!*\n\n*${video.title}*\n\n${video.description.substring(0, 200)}${video.description.length > 200 ? '...' : ''}\n\n🔗 ${video.url}\n\n✨ Compartilhem com a família e amigos, Jesus Cristo abençoe 🙏💖`,
        contextInfo: {
          externalAdReply: {
            title: video.title.substring(0, 60),
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

      this.log(`Iniciando envio para ${availableGroups.length} grupos (Op: ${operationId})`, 'info');

      for (let i = 0; i < availableGroups.length; i++) {
        const groupId = availableGroups[i];
        
        try {
          // Verificar se ainda está conectado
          if (!this.sock || !this.isConnectedFlag) {
            throw new Error('Bot desconectado durante envio');
          }

          await this.sendMessageWithLock(groupId, message, 'batch');
          successCount++;
          
          this.log(`Enviado para grupo ${i + 1}/${availableGroups.length}`, 'success');

          // Delay entre grupos
          if (i < availableGroups.length - 1) {
            const delay = Math.max(config.antiBanSettings?.delayBetweenGroups || 5, 3);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
          }

        } catch (error) {
          errorCount++;
          errors.push({ groupId, error: error.message });
          this.log(`Erro ao enviar para grupo ${i + 1}: ${error.message}`, 'error');
          
          // Se houver muitos erros consecutivos, parar
          if (errorCount > 5 && (errorCount / (i + 1)) > 0.5) {
            this.log('Muitos erros consecutivos, interrompendo envio', 'warning');
            break;
          }
        }
      }

      this.log(`Envio concluído (Op: ${operationId}): ${successCount} sucessos, ${errorCount} erros`, 'info');
      
      return { 
        successCount, 
        errorCount, 
        errors,
        total: availableGroups.length,
        skipped: limitedGroupIds.length - availableGroups.length
      };

    } catch (error) {
      this.log(`Erro no envio em lote (Op: ${operationId}): ${error.message}`, 'error');
      throw error;
    }
  }

  async disconnect() {
    const operationId = this.generateOperationId('disconnect');
    
    try {
      this.log(`Desconectando bot... (Op: ${operationId})`, 'info');
      
      this.isConnectedFlag = false;
      this.isInitializing = false;
      this.clearAllLocks();

      await this.safeDisconnect(true);

      // Limpar cache e dados
      this.lastVideoCache = null;
      this.groups = [];
      this.retryCount = 0;
      this.connectionAttempts = 0;
      this.requestCounter = 0;

      this.log(`Bot desconectado (Op: ${operationId})`, 'success');
      return true;
    } catch (error) {
      this.log(`Erro ao desconectar (Op: ${operationId}): ${error.message}`, 'error');
      
      // Forçar limpeza mesmo com erro
      this.isConnectedFlag = false;
      this.sock = null;
      this.clearAllLocks();
      
      if (this.io) {
        try {
          this.io.emit('botStatus', { connected: false });
        } catch (emitError) {
          // Ignorar erro de emissão
        }
      }
      
      return true;
    }
  }

  isConnected() {
    return this.isConnectedFlag && this.sock && !this.isInitializing;
  }

  async getGroupInfo(groupId) {
    const operationId = this.generateOperationId('getGroupInfo');
    
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }

      if (!groupId || typeof groupId !== 'string') {
        throw new Error('GroupId inválido');
      }
      
      await this.waitForRateLimit();
      
      const metadataPromise = this.sock.groupMetadata(groupId);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout ao obter metadados')), 15000)
      );
      
      const groupMetadata = await Promise.race([metadataPromise, timeoutPromise]);
      
      return {
        id: groupId,
        name: (groupMetadata.subject || 'Grupo sem nome').substring(0, 100),
        participants: Math.min(groupMetadata.participants?.length || 0, 9999),
        description: (groupMetadata.desc || '').substring(0, 200),
        owner: groupMetadata.owner || ''
      };
    } catch (error) {
      this.log(`Erro ao obter info do grupo ${groupId} (Op: ${operationId}): ${error.message}`, 'error');
      return null;
    }
  }

  async sendCustomMessage(groupId, messageText) {
    const operationId = this.generateOperationId('sendCustomMessage');
    
    try {
      if (!this.sock || !this.isConnectedFlag) {
        throw new Error('Bot não conectado');
      }

      if (!groupId || !messageText || typeof messageText !== 'string') {
        throw new Error('GroupId e messageText são obrigatórios');
      }

      // Limitar tamanho da mensagem
      const limitedMessage = messageText.substring(0, 4000);
      const message = { text: limitedMessage };
      
      await this.sendMessageWithLock(groupId, message, 'custom');
      
      this.log(`Mensagem personalizada enviada para: ${groupId} (Op: ${operationId})`, 'success');
      return true;
    } catch (error) {
      this.log(`Erro ao enviar mensagem para ${groupId} (Op: ${operationId}): ${error.message}`, 'error');
      throw error;
    }
  }

  getLockStatus() {
    try {
      return {
        groupLocks: Array.from(this.groupLocks),
        messageLocks: this.messageLocks.size,
        queueSize: this.sendingQueue.size,
        cacheStatus: this.lastVideoCache ? 'ativo' : 'vazio',
        cacheAge: this.lastVideoCache ? Date.now() - this.lastVideoCache.timestamp : 0,
        connectionAttempts: this.connectionAttempts,
        isInitializing: this.isInitializing,
        activeOperations: Array.from(this.activeOperations),
        operationTimeouts: this.operationTimeouts.size,
        eventListeners: this.eventListeners.size,
        retryCount: this.retryCount,
        requestCounter: this.requestCounter
      };
    } catch (error) {
      this.log('Erro ao obter status de locks: ' + error.message, 'warning');
      return {
        error: error.message,
        groupLocks: [],
        messageLocks: 0,
        queueSize: 0
      };
    }
  }

  forceClearLocks() {
    try {
      this.clearAllLocks();
      
      // Limpar timeouts também
      for (const [opId, timeout] of this.operationTimeouts) {
        clearTimeout(timeout);
      }
      this.operationTimeouts.clear();
      
      // Limpar listeners se necessário
      if (this.eventListeners.size > 10) { // Muitos listeners podem indicar problema
        this.eventListeners.clear();
        this.log('Event listeners forçadamente limpos', 'warning');
      }
      
      this.log('Locks forçadamente limpos', 'warning');
      return true;
    } catch (error) {
      this.log('Erro ao forçar limpeza de locks: ' + error.message, 'error');
      return false;
    }
  }

  // Método para diagnóstico
  getDiagnostics() {
    try {
      return {
        timestamp: new Date().toISOString(),
        connected: this.isConnected(),
        isInitializing: this.isInitializing,
        connectionAttempts: this.connectionAttempts,
        retryCount: this.retryCount,
        groupsCount: this.groups.length,
        lockStatus: this.getLockStatus(),
        memoryUsage: {
          sendingQueue: this.sendingQueue.size,
          messageLocks: this.messageLocks.size,
          groupLocks: this.groupLocks.size,
          activeOperations: this.activeOperations.size,
          operationTimeouts: this.operationTimeouts.size,
          eventListeners: this.eventListeners.size
        },
        cacheInfo: {
          hasCache: !!this.lastVideoCache,
          cacheAge: this.lastVideoCache ? Date.now() - this.lastVideoCache.timestamp : 0,
          requestCounter: this.requestCounter
        },
        timeouts: {
          reconnect: !!this.reconnectTimeout,
          loadGroups: !!this.loadGroupsTimeout
        }
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Método para limpeza completa (uso em emergência)
  async emergencyCleanup() {
    const operationId = this.generateOperationId('emergencyCleanup');
    
    try {
      this.log(`Iniciando limpeza de emergência... (Op: ${operationId})`, 'warning');
      
      // 1. Parar inicialização se estiver em andamento
      this.isInitializing = false;
      
      // 2. Desconectar de forma forçada
      await this.safeDisconnect(false);
      
      // 3. Limpar todos os dados
      this.clearAllLocks();
      this.groups = [];
      this.lastVideoCache = null;
      
      // 4. Resetar contadores
      this.retryCount = 0;
      this.connectionAttempts = 0;
      this.requestCounter = 0;
      
      // 5. Limpar timeouts
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      
      if (this.loadGroupsTimeout) {
        clearTimeout(this.loadGroupsTimeout);
        this.loadGroupsTimeout = null;
      }
      
      // 6. Limpar todos os timeouts de operação
      for (const [opId, timeout] of this.operationTimeouts) {
        clearTimeout(timeout);
      }
      this.operationTimeouts.clear();
      
      // 7. Limpar listeners
      this.eventListeners.clear();
      
      // 8. Resetar flags
      this.isConnectedFlag = false;
      
      this.log(`Limpeza de emergência concluída (Op: ${operationId})`, 'success');
      
      // 9. Emitir status final
      if (this.io) {
        try {
          this.io.emit('botStatus', { connected: false });
          this.io.emit('qrCode', null);
        } catch (error) {
          // Ignorar erro de emissão
        }
      }
      
      return true;
      
    } catch (error) {
      this.log(`Erro na limpeza de emergência (Op: ${operationId}): ${error.message}`, 'error');
      return false;
    }
  }
}

// Funções auxiliares para verificar JIDs (movidas para fora da classe)
function isJidBroadcast(jid) {
  try {
    return jid && typeof jid === 'string' && jid.includes('@broadcast');
  } catch {
    return false;
  }
}

function isJidNewsletter(jid) {
  try {
    return jid && typeof jid === 'string' && jid.includes('@newsletter');
  } catch {
    return false;
  }
}

module.exports = WhatsAppBot;