const bcrypt = require('bcryptjs');
const db = require('./db');

const users = [
  { username: 'admin', name: '系统管理员', role: 'admin', password: 'admin123' },
  { username: 'staff', name: '张员工', role: 'staff', password: 'staff123' },
];

const insertUser = db.prepare(
  'INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)'
);
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  for (const u of users) {
    insertUser.run(u.username, bcrypt.hashSync(u.password, 10), u.name, u.role);
  }
  console.log('已创建默认用户:');
  console.log('  管理员 admin / admin123');
  console.log('  普通员工 staff / staff123');
}

const samples = [
  ['1号厅', '放映机', 'Barco 巴可', 'DP2K-20C-X001', '王建国', '在用'],
  ['1号厅', '音响', 'JBL', 'JBL-4722-0008', '王建国', '在用'],
  ['1号厅', '银幕', 'Harkness 哈克尼斯', 'HK-PERF-0145', '王建国', '在用'],
  ['1号厅', '控制台', 'Dolby 杜比', 'DLP-CTRL-9921', '王建国', '维修中'],
  ['2号厅', '放映机', 'NEC', 'NC900C-A312', '李梅', '在用'],
  ['2号厅', '音响', 'QSC', 'QSC-SC424-551', '李梅', '停用'],
  ['2号厅', '银幕', 'Starbright', 'SB-MT200-0077', '李梅', '在用'],
  ['3号厅', '放映机', 'Christie 科视', 'CP2308-RGB88', '赵强', '备用'],
  ['3号厅', '控制台', 'GDC 环球数码', 'GDC-SX2000-22', '赵强', '在用'],
];
const eqCount = db.prepare('SELECT COUNT(*) AS c FROM equipment').get().c;
if (eqCount === 0) {
  const ins = db.prepare(
    'INSERT INTO equipment (hall, category, brand, serial_no, owner, status, remark) VALUES (?,?,?,?,?,?,?)'
  );
  for (const s of samples) ins.run(...s, '');
  console.log(`已导入 ${samples.length} 条示例设备数据`);
}
console.log('种子数据完成');
