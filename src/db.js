const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ---------- 密码哈希(scrypt, Node 内置, 无外部依赖) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const h = crypto.scryptSync(String(pw), salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), h);
  } catch (e) {
    return false;
  }
}

/* ---------- 常量 ---------- */
const EQUIP_TYPES = ['放映机', '音响', '银幕', '控制台'];
const STATUSES = ['正常', '维修中', '备用', '停用'];
const DEFAULT_HALLS = ['1号厅', '2号厅', '3号厅', '4号厅', '5号厅', '6号厅'];

/* ---------- 初始数据 ---------- */
function seedData() {
  return {
    users: [
      { id: crypto.randomUUID(), username: 'admin', name: '系统管理员', role: 'admin',
        passwordHash: hashPassword('admin123') },
      { id: crypto.randomUUID(), username: 'staff', name: '张小明', role: 'staff',
        passwordHash: hashPassword('staff123') }
    ],
    equipment: [
      { id: crypto.randomUUID(), type: '放映机', hall: '1号厅', brand: 'Barco 巴可', serial: 'B4K-2024-001',
        owner: '李工', status: '正常', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '放映机', hall: '2号厅', brand: 'Christie 科视', serial: 'CP4455-2024-008',
        owner: '李工', status: '正常', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '音响', hall: '1号厅', brand: 'Dolby 杜比', serial: 'CP950-A01',
        owner: '王强', status: '正常', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '音响', hall: '3号厅', brand: 'JBL', serial: 'JBL-7151-023',
        owner: '王强', status: '维修中', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '银幕', hall: '1号厅', brand: 'Harkness 哈克尼斯', serial: 'HK-P230-12M',
        owner: '赵雷', status: '正常', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '银幕', hall: '2号厅', brand: 'Severtson 赛文森', serial: 'SV-SILVER-202',
        owner: '赵雷', status: '正常', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '控制台', hall: '1号厅', brand: 'GDC', serial: 'SX4000-C01',
        owner: '李工', status: '备用', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: crypto.randomUUID(), type: '控制台', hall: '3号厅', brand: 'Dolby 杜比', serial: 'DOLBY-IMS2000-7',
        owner: '陈静', status: '停用', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]
  };
}

/* ---------- 加载 / 保存 ---------- */
let db = null;
function load() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      const backup = DB_FILE + '.corrupt.' + Date.now();
      fs.renameSync(DB_FILE, backup);
      db = seedData();
      save();
    }
  } else {
    db = seedData();
    save();
  }
  return db;
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- 用户 ---------- */
function findUserByName(username) {
  return load().users.find(u => u.username === String(username || '').trim());
}
function getUserById(id) {
  return load().users.find(u => u.id === id);
}

/* ---------- 设备 ---------- */
function hallOrder(h) {
  const m = /^(\d+)号厅$/.exec(h || '');
  return m ? parseInt(m[1], 10) : 999;
}
function listEquipment(f = {}) {
  let rows = load().equipment.slice();
  if (f.type) rows = rows.filter(r => r.type === f.type);
  if (f.hall) rows = rows.filter(r => r.hall === f.hall);
  if (f.status) rows = rows.filter(r => r.status === f.status);
  if (f.q) {
    const kw = f.q.trim().toLowerCase();
    rows = rows.filter(r =>
      [r.brand, r.serial, r.owner, r.hall, r.type].some(v =>
        String(v || '').toLowerCase().includes(kw)));
  }
  return rows.sort((a, b) =>
    hallOrder(a.hall) - hallOrder(b.hall) ||
    EQUIP_TYPES.indexOf(a.type) - EQUIP_TYPES.indexOf(b.type) ||
    String(a.serial).localeCompare(String(b.serial)));
}
function getEquipment(id) {
  return load().equipment.find(r => r.id === id) || null;
}
function findBySerial(serial, excludeId) {
  const s = String(serial || '').trim().toLowerCase();
  return load().equipment.find(r =>
    r.id !== excludeId && r.serial.trim().toLowerCase() === s) || null;
}
function allHalls() {
  const set = new Set(DEFAULT_HALLS);
  load().equipment.forEach(r => r.hall && set.add(r.hall));
  return Array.from(set).sort((a, b) => hallOrder(a) - hallOrder(b));
}
function insertEquipment(data) {
  const now = new Date().toISOString();
  const rec = {
    id: crypto.randomUUID(),
    type: data.type.trim(),
    hall: data.hall.trim(),
    brand: data.brand.trim(),
    serial: data.serial.trim(),
    owner: data.owner.trim(),
    status: (data.status || '正常').trim(),
    createdAt: now,
    updatedAt: now
  };
  load().equipment.push(rec);
  save();
  return rec;
}
function updateEquipment(rec, data) {
  Object.assign(rec, {
    type: data.type.trim(),
    hall: data.hall.trim(),
    brand: data.brand.trim(),
    serial: data.serial.trim(),
    owner: data.owner.trim(),
    status: (data.status || '正常').trim(),
    updatedAt: new Date().toISOString()
  });
  save();
  return rec;
}
function deleteEquipment(id) {
  const d = load();
  const i = d.equipment.findIndex(r => r.id === id);
  if (i < 0) return false;
  d.equipment.splice(i, 1);
  save();
  return true;
}

module.exports = {
  EQUIP_TYPES, STATUSES, DEFAULT_HALLS,
  hashPassword, verifyPassword,
  findUserByName, getUserById,
  listEquipment, getEquipment, findBySerial, allHalls,
  insertEquipment, updateEquipment, deleteEquipment
};
