const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, 'mars_bingo.sqlite');

async function init() {
  const SQL = await initSqlJs();
  let db;

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing SQLite database configuration file.');
  } else {
    db = new SQL.Database();
    console.log('Created a fresh pure-JS database instance inside cloud memory.');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      balance REAL DEFAULT 0.0,
      level INTEGER DEFAULT 1,
      streak INTEGER DEFAULT 0,
      last_bonus_claim INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT DEFAULT 'waiting',
      drawn_numbers TEXT DEFAULT '[]',
      winner_id INTEGER,
      prize_pool REAL DEFAULT 0.0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bingo_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER,
      user_id INTEGER,
      card_data TEXT NOT NULL,
      is_winner INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      telebirr_tx_id TEXT UNIQUE,
      screenshot_path TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      message TEXT NOT NULL,
      is_moderated INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);

  console.log('✅ Database schemas and structures initialized completely.');
  return true;
}

// Auto-run if executed directly via command line loops
if (require.main === module) {
  init().catch(console.error);
}

module.exports = init;
