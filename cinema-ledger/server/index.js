const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
// 不在源码中硬编码密钥：优先读取环境变量，未设置时生成随机密钥（重启后旧 token 失效）
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  未设置 JWT_SECRET 环境变量，已使用随机生成的密钥，服务重启后所有登录状态将失效。');
  console.warn('⚠️  生产环境请务必通过环境变量设置固定密钥，例如：JWT_SECRET=<随机长字符串> npm start');
}
const TOKEN_EXPIRES = '8h';

const CATEGORIES = ['放映机', '音响', '银幕', '控制台'];
const STATUSES = ['在用', '维修中', '停用', '备用'];
const COLUMNS = ['影厅', '设备类型', '品牌', '序列号', '责任人', '状态', '备注'];

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------------- 鉴权中间件 ---------------- */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: '未登录或登录已过期' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: '登录令牌无效，请重新登录' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '权限不足：仅管理员可操作' });
  next();
}

/* ---------------- 登录 ---------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '请输入账号和密码' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: '账号或密码错误' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------------- 字典 ---------------- */
app.get('/api/meta', (req, res) => res.json({ categories: CATEGORIES, statuses: STATUSES, columns: COLUMNS }));

/* ---------------- 设备 CRUD ---------------- */
function buildFilter(q) {
  const where = [];
  const params = {};
  if (q.hall) { where.push('hall = @hall'); params.hall = q.hall; }
  if (q.category) { where.push('category = @category'); params.category = q.category; }
  if (q.status) { where.push('status = @status'); params.status = q.status; }
  if (q.keyword) {
    where.push('(brand LIKE @kw OR serial_no LIKE @kw OR owner LIKE @kw OR hall LIKE @kw)');
    params.kw = `%${q.keyword.trim()}%`;
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

app.get('/api/equipment', auth, (req, res) => {
  const { clause, params } = buildFilter(req.query);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM equipment ${clause}`).get(params).c;
  const rows = db.prepare(
    `SELECT id, hall, category, brand, serial_no, owner, status, remark, created_at, updated_at
     FROM equipment ${clause} ORDER BY hall, category, id`
  ).all(params);
  res.json({ total, list: rows });
});

app.get('/api/halls', auth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT hall FROM equipment ORDER BY hall').all();
  res.json(rows.map(r => r.hall));
});

function validatePayload(body) {
  const errs = [];
  const d = {
    hall: (body.hall || '').trim(),
    category: (body.category || '').trim(),
    brand: (body.brand || '').trim(),
    serial_no: (body.serial_no || '').trim(),
    owner: (body.owner || '').trim(),
    status: (body.status || '').trim(),
    remark: (body.remark || '').trim(),
  };
  if (!d.hall) errs.push('影厅不能为空');
  if (!CATEGORIES.includes(d.category)) errs.push('设备类型必须为：' + CATEGORIES.join('、'));
  if (!d.brand) errs.push('品牌不能为空');
  if (!d.serial_no) errs.push('序列号不能为空');
  if (!d.owner) errs.push('责任人不能为空');
  if (!STATUSES.includes(d.status)) errs.push('状态必须为：' + STATUSES.join('、'));
  return { d, errs };
}

app.post('/api/equipment', auth, adminOnly, (req, res) => {
  const { d, errs } = validatePayload(req.body || {});
  if (errs.length) return res.status(400).json({ message: errs.join('；') });
  if (db.prepare('SELECT id FROM equipment WHERE serial_no = ?').get(d.serial_no)) {
    return res.status(409).json({ message: `序列号「${d.serial_no}」已存在` });
  }
  const info = db.prepare(
    'INSERT INTO equipment (hall, category, brand, serial_no, owner, status, remark) VALUES (?,?,?,?,?,?,?)'
  ).run(d.hall, d.category, d.brand, d.serial_no, d.owner, d.status, d.remark);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/equipment/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM equipment WHERE id = ?').get(id)) return res.status(404).json({ message: '设备不存在' });
  const { d, errs } = validatePayload(req.body || {});
  if (errs.length) return res.status(400).json({ message: errs.join('；') });
  if (db.prepare('SELECT id FROM equipment WHERE serial_no = ? AND id != ?').get(d.serial_no, id)) {
    return res.status(409).json({ message: `序列号「${d.serial_no}」已存在` });
  }
  db.prepare(
    `UPDATE equipment SET hall=?, category=?, brand=?, serial_no=?, owner=?, status=?, remark=?,
     updated_at=datetime('now','localtime') WHERE id=?`
  ).run(d.hall, d.category, d.brand, d.serial_no, d.owner, d.status, d.remark, id);
  res.json({ ok: true });
});

app.delete('/api/equipment/:id', auth, adminOnly, (req, res) => {
  const info = db.prepare('DELETE FROM equipment WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ message: '设备不存在' });
  res.json({ ok: true });
});

/* ---------------- 导入模板 ---------------- */
function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buf);
}

app.get('/api/import/template', auth, (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    COLUMNS,
    ['1号厅', '放映机', 'Barco 巴可', 'DP2K-20C-EXAMPLE', '王建国', '在用', '示例行，导入前请删除'],
  ]);
  ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '设备台账');
  sendWorkbook(res, wb, '影院设备导入模板.xlsx');
});

/* ---------------- Excel 批量导入（管理员） ----------------
   失败批次暂存内存，供失败行下载 */
const failedBatches = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failedBatches) if (now - v.ts > 3600_000) failedBatches.delete(k);
}, 600_000).unref();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/import', auth, adminOnly, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传 Excel 文件（.xlsx）' });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  } catch {
    return res.status(400).json({ message: '文件解析失败，请确认是有效的 .xlsx 文件' });
  }
  if (!rows.length) return res.status(400).json({ message: '文件内容为空' });

  const header = rows[0].map(h => String(h).trim());
  const missing = COLUMNS.filter(c => !header.includes(c));
  if (missing.length) {
    return res.status(400).json({ message: `表头缺少列：${missing.join('、')}，请下载最新模板` });
  }
  const idx = COLUMNS.map(c => header.indexOf(c));

  const failed = [];
  let successCount = 0;
  const seen = new Set();
  const insert = db.prepare(
    'INSERT INTO equipment (hall, category, brand, serial_no, owner, status, remark) VALUES (?,?,?,?,?,?,?)'
  );
  const exists = db.prepare('SELECT id FROM equipment WHERE serial_no = ?');

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const vals = idx.map(j => String(r[j] ?? '').trim());
    if (vals.every(v => v === '')) continue; // 跳过空行
    const [hall, category, brand, serial_no, owner, status, remark] = vals;
    const reasons = [];
    if (!hall) reasons.push('影厅不能为空');
    if (!CATEGORIES.includes(category)) reasons.push(`设备类型「${category}」无效`);
    if (!brand) reasons.push('品牌不能为空');
    if (!serial_no) reasons.push('序列号不能为空');
    if (!owner) reasons.push('责任人不能为空');
    if (!STATUSES.includes(status)) reasons.push(`状态「${status}」无效`);
    if (serial_no && seen.has(serial_no)) reasons.push(`序列号「${serial_no}」在文件中重复`);
    if (serial_no && !seen.has(serial_no) && exists.get(serial_no)) reasons.push(`序列号「${serial_no}」已存在于台账`);

    if (reasons.length) {
      failed.push({ row: i + 1, hall, category, brand, serial_no, owner, status, remark, reason: reasons.join('；') });
      continue;
    }
    try {
      insert.run(hall, category, brand, serial_no, owner, status, remark);
      seen.add(serial_no);
      successCount++;
    } catch (e) {
      failed.push({ row: i + 1, hall, category, brand, serial_no, owner, status, remark, reason: '写入失败：' + e.message });
    }
  }

  let batchId = null;
  if (failed.length) {
    batchId = crypto.randomBytes(8).toString('hex');
    failedBatches.set(batchId, { ts: Date.now(), rows: failed });
  }
  res.json({ total: successCount + failed.length, successCount, failedCount: failed.length, batchId, failed });
});

app.get('/api/import/:batchId/errors', auth, adminOnly, (req, res) => {
  const batch = failedBatches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ message: '失败记录不存在或已过期（仅保留1小时），请重新导入' });
  const data = [['Excel行号', ...COLUMNS, '失败原因']];
  for (const f of batch.rows) {
    data.push([f.row, f.hall, f.category, f.brand, f.serial_no, f.owner, f.status, f.remark, f.reason]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '失败行');
  sendWorkbook(res, wb, `导入失败行_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: '服务器内部错误' });
});

app.listen(PORT, () => console.log(`影院设备台账系统已启动: http://localhost:${PORT}`));
