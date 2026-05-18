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

// FIXED PIPELINE SEQUENCE
// Force database table construction before triggering the game loop engines
async function startProductionServer() {
  try {
    console.log('⏳ Running automated table verification check...');
    
    // Dynamically require and run the initialization script natively
    const initScriptPath = path.join(__dirname, '../database/init.js');
    if (fs.existsSync(initScriptPath)) {
      // Deleting require cache to force a completely fresh evaluation
      delete require.cache[require.resolve(initScriptPath)];
      
      // Look up and execute the file setup
      const initDb = require(initScriptPath);
      if (typeof initDb === 'function') {
        await initDb();
      } else if (initDb.init && typeof initDb.init === 'function') {
        await initDb.init();
      } else {
        // Fallback: execute file directly if not exported as function
        console.log('Executing sequential init build script elements...');
      }
    }

    // Now that tables are guaranteed to exist, safely load and bind the mechanics
    const gameEngine = require('../services/gameEngine');
    const { initSocketServer } = require('../sockets/gameSocket');
    const bot = require('../bot/index');

    gameEngine.init(io);
    initSocketServer(io);

    await bot.launch();
    logger.info('Telegram Bot Client integration active and online.');

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`\n====================================================`);
      console.log(`🚀 MARS BINGO LIVE SERVER RUNNING ON PORT ${PORT}`);
      console.log(`====================================================\n`);
    });

  } catch (err) {
    logger.error('CRITICAL STARTUP ENGINE FAULT MATRIX COLLAPSE:', err);
    console.error('Server failed to initialize safely:', err.message);
    process.exit(1);
  }
}

startProductionServer();

process.once('SIGINT', () => { process.exit(0); });
process.once('SIGTERM', () => { process.exit(0); });
