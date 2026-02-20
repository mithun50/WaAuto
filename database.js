const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'waauto.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    reply TEXT NOT NULL,
    match_mode TEXT DEFAULT 'contains',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at DATETIME,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS message_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT,
    direction TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    status TEXT DEFAULT 'sent',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Initialize bot settings defaults
const initSetting = db.prepare('INSERT OR IGNORE INTO bot_settings (key, value) VALUES (?, ?)');
initSetting.run('auto_reply_enabled', '1');
initSetting.run('bulk_delay_ms', '3000');

// Prepared statements
const stmts = {
  // Auto-replies
  getAllRules: db.prepare('SELECT * FROM auto_replies ORDER BY id DESC'),
  getEnabledRules: db.prepare('SELECT * FROM auto_replies WHERE enabled = 1'),
  getRuleById: db.prepare('SELECT * FROM auto_replies WHERE id = ?'),
  insertRule: db.prepare('INSERT INTO auto_replies (keyword, reply, match_mode, enabled) VALUES (?, ?, ?, ?)'),
  updateRule: db.prepare('UPDATE auto_replies SET keyword = ?, reply = ?, match_mode = ?, enabled = ? WHERE id = ?'),
  deleteRule: db.prepare('DELETE FROM auto_replies WHERE id = ?'),
  toggleRule: db.prepare('UPDATE auto_replies SET enabled = ? WHERE id = ?'),

  // Scheduled messages
  getAllScheduled: db.prepare('SELECT * FROM scheduled_messages ORDER BY scheduled_at DESC'),
  getPendingScheduled: db.prepare("SELECT * FROM scheduled_messages WHERE status = 'pending' AND scheduled_at <= datetime('now')"),
  insertScheduled: db.prepare('INSERT INTO scheduled_messages (phone, message, scheduled_at) VALUES (?, ?, ?)'),
  updateScheduledStatus: db.prepare('UPDATE scheduled_messages SET status = ?, sent_at = ?, error = ? WHERE id = ?'),
  deleteScheduled: db.prepare('DELETE FROM scheduled_messages WHERE id = ?'),

  // Message logs
  getLogs: db.prepare('SELECT * FROM message_logs ORDER BY id DESC LIMIT ?'),
  insertLog: db.prepare('INSERT INTO message_logs (phone, message, direction, type, status) VALUES (?, ?, ?, ?, ?)'),
  getLogStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as received,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM message_logs
  `),

  // Settings
  getSetting: db.prepare('SELECT value FROM bot_settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)'),
};

module.exports = { db, stmts };
