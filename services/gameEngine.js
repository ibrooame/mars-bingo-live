const db = require('../database/db');
const logger = require('../utils/logger');

class BingoGameEngine {
  constructor() {
    this.states = { WAITING: 'waiting', DRAWING: 'drawing', COMPLETED: 'completed' };
    this.currentState = this.states.WAITING;
    this.currentRoundId = null;
    this.drawnNumbers = [];
    this.countdown = 30;
    this.timerInterval = null;
    this.io = null;
  }

  init(io) {
    this.io = io;
    this.startWaitingCycle();
  }

  async startWaitingCycle() {
    this.currentState = this.states.WAITING;
    this.drawnNumbers = [];
    this.countdown = parseInt(process.env.ROUND_COUNTDOWN_SECONDS) || 30;

    try {
      await db.run(`INSERT INTO game_rounds (status, drawn_numbers, prize_pool) VALUES ('waiting', '[]', 0.0)`);
      const lastRound = await db.get("SELECT id FROM game_rounds ORDER BY id DESC LIMIT 1");
      this.currentRoundId = lastRound ? lastRound.id : 1;
      logger.info(`Bingo Round ${this.currentRoundId} initialized in WAITING state.`);
    } catch (err) {
      logger.error('Failed to create authoritative round:', err);
    }

    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.countdown--;
      this.io.emit('game_countdown', { countdown: this.countdown, roundId: this.currentRoundId });

      if (this.countdown <= 0) {
        clearInterval(this.timerInterval);
        this.startDrawingCycle();
      }
    }, 1000);
  }

  async startDrawingCycle() {
    try {
      const tickets = await db.all("SELECT id FROM bingo_cards WHERE round_id = ?", [this.currentRoundId]);
      if (tickets.length === 0) {
        logger.info(`No card tickets purchased for Round ${this.currentRoundId}. Recycler resetting...`);
        this.startWaitingCycle();
        return;
      }

      this.currentState = this.states.DRAWING;
      await db.run("UPDATE game_rounds SET status = 'drawing' WHERE id = ?", [this.currentRoundId]);
      this.io.emit('game_state_change', { state: this.states.DRAWING, roundId: this.currentRoundId });
      this.triggerNextNumberDraw();
    } catch (err) {
      logger.error('Error starting drawing cycle:', err);
      this.startWaitingCycle();
    }
  }

  triggerNextNumberDraw() {
    const intervalTime = parseInt(process.env.NUMBER_DRAW_INTERVAL_MS) || 4000;

    this.timerInterval = setInterval(async () => {
      if (this.drawnNumbers.length >= 75) {
        clearInterval(this.timerInterval);
        this.endGameRound(null);
        return;
      }

      let ball;
      do {
        ball = Math.floor(Math.random() * 75) + 1;
      } while (this.drawnNumbers.includes(ball));

      this.drawnNumbers.push(ball);
      
      try {
        await db.run("UPDATE game_rounds SET drawn_numbers = ? WHERE id = ?", [
          JSON.stringify(this.drawnNumbers),
          this.currentRoundId
        ]);
      } catch (err) {
        logger.error('Failed syncing drawn numbers to DB:', err);
      }

      this.io.emit('number_drawn', { ball, history: this.drawnNumbers });
      await this.verifyActiveTickets();
    }, intervalTime);
  }

  async verifyActiveTickets() {
    try {
      const cards = await db.all("SELECT * FROM bingo_cards WHERE round_id = ?", [this.currentRoundId]);
      for (const card of cards) {
        const matrix = JSON.parse(card.card_data);
        if (this.checkWinningPattern(matrix)) {
          clearInterval(this.timerInterval);
          await this.endGameRound(card.user_id, card.id);
          break;
        }
      }
    } catch (err) {
      logger.error('Error verifying active cards:', err);
    }
  }

  checkWinningPattern(matrix) {
    for (let r = 0; r < 5; r++) {
      if (matrix[r].every(num => num === 0 || this.drawnNumbers.includes(num))) return true;
    }
    for (let c = 0; c < 5; c++) {
      let colWin = true;
      for (let r = 0; r < 5; r++) {
        let num = matrix[r][c];
        if (num !== 0 && !this.drawnNumbers.includes(num)) colWin = false;
      }
      if (colWin) return true;
    }
    return false;
  }

  async endGameRound(winnerUserId, winningCardId) {
    this.currentState = this.states.COMPLETED;
    try {
      let totalPool = 0;
      const tickets = await db.all("SELECT * FROM bingo_cards WHERE round_id = ?", [this.currentRoundId]);
      const ticketPrice = parseFloat(process.env.TICKET_PRICE) || 50;
      const prizePct = parseFloat(process.env.PRIZE_POOL_PERCENTAGE) || 85;

      totalPool = tickets.length * ticketPrice * (prizePct / 100);

      if (winnerUserId) {
        await db.run("UPDATE game_rounds SET status = 'completed', winner_id = ?, prize_pool = ? WHERE id = ?", [winnerUserId, totalPool, this.currentRoundId]);
        await db.run("UPDATE bingo_cards SET is_winner = 1 WHERE id = ?", [winningCardId]);
        await db.run("UPDATE users SET balance = balance + ? WHERE telegram_id = ?", [totalPool, winnerUserId]);
        
        const winnerProfile = await db.get("SELECT username FROM users WHERE telegram_id = ?", [winnerUserId]);
        this.io.emit('game_over', {
          winnerId: winnerUserId,
          winnerUsername: winnerProfile ? winnerProfile.username : 'Unknown Player',
          prize: totalPool,
          roundId: this.currentRoundId
        });
      } else {
        await db.run("UPDATE game_rounds SET status = 'completed', prize_pool = 0 WHERE id = ?", [this.currentRoundId]);
        this.io.emit('game_over', { winnerId: null, prize: 0, roundId: this.currentRoundId });
      }
    } catch (err) {
      logger.error('Critical exception inside game liquidation routine:', err);
    }

    setTimeout(() => this.startWaitingCycle(), 7000);
  }

  generateRandomCard() {
    const card = [];
    const ranges = [
      { min: 1, max: 15 },
      { min: 16, max: 30 },
      { min: 31, max: 45 },
      { min: 46, max: 60 },
      { min: 61, max: 75 }
    ];

    for (let r = 0; r < 5; r++) {
      card.push([]);
    }

    for (let col = 0; col < 5; col++) {
      const pool = [];
      const rData = ranges[col];
      while (pool.length < 5) {
        let n = Math.floor(Math.random() * (rData.max - rData.min + 1)) + rData.min;
        if (!pool.includes(n)) pool.push(n);
      }
      for (let row = 0; row < 5; row++) {
        card[row][col] = (row === 2 && col === 2) ? 0 : pool[row];
      }
    }
    return card;
  }
}

module.exports = new BingoGameEngine();
