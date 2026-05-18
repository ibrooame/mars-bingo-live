const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { verifyTelegramWebappData } = require('../middleware/auth');
const logger = require('../utils/logger');
require('dotenv').config();

router.post('/telegram-login', async (req, res) => {
  const { initData } = req.body;
  if (!initData) return res.status(400).json({ error: 'Initialization string parameter missing.' });

  const isValid = verifyTelegramWebappData(initData);
  if (!isValid && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Cryptographic data signature check failed.' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const userRaw = urlParams.get('user');
    if (!userRaw) return res.status(400).json({ error: 'User payload parameter missing.' });

    const tgUser = JSON.parse(userRaw);
    let user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tgUser.id]);
    
    if (!user) {
      await db.run(
        `INSERT INTO users (telegram_id, username, balance, level, streak, created_at) 
         VALUES (?, ?, 0.0, 1, 0, strftime('%s', 'now'))`,
        [tgUser.id, tgUser.username || tgUser.first_name || 'Player']
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tgUser.id]);
    } else if (tgUser.username && tgUser.username !== user.username) {
      await db.run('UPDATE users SET username = ? WHERE telegram_id = ?', [tgUser.username, tgUser.id]);
    }

    const sessionToken = jwt.sign(
      { telegram_id: user.telegram_id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: sessionToken,
      user: {
        telegram_id: user.telegram_id,
        username: user.username,
        balance: user.balance,
        level: user.level,
        streak: user.streak
      }
    });
  } catch (err) {
    logger.error('Authentication routing framework crash:', err);
    res.status(500).json({ error: 'Internal system processing exception.' });
  }
});

module.exports = router;
