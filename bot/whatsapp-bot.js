const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  Browsers
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs-extra');

class WhatsAppBot {
  constructor(io) {
    this.io = io;
    this.sock = null;
    this.connected = false;
    this.qrCode = null;
  }

  async initialize() {
    try {
      // Configurar autenticação
      const { state, saveCreds } = await useMultiFileAuthState('./sessions');
      
      // Criar socket WhatsApp
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        defaultQueryTimeoutMs: 60000,
      });

      // Eventos do socket
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          // Gerar QR Code
          try {
            const qrCodeDataURL = await QRCode.toDataURL(qr);
            this.qrCode = qrCodeDataURL;
            this.io.emit('qrCode', qrCodeDataURL);
            this.log('QR Code gerado', 'info');
          } catch (error) {
            this.log('Erro ao gerar QR Code: ' + error.message, 'error');
          }
        }
        
        if (connection === 'open') {
          this.connected = true;
          this.qrCode = null;
          this.io.emit('botStatus', { connected: true });
          this.io.emit('qrCode', null);
          this.log('Bot conectado com sucesso!', 'success');
          
          // Enviar lista de grupos
          const groups = await this.getGroups();
          this.io.emit('groupsList', groups);
        }
        
        if (connection === 'close') {
          this.connected = false;
          this.io.emit('botStatus', { connected: false });
          
          const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            this.log('Conexão perdida, tentando reconectar...', 'warning');
            setTimeout(() => this.initialize(), 5000);
          } else {
            this.log('Bot desconectado', 'info');
          }
        }
      });

      // Salvar credenciais
      this.sock.ev.on('creds.update', saveCreds);

      // Eventos de mensagens (opcional)
      this.sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0];
        if (!message.key.fromMe && m.type === 'notify') {
          this.log(`Mensagem recebida de ${message.key.remoteJid}`, 'info');
        }
      });

    } catch (error) {
      this.log('Erro ao inicializar bot: ' + error.message, 'error');
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout();
        this.sock = null;
      }
      this.connected = false;
      this.log('Bot desconectado', 'info');
    } catch (error) {
      this.log('Erro ao desconectar: ' + error.message, 'error');
    }
  }

  isConnected() {
    return this.connected;
  }

  async getGroups() {
    if (!this.connected || !this.sock) return [];
    
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const groupList = Object.values(groups).map(group => ({
        id: group.id,
        name: group.subject,
        participants: group.participants.length
      }));
      
      this.log(`${groupList.length} grupos encontrados`, 'info');
      return groupList;
    } catch (error) {
      this.log('Erro ao buscar grupos: ' + error.message, 'error');
      return [];
    }
  }

  async getLatestVideo() {
    try {
      const config = await fs.readJSON('./config/settings.json');
      const { youtubeApiKey, channelId } = config;
      
      const url = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&order=date&part=snippet&type=video&maxResults=1`;
      
      const response = await axios.get(url);
      const data = response.data;
      
      if (!data.items || data.items.length === 0) {
        throw new Error('Nenhum vídeo encontrado');
      }
      
      const video = data.items[0];
      const videoId = video.id.videoId;
      const title = video.snippet.title;
      const thumbnail = video.snippet.thumbnails.high.url;
      const link = `https://www.youtube.com/watch?v=${videoId}`;
      
      return {
        title,
        link,
        thumbnail,
        videoId
      };
    } catch (error) {
      this.log('Erro ao buscar último vídeo: ' + error.message, 'error');
      throw error;
    }
  }

  async sendLatestVideo(groupIds) {
    if (!this.connected || !this.sock) {
      throw new Error('Bot não conectado');
    }
    
    try {
      const video = await this.getLatestVideo();
      
      // Baixar thumbnail
      const thumbnailResponse = await axios.get(video.thumbnail, { 
        responseType: 'arraybuffer' 
      });
      const thumbnailBuffer = Buffer.from(thumbnailResponse.data);
      
      // Mensagem de texto
      const message = `🚨 Saiu vídeo novo no canal!\n\n🎬 *${video.title}*\n👉 Assista agora: ${video.link}\n\n📢 Compartilhe com todos! 🙏`;
      
      // Enviar para grupos selecionados
      for (const groupId of groupIds) {
        try {
          // Enviar mensagem de texto
          await this.sock.sendMessage(groupId, { text: message });
          
          // Aguardar um pouco
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Enviar imagem com legenda
          await this.sock.sendMessage(groupId, {
            image: thumbnailBuffer,
            caption: `🆕 ${video.title}\n🎥 Assista: ${video.link}`
          });
          
          this.log(`Vídeo enviado para grupo: ${groupId}`, 'success');
          
          // Aguardar entre envios
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          this.log(`Erro ao enviar para grupo ${groupId}: ${error.message}`, 'error');
        }
      }
      
      this.log('Envio concluído!', 'success');
    } catch (error) {
      this.log('Erro ao enviar vídeo: ' + error.message, 'error');
      throw error;
    }
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = {
      message,
      type,
      timestamp
    };
    
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
    this.io.emit('log', logMessage);
    
    // Salvar log em arquivo
    this.saveLog(logMessage);
  }

  async saveLog(logMessage) {
    try {
      const logFile = `./logs/${new Date().toISOString().split('T')[0]}.json`;
      let logs = [];
      
      if (await fs.pathExists(logFile)) {
        logs = await fs.readJSON(logFile);
      }
      
      logs.push(logMessage);
      await fs.writeJSON(logFile, logs, { spaces: 2 });
    } catch (error) {
      console.error('Erro ao salvar log:', error);
    }
  }
}

module.exports = WhatsAppBot;