#!/bin/bash

# Configura cores e estilo (opcional)
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
RESET="\e[0m"

echo -e "\n${GREEN}🚀 ========================================"
echo -e "    AUTO ENVIOS BOT - INSTALADOR"
echo -e "    Wallysson Studio Dv 2025"
echo -e "    \"Você sonha, Deus realiza\""
echo -e "========================================${RESET}\n"

# Verifica Node.js
echo -e "📋 Verificando pré-requisitos..."
if ! command -v node &> /dev/null
then
    echo -e "${RED}❌ Node.js não encontrado!"
    echo "📥 Baixe em: https://nodejs.org"
    echo "📌 Versão recomendada: 16.20.0 LTS"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✅ Node.js encontrado"
echo -e "📌 Versão: $NODE_VERSION\n"

# Criar diretórios
echo -e "📁 Criando estrutura de diretórios..."
mkdir -p bot public config sessions logs
echo -e "${GREEN}✅ Estrutura criada!\n"

# Limpar instalação anterior
echo -e "🧹 Limpando instalação anterior..."
[ -d "node_modules" ] && rm -rf node_modules && echo "🗑️ node_modules removido"
[ -f "package-lock.json" ] && rm package-lock.json && echo "🗑️ package-lock.json removido"
echo

# Limpar cache do npm
echo -e "💾 Limpando cache do NPM..."
npm cache clean --force
echo

# Instalar dependências
echo -e "📦 Instalando dependências..."
echo "⏳ Isso pode levar alguns minutos..."
npm install --legacy-peer-deps --no-audit --no-fund || {
    echo -e "${YELLOW}⚠️ Erro com NPM. Tentando com Yarn..."
    npm install -g yarn || { echo -e "${RED}❌ Erro ao instalar Yarn"; exit 1; }
    yarn install --ignore-engines || { echo -e "${RED}❌ Erro ao instalar com Yarn"; exit 1; }
}

echo -e "\n${GREEN}✅ Dependências instaladas com sucesso!\n"

# Criar arquivo de configuração
echo -e "🔧 Criando arquivos de configuração..."
cat > config/default.json <<EOL
{
  "youtubeApiKey": "",
  "channelId": "",
  "schedules": [],
  "activeGroups": []
}
EOL
echo -e "${GREEN}✅ Arquivo de configuração criado!\n"

# Testar instalação
echo "🎯 Testando instalação..."
node -e "console.log('✅ Node.js funcionando')" || { echo -e "${RED}Erro ao testar Node.js"; exit 1; }
node -e "require('@whiskeysockets/baileys'); console.log('✅ Baileys carregado')" || { echo -e "${RED}Erro ao carregar Baileys"; exit 1; }
node -e "require('express'); console.log('✅ Express carregado')" || { echo -e "${RED}Erro ao carregar Express"; exit 1; }

echo -e "\n🎉 ========================================"
echo -e "    INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo -e "========================================\n"

echo "📝 PRÓXIMOS PASSOS:"
echo "1️⃣ Configure sua API do YouTube:"
echo "   • Acesse: https://console.cloud.google.com/"
echo "   • Ative a YouTube Data API v3"
echo "   • Crie uma API Key"
echo
echo "2️⃣ Iniciar o bot: npm start"
echo "3️⃣ Acessar interface: http://localhost:3000"
echo
echo "✨ \"Você sonha, Deus realiza\" ✨"
echo "📧 Crédito: Wallysson Studio Dv 2025"
echo

read -n1 -r -p "Pressione qualquer tecla para iniciar o bot..." key
echo -e "\n🚀 Iniciando Auto Envios Bot..."
echo "📱 Acesse: http://localhost:3000"
echo "❌ Para parar: Ctrl+C"
echo

npm start