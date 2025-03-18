/*************************************************************************
 * index.js — серверная логика (Express + TMI.js + WebSocket)
 *************************************************************************/

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const tmi = require('tmi.js');

// Папка для загрузки файлов (public/img)
const uploadFolder = path.join(__dirname, 'public', 'img');
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Настраиваем multer для сохранения файлов в public/img
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    const targetPath = path.join(uploadFolder, file.originalname);
    if (fs.existsSync(targetPath)) {
      console.log("File already exists, using existing file:", file.originalname);
      cb(null, file.originalname);
    } else {
      const newName = Date.now() + '-' + file.originalname;
      cb(null, newName);
    }
  }
});
const upload = multer({ storage });

// Загружаем или создаём config.json
const configPath = path.join(__dirname, 'config.json');
let config = {
  BOT_USERNAME: 'Your_Bot_Login',
  BOT_OAUTH: 'oauth:xxxxxx',
  CHANNEL_NAME: 'your_channel',
  chatDelay: 130,
  skins: [],
  dropMode: 'random',
  fixedSkin: null,
  rarityChances: {
    "Mil-Spec": 79.9,
    "Restricted": 16,
    "Classified": 3.2,
    "Covert": 0.64,
    "Rare Special Items": 0.125
  },
  scrollSpeedPreset: 10,
  scrollSpeedRandom: 5,
  skinsCount: 20,
  raritySkinsCount: {
    "Mil-Spec": 20,
    "Restricted": 20,
    "Classified": 20,
    "Covert": 20,
    "Rare Special Items": 20
  }
};
try {
  const configFile = fs.readFileSync(configPath);
  Object.assign(config, JSON.parse(configFile));
} catch (err) {
  console.log('Не удалось загрузить config.json, используется конфиг по умолчанию.');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/*************************************************************************
 * Маршруты для получения/сохранения настроек
 *************************************************************************/
app.get('/get-settings', (req, res) => {
  res.json(config);
});

app.post('/save-settings', (req, res) => {
  const newConfig = req.body;

  config.BOT_USERNAME = newConfig.BOT_USERNAME || config.BOT_USERNAME;
  config.BOT_OAUTH = newConfig.BOT_OAUTH || config.BOT_OAUTH;
  config.CHANNEL_NAME = newConfig.CHANNEL_NAME || config.CHANNEL_NAME;
  config.chatDelay = newConfig.chatDelay || config.chatDelay;
  if (Array.isArray(newConfig.skins)) {
    config.skins = newConfig.skins;
  }
  config.dropMode = newConfig.dropMode || 'random';
  config.fixedSkin = newConfig.fixedSkin || null;
  config.rarityChances = newConfig.rarityChances || config.rarityChances;
  config.scrollSpeedPreset = newConfig.scrollSpeedPreset || config.scrollSpeedPreset;
  config.scrollSpeedRandom = newConfig.scrollSpeedRandom || config.scrollSpeedRandom;
  config.skinsCount = newConfig.skinsCount || config.skinsCount;
  config.raritySkinsCount = newConfig.raritySkinsCount || config.raritySkinsCount;

  fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
    if (err) {
      console.error('Ошибка записи config.json:', err);
      return res.status(500).json({ message: 'Ошибка сохранения настроек' });
    }
    res.json({ message: 'Настройки сохранены. Перезапустите сервер для применения изменений.' });

    // Уведомляем клиентов о обновлении настроек
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'settings-updated' }));
      }
    });
  });
});

app.post('/upload-skin', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  const filePath = '/img/' + req.file.filename;
  console.log("File saved (or reused):", filePath);
  res.json({ path: filePath });
});

/*************************************************************************
 * Логика TMI.js (чат-бот) и сбор участников
 *************************************************************************/
const tmiConfig = {
  options: { debug: true },
  connection: { reconnect: true, secure: true },
  identity: {
    username: config.BOT_USERNAME,
    password: config.BOT_OAUTH
  },
  channels: [ config.CHANNEL_NAME ]
};

const client = new tmi.Client(tmiConfig);
let collecting = false;
let participants = [];
let isOpen = false;

client.on('message', (channel, tags, message, self) => {
  if (self) return;
  const username = tags.username.toLowerCase();
  const msg = message.trim().toLowerCase();

  if (msg === '!letsgo') {
    if (tags.badges && tags.badges.broadcaster === '1') {
      startCollection();
    } else {
      client.say(config.CHANNEL_NAME, 'Galaxy runs this madhouse. Don’t fight it - just roll with the trip.');
    }
  }

  if (msg === '!open') {
    if (tags.badges && tags.badges.broadcaster === '1') {
      isOpen = true;
      sendOpenToOverlay();
    }
  }

  if (collecting && msg === '!galaxy') {
    if (!participants.includes(username)) {
      participants.push(username);
      client.say(config.CHANNEL_NAME, `@${username} You've been thrown into the chaos of fate - welcome to the giveaway, soldier!`);
      sendParticipantsUpdate();
    }
  }

  if (msg === '!roll') {
    if (tags.badges && tags.badges.broadcaster === '1') {
      if (!isOpen) {
        client.say(config.CHANNEL_NAME, 'I love you all!');
        return;
      }
      if (participants.length === 0) {
        client.say(config.CHANNEL_NAME, 'HELLO WORLD!');
        return;
      }
      collecting = false;
      const winner = participants[Math.floor(Math.random() * participants.length)];
      const delay = (config.chatDelay || 130) * 1000;
      setTimeout(() => {
        client.say(config.CHANNEL_NAME, `Let's congratulate the winner!`);
      }, delay);
      sendRollToOverlay(winner, participants);
      isOpen = false;
    }
  }
});

function startCollection() {
  collecting = true;
  participants = [];
  sendParticipantsUpdate();
  client.say(config.CHANNEL_NAME, 'Type !galaxy in chat and claim your prize - if the cosmos deems you worthy.');
}

client.connect();

/*************************************************************************
 * WebSocket-сервер для оверлея
 *************************************************************************/
const server = app.listen(8080, () => {
  console.log('[SERVER] Запущен на порту 8080');
});
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('[WS] Overlay connected!');
});

function sendOpenToOverlay() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'open' }));
    }
  });
}

function sendParticipantsUpdate() {
  const data = { type: 'updateParticipants', participants };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function sendRollToOverlay(winner, participantsList) {
  const data = {
    type: 'roll',
    winner,
    participants: participantsList,
    dropMode: config.dropMode
  };
  if (config.dropMode === 'preset' && config.fixedSkin) {
    data.fixedSkin = config.fixedSkin;
  }
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}
