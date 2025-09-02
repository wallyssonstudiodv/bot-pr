@echo off
chcp 65001 >nul
title Auto Envios Bot - Instalador

echo.
echo 🚀 ========================================
echo    AUTO ENVIOS BOT - INSTALADOR  
echo    Wallysson Studio Dv 2025
echo    "Você sonha, Deus realiza"
echo ========================================
echo.

echo 📋 Verificando pré-requisitos...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js não encontrado!
    echo 📥 Baixe em: https://nodejs.org
    echo 📌 Versão recomendada: 16.20.0 LTS
    pause
    exit /b 1
)

echo ✅ Node.js encontrado
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo 📌 Versão: %NODE_VERSION%
echo.

echo 📁 Criando estrutura de diretórios...
if not exist "bot" mkdir bot
if not exist "public" mkdir public
if not exist "config" mkdir config
if not exist "sessions" mkdir sessions
if not exist "logs" mkdir logs
echo ✅ Estrutura criada!
echo.

echo 🧹 Limpando instalação anterior...
if exist node_modules (
    echo 🗑️ Removendo node_modules...
    rmdir /s /q node_modules
)
if exist package-lock.json (
    echo 🗑️ Removendo package-lock.json...
    del package-lock.json
)
echo.

echo 💾 Limpando cache do NPM...
npm cache clean --force
echo.

echo 📦 Instalando dependências...
echo ⏳ Isso pode levar alguns minutos...
echo.

npm install --legacy-peer-deps --no-audit --no-fund

if %errorlevel% neq 0 (
    echo.
    echo ⚠️ Erro com NPM. Tentando com Yarn...
    echo 📥 Instalando Yarn...
    npm install -g yarn
    
    if %errorlevel% neq 0 (
        echo ❌ Erro ao instalar Yarn
        goto :error
    )
    
    echo 📦 Instalando com Yarn...
    yarn install --ignore-engines
    
    if %errorlevel% neq 0 (
        echo ❌ Erro com Yarn também
        goto :error
    )
)

echo.
echo ✅ Dependências instaladas com sucesso!
echo.

echo 🔧 Criando arquivos de configuração...
echo { > config\default.json
echo   "youtubeApiKey": "", >> config\default.json
echo   "channelId": "", >> config\default.json
echo   "schedules": [], >> config\default.json
echo   "activeGroups": [] >> config\default.json
echo } >> config\default.json
echo ✅ Arquivo de configuração criado!
echo.

echo 🎯 Testando instalação...
node -e "console.log('✅ Node.js funcionando')"
if %errorlevel% neq 0 goto :error

node -e "const baileys = require('@whiskeysockets/baileys'); console.log('✅ Baileys carregado')"
if %errorlevel% neq 0 goto :error

node -e "const express = require('express'); console.log('✅ Express carregado')"
if %errorlevel% neq 0 goto :error

echo.
echo 🎉 ========================================
echo    INSTALAÇÃO CONCLUÍDA COM SUCESSO!
echo ========================================
echo.
echo 📝 PRÓXIMOS PASSOS:
echo.
echo 1️⃣ Configure sua API do YouTube:
echo    • Acesse: https://console.cloud.google.com/
echo    • Ative a YouTube Data API v3
echo    • Crie uma API Key
echo.
echo 2️⃣ Iniciar o bot:
echo    npm start
echo.
echo 3️⃣ Acessar interface:
echo    http://localhost:3000
echo.
echo 4️⃣ Conectar WhatsApp:
echo    • Escaneie o QR Code
echo    • Configure os grupos
echo    • Crie agendamentos
echo.
echo 💡 DICAS:
echo    • Mantenha o terminal aberto
echo    • Para parar: Ctrl+C
echo    • Para logs: verifique a interface web
echo.
echo ✨ "Você sonha, Deus realiza" ✨
echo 📧 Crédito: Wallysson Studio Dv 2025
echo.
echo Pressione qualquer tecla para iniciar o bot...
pause >nul

echo.
echo 🚀 Iniciando Auto Envios Bot...
echo 📱 Acesse: http://localhost:3000
echo ❌ Para parar: Ctrl+C
echo.
npm start

goto :end

:error
echo.
echo ❌ ========================================
echo    ERRO NA INSTALAÇÃO
echo ========================================
echo.
echo 🛠️ SOLUÇÕES:
echo.
echo 1️⃣ Verificar Node.js:
echo    node --version
echo    (deve ser 16.0.0 ou superior)
echo.
echo 2️⃣ Executar como Administrador:
echo    Clique com botão direito → "Executar como administrador"
echo.
echo 3️⃣ Instalar manualmente:
echo    npm install express
echo    npm install socket.io
echo    npm install @whiskeysockets/baileys
echo.
echo 4️⃣ Usar versão específica do Node.js:
echo    Baixe Node.js 16.20.0 LTS
echo.
echo 📞 Se precisar de ajuda, verifique o README.md
echo.

:end
pause