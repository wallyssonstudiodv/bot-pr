# 🚀 Disparador Canal PR Marcelo Oliveira

**Automatize o envio de novos vídeos do Pastor Marcelo Oliveira para seus grupos do WhatsApp!**

*Criado por: **Wallysson Studio DV 2025***

---

## 📋 Sobre o Projeto

O **Disparador Canal PR Marcelo Oliveira** é um sistema automatizado que monitora o canal do YouTube do Pastor Marcelo Oliveira e envia automaticamente notificações sobre novos vídeos para grupos selecionados do WhatsApp.

### ✨ Características Principais

- 🎯 **Interface Intuitiva**: Menu em português com comandos simplificados
- 🔄 **Automação Completa**: Agendamento de verificações automáticas
- 📱 **WhatsApp Integration**: Conecta via WhatsApp Web
- 🎬 **Detecção de Vídeos Novos**: Monitora novos uploads automaticamente
- 📊 **Dashboard Completo**: Status detalhado do sistema
- 🛡️ **Sistema Robusto**: Tratamento de erros e reconexão automática

---

## 🛠️ Instalação

### Pré-requisitos

- **Node.js** (versão 16 ou superior)
- **NPM** (gerenciador de pacotes)
- **Google Chrome** ou **Chromium** instalado
- **Conexão estável com internet**

### Passo a Passo

1. **Clone ou baixe o projeto**
   ```bash
   # Se usando Git
   git clone [URL-DO-REPOSITORIO]
   cd disparador-pr-marcelo-oliveira
   ```

2. **Instale as dependências**
   ```bash
   npm install
   ```

3. **Configure sua API Key do YouTube** (opcional)
   - Abra o arquivo `disparador.js`
   - Localize a linha: `this.youtubeApiKey = "SUA_API_KEY_AQUI"`
   - Substitua pela sua API Key (ou use a padrão fornecida)

4. **Execute o sistema**
   ```bash
   npm start
   ```

---

## 🚀 Como Usar

### 1. Primeira Execução

1. Execute o comando `npm start`
2. Digite `menu` para ver todas as opções
3. Use `conectar` ou `1` para conectar ao WhatsApp
4. Escaneie o QR Code com seu WhatsApp
5. Aguarde a mensagem "✅ CONECTADO COM SUCESSO!"

### 2. Configurando Grupos

1. Use `grupos` ou `4` para listar todos os grupos
2. Use `ativar [nome]` ou `5 [nome]` para ativar um grupo
   - Exemplo: `ativar Família`
   - Exemplo: `ativar Igreja`

### 3. Testando o Sistema

1. Use `testar` ou `10` para verificar a conexão com o YouTube
2. Use `enviar` ou `7` para fazer uma verificação manual
3. Use `status` ou `3` para ver o status do sistema

### 4. Agendamento Automático

1. Use `agendar` ou `8` para ver opções de agendamento
2. Exemplos de agendamento:
   - `agendar 0 9,18 * * *` (9h e 18h todos os dias)
   - `agendar */30 * * * *` (a cada 30 minutos)
   - `agendar 0 8 * * 1-5` (8h de segunda a sexta)

---

## 📋 Comandos Disponíveis

### 🔗 Conexão
- `1` ou `conectar` - Conectar ao WhatsApp
- `2` ou `desconectar` - Desconectar do WhatsApp
- `3` ou `status` - Ver status da conexão

### 📋 Grupos
- `4` ou `grupos` - Listar todos os grupos
- `5` ou `ativar [nome]` - Ativar grupo para receber vídeos
- `6` ou `desativar [nome]` - Desativar grupo

### 🤖 Automação
- `7` ou `enviar` - Verificar e enviar vídeos novos
- `8` ou `agendar` - Programar envios automáticos
- `9` ou `agendamentos` - Ver programações ativas

### 🛠️ Ferramentas
- `10` ou `testar` - Testar busca de vídeos
- `11` ou `limpar` - Resetar sessão do WhatsApp
- `12` ou `reiniciar` - Reiniciar conexão

### 📱 Outros
- `menu` ou `ajuda` - Mostrar menu principal
- `cls` ou `clear` - Limpar tela
- `creditos` - Ver créditos do desenvolvedor
- `0` ou `sair` - Encerrar sistema

---

## ⚙️ Configurações Avançadas

### Personalização da Mensagem

Para personalizar a mensagem enviada aos grupos, edite a função `sendVideoToGroup()` no arquivo `disparador.js`:

```javascript
const message = `🚨 *VÍDEO NOVO DO PR MARCELO OLIVEIRA!*\n\n🎬 *${videoData.title}*\n\n👉 *Assista agora:* ${videoData.link}\n\n🙏 Compartilhe com família e amigos!\n\n✨ *Deus abençoe!*`;
```

### Mudança de Canal

Para monitorar outro canal do YouTube:

1. Abra `disparador.js`
2. Localize: `this.channelId = "UCh-ceOeY4WVgS8R0onTaXmw"`
3. Substitua pelo ID do canal desejado

### Intervalo de Verificação

Os agendamentos usam formato **CRON**:
- `minuto hora dia mês dia_da_semana`
- `*` = qualquer valor
- `0-6` = domingo a sábado
- `,` = múltiplos valores
- `-` = intervalo de valores

---

## 🔧 Solução de Problemas

### Problema: QR Code não aparece
**Solução**: 
1. Use `limpar` para resetar a sessão
2. Execute `reiniciar`
3. Tente `conectar` novamente

### Problema: "Erro ao buscar vídeo"
**Solução**:
1. Verifique sua conexão com internet
2. Confirme se a API Key do YouTube está válida
3. Use `testar` para verificar a conexão

### Problema: Não envia para grupos
**Solução**:
1. Certifique-se que está conectado: `status`
2. Verifique se os grupos estão ativos: `grupos`
3. Ative os grupos necessários: `ativar [nome]`

### Problema: Mensagem "Comando não encontrado"
**Solução**:
1. Digite `menu` para ver todos os comandos
2. Use números (1-12) ou nomes dos comandos
3. Exemplo: `1` ou `conectar`

---

## 📝 Arquivos do Projeto

```
disparador-pr-marcelo-oliveira/
├── disparador.js          # Código principal
├── package.json          # Dependências do projeto
├── README.md            # Este arquivo
├── bot_data.json        # Dados salvos (criado automaticamente)
└── .wwebjs_auth/        # Sessão WhatsApp (criada automaticamente)
```

---

## 🔒 Segurança e Privacidade

- ✅ **Sessão Local**: Dados armazenados apenas no seu computador
- ✅ **Sem Servidor**: Não envia dados para servidores externos
- ✅ **Código Aberto**: Você pode revisar todo o código
- ✅ **API Oficial**: Usa APIs oficiais do YouTube e WhatsApp Web

---

## 📞 Suporte

### Em caso de dúvidas ou problemas:

1. **Leia este README** completamente
2. **Teste os comandos básicos** (`status`, `testar`)
3. **Verifique os logs** no terminal
4. **Use `creditos`** para informações de contato

---

## 🎯 Créditos

**Desenvolvido com ❤️ por:**

### 🏢 **WALLYSSON STUDIO DV**
*© 2025 - Todos os direitos reservados*

**Tecnologias Utilizadas:**
- Node.js
- whatsapp-web.js
- YouTube API v3
- Node Cron
- Chalk (cores no terminal)

---

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

---

## 🔄 Atualizações

**Versão 2.0.0** - Janeiro 2025
- ✨ Interface completamente renovada
- 🎯 Menu organizado em português
- 🚀 Comandos simplificados
- 📱 Melhor experiência do usuário
- 🛡️ Sistema mais robusto

---

### 🙏 **Que Deus abençoe seu ministério!**

*"Ide por todo o mundo e pregai o evangelho a toda criatura." - Marcos 16:15*