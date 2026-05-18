const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const logger = require('../utils/logger');
const fs = require('fs');

require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200, 
  message: { error: "Too many operational requests from this environment." }
});
app.use('/api/', limiter);

const authRoutes = require('../routes/auth');
const walletRoutes = require('../routes/wallet');
const adminRoutes = require('../routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '../client'), { maxAge: 0, etag: false }));

async function startProductionServer() {
  try {
    console.log('⏳ Running automated table verification check...');
    
    const initScriptPath = path.join(__dirname, '../database/init.js');
    if (fs.existsSync(initScriptPath)) {
      delete require.cache[require.resolve(initScriptPath)];
      const initDb = require(initScriptPath);
      if (typeof initDb === 'function') {
        await initDb();
      }
    }

    const gameEngine = require('../services/gameEngine');
    const { initSocketServer } = require('../sockets/gameSocket');
    const bot = require('../bot/index');

    gameEngine.init(io);
    initSocketServer(io);

    // Dynamic error handling to keep server port alive if bot tracking fails
    await bot.launch()
      .then(() => logger.info('Telegram Bot Client integration active and online.'))
      .catch((e) => console.error('Bot launch error (non-blocking for port binding):', e.message));

    // STRICTOR PORT BINDING RULE
    // Explicitly target host '0.0.0.0' to pass Render's port scan validator checks
    const PORT = process.env.PORT || 10000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n====================================================`);
      console.log(`🚀 MARS BINGO LIVE SERVER RUNNING ON PORT ${PORT}`);
      console.log(`====================================================\n`);
    });

  } catch (err) {
    logger.error('CRITICAL STARTUP ENGINE FAULT:', err);
    console.error('Server failed to bind or initialize safely:', err.message);
    process.exit(1);
  }
}

startProductionServer();

process.once('SIGINT', () => { process.exit(0); });
process.once('SIGTERM', () => { process.exit(0); });
