const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../database/db');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, path.join(__dirname, '../uploads/')); },
  filename: (req, file, cb) => { cb(null, `tx-${Date.now()}${path.extname(file.originalname)}`); }
});
const upload = multer({ storage });

router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const user = await db.get('SELECT balance FROM users WHERE telegram_id = ?', [req.user.telegram_id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: 'Internal system fault' });
  }
});

router.post('/deposit', authMiddleware, upload.single('screenshot'), async (req, res) => {
  const { amount, transaction_id } = req.body;
  if (!amount || !transaction_id) return res.status(400).json({ error: 'Missing deposit details' });

  try {
    const parsedAmount = parseFloat(amount);
    if (parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const screenPath = req.file ? `/uploads/${req.file.filename}` : null;

    await db.run(
      `INSERT INTO transactions (user_id, type, amount, status, telebirr_tx_id, screenshot_path, updated_at) 
       VALUES (?, 'deposit', ?, 'pending', ?, ?, strftime('%s', 'now'))`,
      [req.user.telegram_id, parsedAmount, transaction_id, screenPath]
    );
    res.json({ success: true, message: 'Deposit recorded. Awaiting admin verification.' });
  } catch (err) {
    res.status(500).json({ error: 'Duplicate reference or transaction processing failure.' });
  }
});

router.post('/withdraw', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'Withdrawal amount required' });
  const parsedAmount = parseFloat(amount);

  try {
    const user = await db.get('SELECT balance FROM users WHERE telegram_id = ?', [req.user.telegram_id]);
    if (!user || user.balance < parsedAmount) return res.status(400).json({ error: 'Insufficient wallet balance' });

    await db.run('UPDATE users SET balance = balance - ? WHERE telegram_id = ?', [parsedAmount, req.user.telegram_id]);
    await db.run(
      `INSERT INTO transactions (user_id, type, amount, status, updated_at) 
       VALUES (?, 'withdrawal', ?, 'pending', strftime('%s', 'now'))`,
      [req.user.telegram_id, parsedAmount]
    );
    res.json({ success: true, message: 'Withdrawal request submitted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed withdrawal execution loop' });
  }
});

router.get('/history', authMiddleware, async (req, res) => {
  try {
    const history = await db.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC', [req.user.telegram_id]);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Database read failure' });
  }
});

module.exports = router;
