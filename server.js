const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./src/db');
const excel = require('./src/excel');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'cinema.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ================= 鉴权中间件 ================= */
function requireAuth(req, res, next) {
  const user = req.session.userId && db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ message: '未登录或登录已过期' });
  req.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '无权限：仅管理员可执行此操作' });
  next();
}

/* ================= 登录 / 登出 ================= */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '请输入用户名和密码' });
  const user = db.findUserByName(username);
  if (!user || !db.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

/* ================= 元数据（枚举、影厅） ================= */
app.get('/api/meta', requireAuth, (req, res) => {
  res.json({
    types: db.EQUIP_TYPES,
    statuses: db.STATUSES,
    halls: db.allHalls(),
    role: req.user.role
  });
});

/* ================= 设备台账 ================= */
function validate(data) {
  const errors = [];
  const type = String(data.type || '').trim();
  const hall = String(data.hall || '').trim();
  const brand = String(data.brand || '').trim();
  const serial = String(data.serial || '').trim();
  const owner = String(data.owner || '').trim();
  const status = String(data.status || '正常').trim();

  if (!db.EQUIP_TYPES.includes(type)) errors.push('设备类型无效');
  if (!hall) errors.push('影厅不能为空');
  if (!brand) errors.push('品牌不能为空');
  if (!serial) errors.push('序列号不能为空');
  if (!owner) errors.push('责任人不能为空');
  if (!db.STATUSES.includes(status)) errors.push(`状态无效（允许：${db.STATUSES.join('、')}）`);
  return { errors, value: { type, hall, brand, serial, owner, status } };
}

app.get('/api/equipment', requireAuth, (req, res) => {
  res.json(db.listEquipment(req.query));
});

app.post('/api/equipment', requireAuth, requireAdmin, (req, res) => {
  const { errors, value } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join('；') });
  if (db.findBySerial(value.serial)) {
    return res.status(409).json({ message: `序列号「${value.serial}」已存在，序列号必须唯一` });
  }
  res.status(201).json(db.insertEquipment(value));
});

app.put('/api/equipment/:id', requireAuth, requireAdmin, (req, res) => {
  const rec = db.getEquipment(req.params.id);
  if (!rec) return res.status(404).json({ message: '设备记录不存在' });
  const { errors, value } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join('；') });
  const dup = db.findBySerial(value.serial, rec.id);
  if (dup) return res.status(409).json({ message: `序列号「${value.serial}」已存在，序列号必须唯一` });
  res.json(db.updateEquipment(rec, value));
});

app.delete('/api/equipment/:id', requireAuth, requireAdmin, (req, res) => {
  if (!db.deleteEquipment(req.params.id)) return res.status(404).json({ message: '设备记录不存在' });
  res.json({ ok: true });
});

/* ================= 导出（登录用户均可，属只读） ================= */
app.get('/api/equipment/export', requireAuth, (req, res) => {
  const rows = db.listEquipment(req.query);
  const buffer = excel.buildExportBuffer(rows);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''%E8%AE%BE%E5%A4%87%E5%8F%B0%E8%B4%A6_${stamp}.xlsx`);
  res.end(buffer);
});

/* ================= Excel 导入（管理员） ================= */
app.get('/api/import/template', requireAuth, requireAdmin, (req, res) => {
  const buffer = excel.buildTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    "attachment; filename*=UTF-8''%E5%BD%B1%E9%99%A2%E6%94%BE%E6%98%A0%E8%AE%BE%E5%A4%87%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
  res.end(buffer);
});

// 失败行临时缓存（30 分钟有效，只存内存）
const failedStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, item] of failedStore) {
    if (now - item.ts > 30 * 60 * 1000) failedStore.delete(token);
  }
}, 5 * 60 * 1000).unref();

app.post('/api/import', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请选择要导入的 Excel 文件' });
  const parsed = excel.parseImportBuffer(req.file.buffer);
  if (parsed.error) return res.status(400).json({ message: parsed.error });

  const okRows = [], failedRows = [];
  const seenSerial = new Set(); // 同一文件内序列号去重

  for (const item of parsed.records) {
    const { errors, value } = validate(item.data);
    const serialKey = value.serial.toLowerCase();
    if (value.serial) {
      if (seenSerial.has(serialKey)) errors.push('文件内序列号重复');
      else if (db.findBySerial(value.serial)) errors.push('序列号在平台中已存在');
    }
    if (errors.length) {
      failedRows.push({ ...item, reason: errors.join('；') });
    } else {
      seenSerial.add(serialKey);
      okRows.push(value);
    }
  }

  // 全部校验通过的行统一入库（任一行已保证不会冲突）
  okRows.forEach(v => db.insertEquipment(v));

  let failedToken = null;
  if (failedRows.length) {
    failedToken = crypto.randomUUID();
    failedStore.set(failedToken, { ts: Date.now(), rows: failedRows });
  }
  res.json({
    total: parsed.records.length,
    inserted: okRows.length,
    failedCount: failedRows.length,
    failedToken,
    failedPreview: failedRows.slice(0, 10)
  });
});

app.get('/api/import/failed/:token', requireAuth, requireAdmin, (req, res) => {
  const item = failedStore.get(req.params.token);
  if (!item) return res.status(404).json({ message: '失败行结果不存在或已过期（保留30分钟），请重新导入' });
  const buffer = excel.buildFailedBuffer(item.rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    "attachment; filename*=UTF-8''%E5%AF%BC%E5%85%A5%E5%A4%B1%E8%B4%A5%E8%A1%8C.xlsx");
  res.end(buffer);
});

/* 前端回退（Express 5 不再支持 '*' 通配路由，改用中间件） */
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '文件过大（上限 10MB）' });
  }
  console.error(err);
  res.status(500).json({ message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`影院放映设备台账系统已启动: http://localhost:${PORT}`);
  console.log('管理员 admin/admin123 ；普通员工 staff/staff123');
});
