/**
 * 影院放映设备台账 - 后端服务
 * 纯 Node.js 内置模块实现（无需 npm install）
 * 启动: node server.js   默认端口 3000，可用 PORT 环境变量修改
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- 常量与工具 ---------------- */

const CATEGORIES = ['放映机', '音响', '银幕', '控制台'];
const STATUSES = ['在用', '闲置', '维修中', '报废'];

const STATUS_CODE = {
  在用: 'in-use',
  闲置: 'idle',
  维修中: 'repair',
  报废: 'scrapped',
};

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function uuid() {
  return crypto.randomUUID();
}

function nowText() {
  // 本地时间 YYYY-MM-DD HH:mm:ss
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

/* ---------------- 数据存储 ---------------- */

const DEFAULT_USERS = [
  { id: 'u-admin', username: 'admin', password: sha256('admin123'), name: '系统管理员', role: 'admin' },
  { id: 'u-staff', username: 'staff', password: sha256('staff123'), name: '普通员工', role: 'staff' },
];

function seedData() {
  const now = nowText();
  const rows = [
    { hall: '1号厅', category: '放映机', brand: 'Barco DP4K-32B', serial: 'BRC-2023-0001', owner: '张伟', status: '在用' },
    { hall: '1号厅', category: '音响',   brand: 'JBL C211',        serial: 'JBL-2023-0108', owner: '张伟', status: '在用' },
    { hall: '2号厅', category: '放映机', brand: 'NEC NC3541LS',    serial: 'NEC-2022-0042', owner: '李娜', status: '维修中' },
    { hall: '2号厅', category: '银幕',   brand: 'Harkness 12m金属幕', serial: 'HRK-2021-0007', owner: '李娜', status: '在用' },
    { hall: '3号厅', category: '控制台', brand: 'Dolby CP950',     serial: 'DLB-2024-0211', owner: '王强', status: '在用' },
    { hall: '3号厅', category: '音响',   brand: 'QSC SC-424C',     serial: 'QSC-2020-0330', owner: '王强', status: '闲置' },
  ].map((r) => ({ id: uuid(), ...r, createdAt: now, updatedAt: now }));

  return {
    secret: crypto.randomBytes(32).toString('hex'),
    users: DEFAULT_USERS,
    equipment: rows,
  };
}

let db;
function loadDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = seedData();
    saveDB();
  } else {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.secret || !Array.isArray(db.users) || !Array.isArray(db.equipment)) throw new Error('bad db');
    } catch (e) {
      console.error('数据库文件损坏，已重建：', e.message);
      db = seedData();
      saveDB();
    }
  }
}

let saveTimer = null;
function saveDB() {
  // 简易防抖落盘
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }, 30);
}

/* ---------------- 认证 ---------------- */

function signToken(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', db.secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    const expect = crypto.createHmac('sha256', db.secret).update(`${userId}.${ts}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    if (Date.now() - Number(ts) > 1000 * 60 * 60 * 12) return null; // 12小时有效期
    return db.users.find((u) => u.id === userId) || null;
  } catch {
    return null;
  }
}

function authUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return verifyToken(token);
}

/* ---------------- 业务校验 ---------------- */

function validateEquipment(input, { idExcept = null } = {}) {
  const errors = [];
  const out = {};

  out.hall = clean(input.hall);
  out.category = clean(input.category);
  out.brand = clean(input.brand);
  out.serial = clean(input.serial);
  out.owner = clean(input.owner);
  out.status = clean(input.status);

  if (!out.hall) errors.push('影厅不能为空');
  else if (out.hall.length > 50) errors.push('影厅长度不能超过50');

  if (!out.category) errors.push('设备类别不能为空');
  else if (!CATEGORIES.includes(out.category)) errors.push(`设备类别必须是：${CATEGORIES.join('、')}`);

  if (!out.brand) errors.push('品牌不能为空');
  else if (out.brand.length > 100) errors.push('品牌长度不能超过100');

  if (!out.serial) errors.push('序列号不能为空');
  else if (out.serial.length > 60) errors.push('序列号长度不能超过60');
  else {
    const dup = db.equipment.find((e) => e.serial === out.serial && e.id !== idExcept);
    if (dup) errors.push(`序列号已存在（与 ${dup.hall} 的${dup.category}重复）`);
  }

  if (!out.owner) errors.push('责任人不能为空');
  else if (out.owner.length > 50) errors.push('责任人长度不能超过50');

  if (!out.status) errors.push('状态不能为空');
  else if (!STATUSES.includes(out.status)) errors.push(`状态必须是：${STATUSES.join('、')}`);

  return { data: out, errors };
}

/* ---------------- CSV 导入 ---------------- */

const CSV_HEADERS = ['影厅', '设备类别', '品牌', '序列号', '责任人', '状态'];

// 支持引号包裹、转义双引号的 CSV 解析，返回二维数组
function parseCSV(text) {
  // 去掉 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    started = true;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; started = false;
    } else if (c === '\r') {
      // 跳过，等待 \n
    } else {
      field += c;
    }
  }
  if (started || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim()));
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* ---------------- HTTP 辅助 ---------------- */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10 * 1024 * 1024) {
        reject(Object.assign(new Error('请求体过大（上限10MB）'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 防目录穿越
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

/* ---------------- 路由处理 ---------------- */

async function handleAPI(req, res, url) {
  const route = url.pathname;
  const method = req.method;

  /* ---- 登录（公开） ---- */
  if (route === '/api/login' && method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const username = clean(body.username);
    const password = clean(body.password);
    const user = db.users.find((u) => u.username === username);
    if (!user || user.password !== sha256(password)) {
      return sendJSON(res, 401, { error: '用户名或密码错误' });
    }
    return sendJSON(res, 200, {
      token: signToken(user.id),
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    });
  }

  /* ---- 以下接口均需登录 ---- */
  const user = authUser(req);
  if (!user) return sendJSON(res, 401, { error: '未登录或登录已过期' });
  const requireAdmin = () => {
    if (user.role !== 'admin') {
      sendJSON(res, 403, { error: '权限不足：仅管理员可执行该操作' });
      return false;
    }
    return true;
  };

  /* ---- 当前用户信息 ---- */
  if (route === '/api/me' && method === 'GET') {
    return sendJSON(res, 200, {
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    });
  }

  /* ---- 元数据（筛选下拉用） ---- */
  if (route === '/api/meta' && method === 'GET') {
    return sendJSON(res, 200, {
      categories: CATEGORIES,
      statuses: STATUSES,
      halls: [...new Set(db.equipment.map((e) => e.hall))].sort(),
    });
  }

  /* ---- 台账分页查询 ---- */
  if (route === '/api/equipment' && method === 'GET') {
    const q = url.searchParams;
    const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.get('pageSize') || '10', 10) || 10));
    const kw = (q.get('keyword') || '').trim().toLowerCase();
    const fHall = (q.get('hall') || '').trim();
    const fCat = (q.get('category') || '').trim();
    const fStatus = (q.get('status') || '').trim();

    let list = db.equipment.filter((e) => {
      if (fHall && e.hall !== fHall) return false;
      if (fCat && e.category !== fCat) return false;
      if (fStatus && e.status !== fStatus) return false;
      if (kw) {
        const hay = `${e.hall} ${e.category} ${e.brand} ${e.serial} ${e.owner} ${e.status}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const total = list.length;
    list = list
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice((page - 1) * pageSize, page * pageSize);

    return sendJSON(res, 200, { items: list, total, page, pageSize });
  }

  /* ---- 新增 ---- */
  if (route === '/api/equipment' && method === 'POST') {
    if (!requireAdmin()) return;
    const body = JSON.parse(await readBody(req) || '{}');
    const { data, errors } = validateEquipment(body);
    if (errors.length) return sendJSON(res, 400, { error: errors.join('；') });
    const ts = nowText();
    const item = { id: uuid(), ...data, createdAt: ts, updatedAt: ts };
    db.equipment.push(item);
    saveDB();
    return sendJSON(res, 201, { item });
  }

  /* ---- 修改 / 删除（排除 import 子路由） ---- */
  const itemMatch = route.match(/^\/api\/equipment\/(?!import$)([^/]+)$/);
  if (itemMatch) {
    const id = itemMatch[1];
    const idx = db.equipment.findIndex((e) => e.id === id);
    if (idx < 0) return sendJSON(res, 404, { error: '设备记录不存在' });

    if (method === 'GET') {
      return sendJSON(res, 200, { item: db.equipment[idx] });
    }
    if (method === 'PUT') {
      if (!requireAdmin()) return;
      const body = JSON.parse(await readBody(req) || '{}');
      const { data, errors } = validateEquipment(body, { idExcept: id });
      if (errors.length) return sendJSON(res, 400, { error: errors.join('；') });
      db.equipment[idx] = { ...db.equipment[idx], ...data, updatedAt: nowText() };
      saveDB();
      return sendJSON(res, 200, { item: db.equipment[idx] });
    }
    if (method === 'DELETE') {
      if (!requireAdmin()) return;
      const [removed] = db.equipment.splice(idx, 1);
      saveDB();
      return sendJSON(res, 200, { item: removed });
    }
  }

  /* ---- 导入模板下载（GET 即可，登录后可用） ---- */
  if (route === '/api/import/template' && method === 'GET') {
    const rows = [
      CSV_HEADERS,
      ['4号厅', '放映机', 'Christie CP4455-RGB', 'CHR-2024-0088', '赵敏', '在用'],
      ['4号厅', '银幕', 'Harkness 10m白幕', 'HRK-2024-0012', '赵敏', '在用'],
      ['5号厅', '控制台', 'Dolby CP850', 'DLB-2019-0065', '陈晨', '维修中'],
    ];
    const csv = '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': "attachment; filename*=UTF-8''%E8%AE%BE%E5%A4%87%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.csv",
    });
    return res.end(csv);
  }

  /* ---- CSV 批量导入（仅管理员） ---- */
  if (route === '/api/equipment/import' && method === 'POST') {
    if (!requireAdmin()) return;
    const body = JSON.parse(await readBody(req) || '{}');
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim()) return sendJSON(res, 400, { error: '导入内容为空' });

    const rows = parseCSV(content);
    if (!rows.length) return sendJSON(res, 400, { error: 'CSV 中没有任何数据行' });

    const header = rows[0].map((h) => h.replace(/\s/g, ''));
    const headerOk = CSV_HEADERS.every((h, i) => header[i] === h);
    if (!headerOk) {
      return sendJSON(res, 400, {
        error: `表头不正确，应为：${CSV_HEADERS.join(',')}（请使用下载的导入模板）`,
      });
    }

    const success = [];
    const failed = [];
    // 本次文件内序列号去重
    const seenInFile = new Set();

    for (let i = 1; i < rows.length; i++) {
      const lineNo = i + 1;
      const cols = rows[i];
      // 跳过整行为空
      if (cols.every((c) => c === '') && cols.length <= CSV_HEADERS.length) continue;

      const input = {
        hall: cols[0],
        category: cols[1],
        brand: cols[2],
        serial: cols[3],
        owner: cols[4],
        status: cols[5],
      };

      // 列数检查
      if (cols.length !== CSV_HEADERS.length) {
        failed.push({
          lineNo,
          row: padCols(cols),
          errors: [`列数不正确（应为${CSV_HEADERS.length}列，实际${cols.length}列）`],
        });
        continue;
      }

      const serial = clean(input.serial);
      if (serial && seenInFile.has(serial)) {
        failed.push({ lineNo, row: cols, errors: ['序列号在本文件中重复'] });
        continue;
      }

      const { data, errors } = validateEquipment(input);
      if (errors.length) {
        failed.push({ lineNo, row: cols, errors });
      } else {
        seenInFile.add(serial);
        const ts = nowText();
        const item = { id: uuid(), ...data, createdAt: ts, updatedAt: ts };
        db.equipment.push(item);
        success.push(item);
      }
    }

    if (success.length) saveDB();

    // 生成失败行 CSV 内容（前端可直接下载）
    let failedCsv = '';
    if (failed.length) {
      const out = [['原行号', ...CSV_HEADERS, '失败原因']];
      for (const f of failed) {
        out.push([f.lineNo, ...f.row, f.errors.join('；')]);
      }
      failedCsv = '﻿' + out.map((r) => r.map(csvEscape).join(',')).join('\r\n');
    }

    return sendJSON(res, 200, {
      total: success.length + failed.length,
      successCount: success.length,
      failedCount: failed.length,
      failedRows: failed.map((f) => ({ lineNo: f.lineNo, row: f.row, errors: f.errors })),
      failedCsv,
    });
  }

  return sendJSON(res, 404, { error: '接口不存在' });
}

function padCols(cols) {
  const r = cols.slice(0, CSV_HEADERS.length);
  while (r.length < CSV_HEADERS.length) r.push('');
  return r;
}

/* ---------------- 启动服务 ---------------- */

loadDB();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleAPI(req, res, url);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      sendJSON(res, 400, { error: '请求体不是有效的 JSON' });
    } else {
      console.error('服务器错误：', err);
      sendJSON(res, err.status || 500, { error: err.message || '服务器内部错误' });
    }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  影院放映设备台账 已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log('  管理员:   admin / admin123');
  console.log('  普通员工: staff / staff123');
  console.log('');
});
