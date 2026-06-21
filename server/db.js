const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('./config');

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  db = new Database(path.join(CONFIG_DIR, 'movies.db'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      release_date TEXT,
      poster_path TEXT,
      backdrop_path TEXT,
      overview TEXT,
      director TEXT,
      genres TEXT,
      rating REAL,
      runtime INTEGER,
      media_type TEXT,
      confirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT UNIQUE NOT NULL,
      video_title TEXT,
      playlist_id TEXT,
      movie_id INTEGER REFERENCES movies(id),
      status TEXT DEFAULT 'pending',
      confidence REAL,
      raw_match TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 迁移保障：已有数据库缺少 media_type 列时自动补加，重复执行时静默忽略
  try {
    db.prepare("ALTER TABLE movies ADD COLUMN media_type TEXT").run();
  } catch {
    // column already exists — ignore
  }

  try {
    db.prepare("ALTER TABLE movies ADD COLUMN release_date TEXT").run();
  } catch (e) {
    // column already exists — ignore
  }

  return db;
}

module.exports = { getDb };
