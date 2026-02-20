const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { stmts } = require('../database');

let client = null;
let io = null;
let clientInfo = null;
let connectionStatus = 'disconnected'; // disconnected | qr | connected
let initError = null;

// Find Chrome/Chromium binary
function findChromePath() {
  // Check common paths
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }

  // Try puppeteer's bundled Chrome
  try {
    const puppeteer = require('puppeteer');
    const ep = puppeteer.executablePath();
    if (fs.existsSync(ep)) return ep;
  } catch (e) {
    // puppeteer not available
  }

  // Search in project .cache directory
  const cacheDir = path.join(__dirname, '..', '.cache', 'puppeteer');
  if (fs.existsSync(cacheDir)) {
    const found = findFileRecursive(cacheDir, 'chrome');
    if (found) return found;
  }

  return null;
}

function findFileRecursive(dir, name) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const result = findFileRecursive(fullPath, name);
        if (result) return result;
      } else if (entry.name === name && !entry.name.includes('.')) {
        // Check if executable
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch (e) {
          // not executable
        }
      }
    }
  } catch (e) {
    // permission error
  }
  return null;
}

function getStatus() {
  return { status: connectionStatus, info: clientInfo, error: initError };
}

function formatPhone(phone) {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (!cleaned.includes('@')) cleaned += '@c.us';
  return cleaned;
}

async function sendMessage(phone, message, media = null) {
  if (!client || connectionStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected');
  }

  const chatId = formatPhone(phone);
  let result;

  if (media) {
    const messageMedia = media instanceof MessageMedia
      ? media
      : MessageMedia.fromFilePath(media);
    result = await client.sendMessage(chatId, messageMedia, { caption: message || '' });
  } else {
    result = await client.sendMessage(chatId, message);
  }

  stmts.insertLog.run(phone, message || '[media]', 'sent', media ? 'media' : 'text', 'sent');
  return result;
}

function initialize(socketIo) {
  io = socketIo;

  const chromePath = findChromePath();
  console.log('Chrome path found:', chromePath || 'NONE');

  if (!chromePath) {
    initError = 'Chrome/Chromium binary not found. Install chromium on the server.';
    console.error(initError);
    return null;
  }

  initError = null;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', 'data', 'wa-session') }),
    puppeteer: {
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
    },
  });

  client.on('qr', async (qr) => {
    connectionStatus = 'qr';
    console.log('QR code received, sending to dashboard...');
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      io.emit('qr', qrDataUrl);
      io.emit('status', getStatus());
    } catch (err) {
      console.error('QR generation error:', err);
    }
  });

  client.on('ready', () => {
    connectionStatus = 'connected';
    clientInfo = {
      pushname: client.info.pushname,
      phone: client.info.wid.user,
      platform: client.info.platform,
    };
    console.log('WhatsApp client ready:', clientInfo.pushname);
    io.emit('status', getStatus());
    io.emit('ready', clientInfo);
  });

  client.on('authenticated', () => {
    console.log('WhatsApp client authenticated');
  });

  client.on('auth_failure', (msg) => {
    connectionStatus = 'disconnected';
    initError = 'Auth failure: ' + msg;
    console.error('WhatsApp auth failure:', msg);
    io.emit('status', getStatus());
    io.emit('auth_failure', msg);
  });

  client.on('disconnected', (reason) => {
    connectionStatus = 'disconnected';
    clientInfo = null;
    console.log('WhatsApp client disconnected:', reason);
    io.emit('status', getStatus());
  });

  client.on('message', (msg) => {
    stmts.insertLog.run(
      msg.from.replace('@c.us', ''),
      msg.body,
      'received',
      msg.hasMedia ? 'media' : 'text',
      'received'
    );
    io.emit('message_received', {
      from: msg.from,
      body: msg.body,
      timestamp: msg.timestamp,
    });
  });

  client.initialize().catch((err) => {
    initError = err.message;
    console.error('WhatsApp client init error:', err);
    connectionStatus = 'disconnected';
    io.emit('status', getStatus());
  });

  return client;
}

function getClient() {
  return client;
}

async function logout() {
  if (client) {
    await client.logout();
    connectionStatus = 'disconnected';
    clientInfo = null;
    io.emit('status', getStatus());
  }
}

module.exports = { initialize, getClient, getStatus, sendMessage, formatPhone, logout };
