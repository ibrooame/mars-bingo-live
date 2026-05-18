const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { adminMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

// Fetch complete transactional audit logs
router.get('/transactions/pending', adminMiddleware, async (req, res) => {
  try {
    const list = await db.all("SELECT t.*, u.username FROM transactions t JOIN users u ON t.user_id = u.telegram_id WHERE t.status = 'pending' ORDER BY t.id DESC");
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed mapping logs.' });
  }
});

// Moderate and delete disruptive real-time message parameters
router.post('/chat/moderate', adminMiddleware, async (req, res) => {
  const { msgId } = req.body;
  try {
    await db.run("UPDATE chat_messages SET is_moderated = 1 WHERE id = ?", [msgId]);
    res.json({ success: true, message: 'Message moderated completely.' });
  } catch (e) {
    res.status(500).json({ error: 'Database execution crash.' });
  }
});

// Update or fine-tune user account balances manually
router.post('/users/adjust-balance', adminMiddleware, async (req, res) => {
  const { targetUserId, amount } = req.body;
  try {
    await db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [parseFloat(amount), targetUserId]);
    res.json({ success: true, message: 'Balance calibrated manually.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed balance update sequence.' });
  }
});

module.exports = router;
