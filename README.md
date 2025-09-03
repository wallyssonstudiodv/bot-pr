# Auto Envios Bot - WhatsApp YouTube Scheduler

Bot automático para envio de vídeos do YouTube para grupos do WhatsApp com sistema de agendamento avançado e proteção anti-banimento.

**Crédito:** Wallysson Studio Dv 2025  
**Lema:** "Você sonha, Deus realiza"

## ✨ Funcionalidades

- 🤖 **Bot WhatsApp** com interface web
- 📅 **Agendamentos personalizados** por grupo
- 🛡️ **Sistema anti-banimento** configurável
- 🎥 **Busca automática** do último vídeo do canal
- 👥 **Seleção específica** de grupos por agendamento
- 📊 **Logs em tempo real**
- 🔄 **Reconexão automática**

## 🚀 Instalação

1. **Clone ou baixe os arquivos**
2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Crie a estrutura de pastas:**
   ```
   projeto/
   ├── server.js
   ├── package.json
   ├── bot/
   │   └── whatsapp-bot.js
   └── public/
       └── index.html
   ```

4. **Inicie o servidor:**
   ```bash
   npm start
   ```

5. **Acesse:** http://localhost:3000

## 📋 Configuração

### 1. YouTube API
- Obtenha uma API Key no Google Cloud Console
- Copie o ID do seu canal do YouTube
- Insira na interface web

### 2. WhatsApp
- Clique em "Conectar Bot"
- Escaneie o QR Code com WhatsApp Web
- Aguarde a conexão

### 3. Proteção Anti-Banimento
Configure os delays para evitar banimento:
- **Delay entre grupos:** 5-15 segundos (recomendado)
- **Max grupos por lote:** 10-20 grupos
- **Delay entre lotes:** 30-60 segundos

### 4. Agendamentos
- Clique em "Novo Agendamento"
- Configure horário e dias
- **Selecione grupos específicos** para cada agendamento
- Salve e ative

## ⚠️ Dicas de Segurança

1. **Não envie para muitos grupos** simultaneamente
2. **Use delays apropriados** entre envios
3. **Teste primeiro** com poucos grupos
4. **Monitore os logs** para detectar problemas
5. **Use API Key própria** do YouTube

## 🔧 Estrutura do Projeto

```
├── server.js              # Servidor principal
├── package.json          # Dependências
├── bot/
│   └── whatsapp-bot.js   # Lógica do bot WhatsApp
├── public/
│   └── index.html        # Interface web
├── config/
│   └── settings.json     # Configurações (criado automaticamente)
└── sessions/             # Sessões WhatsApp (criado automaticamente)
```

## 📝 Como Usar

1. **Configurar:** API do YouTube e proteções
2. **Conectar:** WhatsApp via QR Code
3. **Criar:** Agendamentos com grupos específicos
4. **Monitorar:** Logs em tempo real
5. **Testar:** Envio manual antes de ativar agendamentos

## 🛠️ Troubleshooting

### Bot não conecta
- Verifique se o WhatsApp Web está funcionando
- Limpe a sessão e tente novamente
- Verifique a conexão com internet

### Erro de API YouTube
- Confirme se a API Key está correta
- Verifique se a API está ativada no Google Cloud
- Confirme o ID do canal

### Grupos não aparecem
- Aguarde alguns segundos após conectar
- Clique em "Atualizar Grupos"
- Verifique se o WhatsApp tem acesso aos grupos

## 📞 Suporte

Desenvolvido por **Wallysson Studio Dv 2025**

---

⚡ **Dica:** Sempre teste com poucos grupos primeiro antes de configurar envios em massa!