#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Função para limpar sessão corrompida
function cleanAuthSession() {
    const authDir = './auth';
    if (fs.existsSync(authDir)) {
        console.log('🧹 Limpando sessão antiga...');
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log('✅ Sessão limpa!');
    }
}

// Verifica argumentos da linha de comando
const args = process.argv.slice(2);

if (args.includes('--clean') || args.includes('-c')) {
    cleanAuthSession();
}

// Inicia o bot
console.log('🚀 Iniciando Bot YouTube WhatsApp...\n');

// Importa e inicia o bot
require('./bot.js');