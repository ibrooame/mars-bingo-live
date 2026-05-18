const jwt = require('jsonwebtoken');
const db = require('../database/db');
const gameEngine = require('../services/gameEngine');
const logger = require('../utils/logger');

function initSocketServer(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication connection token missing'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Invalid credentials token handshake signature'));
    }
  });

  io.on('connection', async (socket) => {
    logger.info(`User authenticated and piped into network: ${socket.user.telegram_id}`);
    socket.join('bingo_lobby');

    socket.emit('sync_state', {
      state: gameEngine.currentState,
      countdown: gameEngine.countdown,
      drawnNumbers: gameEngine.drawnNumbers,
      roundId: gameEngine.currentRoundId
    });

    socket.on('buy_ticket', async (ack) => {
      const price = parseFloat(process.env.TICKET_PRICE) || 50;
      try {
        const user = await db.get('SELECT balance FROM users WHERE telegram_id = ?', [socket.user.telegram_id]);
        if (!user || user.balance < price) {
          return ack({ success: false, error: 'Insufficient balance reserves.' });
        }

        if (gameEngine.currentState !== gameEngine.states.WAITING) {
          return ack({ success: false, error: 'Round already locked into drawing state.' });
        }

        const alreadyBought = await db.get(
          'SELECT id FROM bingo_cards WHERE round_id = ? AND user_id = ?',
          [gameEngine.currentRoundId, socket.user.telegram_id]
        );
        if (alreadyBought) {
          return ack({ success: false, error: 'Maximum allowance of 1 card already registered.' });
        }

        const cardMatrix = gameEngine.generateRandomCard();
        
        await db.run('UPDATE users SET balance = balance - ? WHERE telegram_id = ?', [price, socket.user.telegram_id]);
        await db.run(
          `INSERT INTO bingo_cards (round_id, user_id, card_data) VALUES (?, ?, ?)`,
          [gameEngine.currentRoundId, socket.user.telegram_id, JSON.stringify(cardMatrix)]
        );

        await db.run(
          `INSERT INTO transactions (user_id, type, amount, status, updated_at) VALUES (?, 'game_buy', ?, 'approved', strftime('%s', 'now'))`,
          [socket.user.telegram_id, price]
        );

        ack({ success: true, card: cardMatrix });
        io.to('bingo_lobby').emit('player_joined', { count: io.sockets.adapter.rooms.get('bingo_lobby').size });
      } catch (err) {
        logger.error('Failed processing ticket purchase event request:', err);
        ack({ success: false, error: 'Transactional processing pipeline exception.' });
      }
    });

    socket.on('send_msg', async (data) => {
      if (!data.message || data.message.trim().length === 0) return;

      try {
        await db.run(
          `INSERT INTO chat_messages (user_id, username, message) VALUES (?, ?, ?)`,
          [socket.user.telegram_id, socket.user.username || 'Anonymous', data.message.trim()]
        );
        io.to('bingo_lobby').emit('msg_broadcast', {
          username: socket.user.username || 'Anonymous',
          message: data.message.trim(),
          userId: socket.user.telegram_id
        });
      } catch (err) {
        logger.error('Chat persistence tracking error:', err);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`User disconnected from session path: ${socket.user.telegram_id}`);
    });
  });
}

module.exports = { initSocketServer };
