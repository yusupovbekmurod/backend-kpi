const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'kpi.db');
let db = null;

function getDb() {
  if (db) return db;
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// No-op for backward compatibility — better-sqlite3 writes to disk automatically
function saveDb() { }

function initializeDatabase() {
  const d = getDb();

  d.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','mudir','ijrochi','tashkilot')),
    org_id INTEGER,
    email TEXT,
    telegram TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    district TEXT,
    leader_name TEXT,
    phone TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    org_id INTEGER, org_type TEXT,
    priority TEXT NOT NULL DEFAULT 'orta',
    category TEXT, status TEXT NOT NULL DEFAULT 'yangi',
    deadline TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    files TEXT DEFAULT '[]',
    doc_type TEXT
  )`);
  try { d.exec("ALTER TABLE tasks ADD COLUMN doc_type TEXT"); } catch (e) { }

  d.exec(`CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, user_id)
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS task_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    status TEXT NOT NULL, report TEXT, reason TEXT,
    responded_at TEXT DEFAULT (datetime('now'))
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, action TEXT NOT NULL,
    entity TEXT, entity_id INTEGER, comment TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, task_id INTEGER,
    type TEXT, message TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    is_read INTEGER DEFAULT 0
  )`);

  d.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // Create indexes for performance
  try {
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON tasks(org_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_task_responses_task ON task_responses(task_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id)');
    d.exec('CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)');
  } catch (e) { /* indexes may already exist */ }

  // Default settings if not exist
  const insertSetting = d.prepare('INSERT OR IGNORE INTO settings (key, value, description) VALUES (?,?,?)');
  const settings = [
    ['telegram_token', '', 'Telegram Bot Token'],
    ['telegram_chat_id', '', 'Admin Telegram Chat ID'],
    ['system_name', 'Sirdaryo KPI Nazorat Tizimi', 'Tizim nomi'],
    ['allow_registration', '0', 'Ro\'yxatdan o\'tishga ruxsat']
  ];
  const insertSettingsTx = d.transaction(() => {
    settings.forEach(s => insertSetting.run(...s));
  });
  insertSettingsTx();

  return d;
}

function seedDatabase() {
  const d = getDb();
  const result = d.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (result.cnt > 0) return;

  console.log('🌱 Seeding database...');
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const seedTx = d.transaction(() => {
    // Admin user
    d.prepare('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)')
      .run('admin', hash('admin123'), 'Administrator', 'admin', 'admin@sirdaryo.uz', '@admin');

    // Mudir
    d.prepare('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)')
      .run('mudir', hash('admin123'), 'Abdullayev Sardor', 'mudir', 'mudir@sirdaryo.uz', '@mudir_sardor');

    // Organizations and their users
    const orgsData = [
      { n: "Ijtimoiy himoya milliy agentligi", r: "ijtimoiy_r", x1: "ijtimoiy_x1", x2: "ijtimoiy_x2", p: "ijtimoiy2026", type: "boshqarma" },
      { n: "Mahallalari uyushmasi", r: "mahalla_r", x1: "mahalla_x1", x2: "mahalla_x2", p: "mahalla2026", type: "uyushma" },
      { n: "Kasbiy ta'lim boshqarmasi", r: "kasbiy_r", x1: "kasbiy_x1", x2: "kasbiy_x2", p: "kasbiy2026", type: "boshqarma" },
      { n: "Maktabgacha va maktab ta'limi", r: "maktab_r", x1: "maktab_x1", x2: "maktab_x2", p: "maktab2026", type: "boshqarma" },
      { n: "Pedagogik mahorat markazi", r: "pedagog_r", x1: "pedagog_x1", x2: "pedagog_x2", p: "pedagog2026", type: "xizmat" },
      { n: "Sog'liqni saqlash boshqarmasi", r: "sogliq_r", x1: "sogliq_x1", x2: "sogliq_x2", p: "sogliq2026", type: "boshqarma" },
      { n: "Sanitariya-epidemiologik xizmat", r: "sanepid_r", x1: "sanepid_x1", x2: "sanepid_x2", p: "sanepid2026", type: "xizmat" },
      { n: "Sport boshqarmasi", r: "sport_r", x1: "sport_x1", x2: "sport_x2", p: "sport2026", type: "boshqarma" },
      { n: "Guliston davlat universiteti", r: "guldu_r", x1: "guldu_x1", x2: "guldu_x2", p: "guldu2026", type: "universitet" },
      { n: "TKTI Yangiyer filiali", r: "tkti_r", x1: "tkti_x1", x2: "tkti_x2", p: "tkti2026", type: "kollej" },
      { n: "Yoshlar ishlari boshqarmasi", r: "yoshlar_r", x1: "yoshlar_x1", x2: "yoshlar_x2", p: "yoshlar2026", type: "boshqarma" },
      { n: "Yoshlar ittifoqi Kengashi", r: "yittifoq_r", x1: "yittifoq_x1", x2: "yittifoq_x2", p: "yittifoq2026", type: "uyushma" },
      { n: "Ma'naviyat va ma'rifat markazi", r: "manaviyat_r", x1: "manaviyat_x1", x2: "manaviyat_x2", p: "manaviyat2026", type: "markaz" },
      { n: "Tasviriy oyna ijodiy uyushmasi", r: "tasviriy_r", x1: "tasviriy_x1", x2: "tasviriy_x2", p: "tasviriy2026", type: "uyushma" },
      { n: "Yozuvchilar uyushmasi", r: "yozuvchi_r", x1: "yozuvchi_x1", x2: "yozuvchi_x2", p: "yozuvchi2026", type: "uyushma" }
    ];

    const insertOrg = d.prepare('INSERT INTO organizations (name, type, district, leader_name, phone) VALUES (?,?,?,?,?)');
    const insertUser = d.prepare('INSERT INTO users (username, password_hash, full_name, role, org_id) VALUES (?,?,?,?,?)');

    orgsData.forEach((o, idx) => {
      const orgId = idx + 1;
      insertOrg.run(o.n, o.type, 'Sirdaryo', o.n + ' Rahbari', '+99890100' + (1000 + orgId));
      insertUser.run(o.r, hash(o.p), o.n + ' Rahbari', 'tashkilot', orgId);
      insertUser.run(o.x1, hash(o.p), o.n + " mas'ul xodimi (1)", 'tashkilot', orgId);
      insertUser.run(o.x2, hash(o.p), o.n + " mas'ul xodimi (2)", 'tashkilot', orgId);
    });

    console.log('✅ Database seeded: 1 admin + 1 mudir + ' + orgsData.length + ' orgs, ' + (orgsData.length * 3) + ' org users');
  });

  seedTx();
}

function queryAll(sql, params = []) {
  const d = getDb();
  return d.prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  const d = getDb();
  return d.prepare(sql).get(...params) || null;
}

function runSql(sql, params = []) {
  const d = getDb();
  const result = d.prepare(sql).run(...params);
  return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initializeDatabase, seedDatabase, queryAll, queryOne, runSql, saveDb, closeDb };
