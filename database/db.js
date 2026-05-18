const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, 'mars_bingo.sqlite');
let dbInstance = null;
let SQL_ENGINE = null;

async function getDB() {
  if (dbInstance) return dbInstance;
  if (!SQL_ENGINE) SQL_ENGINE = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    dbInstance = new SQL_ENGINE.Database(fileBuffer);
  } else {
    dbInstance = new SQL_ENGINE.Database();
  }
  return dbInstance;
}

function persistChanges(db) {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

const dbEngine = {
  get: async (sql, params = []) => {
    const db = await getDB();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  },
  all: async (sql, params = []) => {
    const db = await getDB();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },
  run: async (sql, params = []) => {
    const db = await getDB();
    db.run(sql, params);
    persistChanges(db);
    return { changes: 1 };
  },
  exec: async (sql) => {
    const db = await getDB();
    db.run(sql);
    persistChanges(db);
  }
};

module.exports = dbEngine;
