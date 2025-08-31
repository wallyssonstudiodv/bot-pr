# 🤖 Bot WhatsApp YouTube com Baileys

Bot automatizado para enviar notificações de novos vídeos do YouTube para grupos do WhatsApp com sistema de agendamento e painel de controle via terminal.

## 🚀 Funcionalidades

- ✅ Conexão com WhatsApp via Baileys (última versão)
- ✅ Busca automática de novos vídeos do YouTube
- ✅ Envio para múltiplos grupos selecionados
- ✅ Sistema de agendamento com cron jobs
- ✅ Painel de controle interativo no terminal
- ✅ Gerenciamento de grupos (ativar/desativar)
- ✅ Envio de mensagem + imagem (thumbnail do vídeo)
- ✅ Detecção de vídeos novos
- ✅ Persistência de dados

## 📋 Pré-requisitos

- Node.js 16+ 
- NPM ou Yarn
- Chave da API do YouTube
- WhatsApp instalado no celular

## 🔧 Instalação

1. **Clone ou baixe os arquivos**
```bash
git clone <seu-repositorio>
cd youtube-whatsapp-bot
```

2. **Instale as dependências**
```bash
npm install
```

3. **Configure suas credenciais**
   - Abra o arquivo `bot.js`
   - Substitua a `youtubeApiKey` pela sua chave da API do YouTube
   - Substitua o `channelId` pelo ID do seu canal

4. **Execute o bot**
```bash
npm start
```

## 🎯 Como Usar

### 1. **Primeira Conexão**
```
🤖 Bot> connect
🤖 Bot> qr
```
- Escaneie o QR Code com seu WhatsApp

### 2. **Comandos Principais**

| Comando | Descrição |
|---------|-----------|
| `help` | Mostra todos os comandos |
| `status` | Status da conexão e estatísticas |
| `groups` | Lista todos os grupos disponíveis |
| `activate <nome>` | Ativa um grupo para receber envios |
| `deactivate <nome>` | Desativa um grupo |
| `test` | Testa a busca de vídeos |
| `send` | Verifica e envia vídeos novos manualmente |

### 3. **Sistema de Agendamento**

**Criar agendamento:**
```bash
🤖 Bot> schedule "0 9,18 * * *"
```
Isso irá verificar novos vídeos às 9h e 18h todos os dias.

**Outros exemplos de agendamento:**
- `"*/30 * * * *"` - A cada 30 minutos
- `"0 8 * * 1-5"` - 8h de segunda a sexta
- `"0 20 * * 0"` - 20h aos domingos

**Gerenciar agendamentos:**
```bash
🤖 Bot> schedules          # Lista agendamentos
🤖 Bot> remove <id>        # Remove agendamento
```

### 4. **Fluxo de Trabalho Típico**

```bash
# 1. Conectar
🤖 Bot> connect

# 2. Ver grupos disponíveis  
🤖 Bot> groups

# 3. Ativar grupos desejados
🤖 Bot> activate Igreja
🤖 Bot> activate Família

# 4. Criar agendamento
🤖 Bot> schedule "0 9,18 * * *"

# 5. Testar
🤖 Bot> test
🤖 Bot> send
```

## 📱 Formato das Mensagens

O bot envia duas mensagens:

1. **Mensagem de texto:**
```
🚨 Saiu vídeo novo no canal!

🎬 *Título do Vídeo*
👉 Assista agora: https://youtube.com/watch?v=...

Compartilhe com a família e amigos 🙏 Jesus abençoe!
```

2. **Imagem com legenda:**
```
🆕 Título do Vídeo
🎥 Assista: https://youtube.com/watch?v=...
```

## 🔑 Obtendo API Key do YouTube

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto
3. Ative a "YouTube Data API v3"
4. Vá em "Credenciais" → "Criar credenciais" → "Chave de API"
5. Copie a chave gerada

## 📁 Estrutura de Arquivos

```
youtube-whatsapp-bot/
├── bot.js              # Arquivo principal do bot
├── package.json        # Dependências
├── bot_data.json       # Dados salvos automaticamente
├── auth/               # Dados de autenticação (criado automaticamente)
└── README.md          # Este arquivo
```

## ⚙️ Configurações Avançadas

### Personalizar Mensagens
Edite as variáveis no arquivo `bot.js`:
```javascript
const message = `🚨 Saiu vídeo novo no canal!\n\n🎬 *${videoData.title}*\n👉 Assista agora: ${videoData.link}\n\nCompartilhe com a família e amigos 🙏 Jesus abençoe!`;
```

### Alterar Delay Entre Envios
```javascript
await this.delay(2000); // 2 segundos entre grupos
```

## 🐛 Solução de Problemas

### Bot não conecta
- Verifique sua conexão com internet
- Certifique-se que o WhatsApp Web está funcionando
- Delete a pasta `auth` e reconecte

### Não encontra vídeos
- Verifique se a API Key está correta
- Confirme se o Channel ID está correto
- Teste manualmente: `🤖 Bot> test`

### Grupos não aparecem
- Certifique-se que o bot está conectado
- Digite `🤖 Bot> groups` após conectar

## 📊 Monitoramento

O bot salva automaticamente:
- Último vídeo processado
- Configurações de grupos
- Agendamentos ativos

Dados salvos em: `bot_data.json`

## 🔄 Reinicialização Automática

Para manter o bot sempre rodando, use PM2:

```bash
npm install -g pm2
pm2 start bot.js --name youtube-bot
pm2 startup
pm2 save
```

## ⚠️ Importantes

- Mantenha sua API Key segura
- Não abuse da API do YouTube (limite de requisições)
- Respeite as políticas do WhatsApp
- Teste sempre em grupos pequenos primeiro

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique este README
2. Use `🤖 Bot> help` para comandos
3. Teste com `🤖 Bot> status` e `🤖 Bot> test`

---

**Desenvolvido com ❤️ usando Baileys e Node.js**