const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'kpi.db');
let db = null;

async function getDb() {
  if (db) return db;
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

setInterval(() => { saveDb(); }, 30000);

async function initializeDatabase() {
  const d = await getDb();

  d.run(`CREATE TABLE IF NOT EXISTS users (
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

  d.run(`CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    district TEXT,
    leader_name TEXT,
    phone TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    org_id INTEGER, org_type TEXT,
    priority TEXT NOT NULL DEFAULT 'orta',
    category TEXT, status TEXT NOT NULL DEFAULT 'yangi',
    deadline TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    files TEXT DEFAULT '[]'
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (task_id, user_id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS task_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    status TEXT NOT NULL, report TEXT, reason TEXT,
    responded_at TEXT DEFAULT (datetime('now'))
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, action TEXT NOT NULL,
    entity TEXT, entity_id INTEGER, comment TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, task_id INTEGER,
    type TEXT, message TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    is_read INTEGER DEFAULT 0
  )`);

  saveDb();
  return d;
}

async function seedDatabase() {
  const d = await getDb();
  const result = d.exec('SELECT COUNT(*) as cnt FROM users');
  const userCount = result[0]?.values[0]?.[0] || 0;
  if (userCount > 0) return;

  console.log('🌱 Seeding database...');
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  // Admin user
  d.run('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)',
    ['admin', hash('admin123'), 'Abdullayev Sardor', 'admin', 'admin@sirdaryo.uz', '@admin_sardor']);

  // Mudir + Ijrochilar
  d.run('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)',
    ['mudir', hash('admin123'), 'Abdullayev Sardor', 'mudir', 'mudir@sirdaryo.uz', '@mudir_sardor']);
  d.run('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)',
    ['xodim1', hash('1234'), 'Karimova Nilufar', 'ijrochi', 'nilufar@sirdaryo.uz', '@nilufar_k']);
  d.run('INSERT INTO users (username, password_hash, full_name, role, email, telegram) VALUES (?,?,?,?,?,?)',
    ['xodim2', hash('1234'), 'Toshmatov Jasur', 'ijrochi', 'jasur@sirdaryo.uz', '@jasur_t']);

  // Organizations with leaders
  const orgs = [
    ['Ijtimoiy himoya milliy agentligi viloyat boshqarmasi', 'boshqarma', 'Guliston', 'Eshmatov Bahodir', '+998901001001'],
    ["O'zbekiston mahallalari uyushmasi viloyat boshqarmasi", 'uyushma', 'Guliston', 'Normatov Ismoil', '+998901001002'],
    ["Viloyat Kasbiy ta'lim boshqarmasi", 'boshqarma', 'Guliston', 'Tursunov Sherzod', '+998901001003'],
    ["Viloyat Maktabgacha va maktab ta'limi boshqarmasi", 'boshqarma', 'Guliston', 'Xasanova Gulnora', '+998901001004'],
    ["Viloyat Sog'liqni saqlash boshqarmasi", 'boshqarma', 'Guliston', 'Rahimov Farxod', '+998901001005'],
    ["Sanitariya-epidemiologik xizmati viloyat boshqarmasi", 'xizmat', 'Guliston', 'Qodirov Anvar', '+998901001006'],
    ['Viloyat Sport boshqarmasi', 'boshqarma', 'Guliston', 'Boboyev Dilshod', '+998901001007'],
    ['Guliston davlat universiteti', 'universitet', 'Guliston', 'Salimov Abdulla', '+998901001008'],
    ['Viloyat yoshlar ishlari boshqarmasi', 'boshqarma', 'Guliston', 'Kamolov Sardor', '+998901001009'],
    ["Respublika Ma'naviyat markazi viloyat bo'limi", 'bolim', 'Guliston', 'Zokirov Nodir', '+998901001010'],
    ['Viloyat Madaniyat boshqarmasi', 'boshqarma', 'Guliston', 'Xolmatova Barno', '+998901001011'],
    ["Viloyat Turizm bo'limi", 'bolim', 'Guliston', 'Usmonov Jahongir', '+998901001012'],
    ['Sirdaryo viloyat tibbiyot kollej', 'kollej', 'Sirdaryo', 'Mirzayev Oybek', '+998901001013'],
    ['1-sonli maktab', 'maktab', 'Guliston', 'Aliyeva Maftuna', '+998901001014'],
    ['5-sonli maktab', 'maktab', 'Sirdaryo', 'Yusupov Bekzod', '+998901001015'],
  ];
  orgs.forEach(o => {
    d.run('INSERT INTO organizations (name, type, district, leader_name, phone) VALUES (?,?,?,?,?)', o);
  });

  // Create tashkilot user for each org
  for (let i = 1; i <= 15; i++) {
    const org = orgs[i - 1];
    const username = 'org' + i;
    const leaderName = org[3];
    d.run('INSERT INTO users (username, password_hash, full_name, role, org_id, email) VALUES (?,?,?,?,?,?)',
      [username, hash('org123'), leaderName, 'tashkilot', i, `${username}@sirdaryo.uz`]);
  }

  // No demo tasks — system starts clean
  saveDb();
  console.log('✅ Database seeded: 1 admin + 1 mudir + 2 ijrochi + 15 tashkilot users, 15 orgs, 0 tasks');
}

function queryAll(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results[0] || null;
}

function runSql(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() as id');
  const changes = db.exec('SELECT changes() as cnt');
  saveDb();
  return { lastInsertRowid: id[0]?.values[0]?.[0] || 0, changes: changes[0]?.values[0]?.[0] || 0 };
}

module.exports = { getDb, initializeDatabase, seedDatabase, queryAll, queryOne, runSql, saveDb };
