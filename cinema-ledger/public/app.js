/* ============ 全局状态 ============ */
const state = {
  token: localStorage.getItem('token') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  meta: { categories: [], statuses: [] },
  selectedFile: null,
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* ============ 工具 ============ */
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  setTimeout(() => t.classList.add('hidden'), 2600);
  t.classList.remove('hidden');
}

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + url, { ...opts, headers });
  if (res.status === 401) { logout(false); throw new Error((await res.json().catch(() => ({}))).message || '请重新登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function download(url) {
  fetch('/api' + url, { headers: { Authorization: 'Bearer ' + state.token } })
    .then(async res => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || '下载失败');
      const disposition = res.headers.get('Content-Disposition') || '';
      const m = disposition.match(/filename\*=UTF-8''(.+)$/);
      const filename = m ? decodeURIComponent(m[1]) : 'download.xlsx';
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(e => toast(e.message, 'error'));
}

/* ============ 登录 / 退出 ============ */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const data = await api('/login', { method: 'POST', body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value } });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    enterApp();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
  }
});

function logout(notify = true) {
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  $('#appPage').classList.add('hidden');
  $('#loginPage').classList.remove('hidden');
  $('#loginPass').value = '';
  if (notify) toast('已退出登录');
}
$('#logoutBtn').addEventListener('click', () => logout());

/* ============ 进入主界面 ============ */
async function enterApp() {
  $('#loginPage').classList.add('hidden');
  $('#appPage').classList.remove('hidden');
  const roleLabel = state.user.role === 'admin' ? '管理员' : '普通员工';
  $('#userInfo').innerHTML = `${esc(state.user.name)} <span class="role-badge ${state.user.role === 'admin' ? 'role-admin' : 'role-staff'}">${roleLabel}</span>`;
  if (state.user.role === 'admin') {
    $$('.admin-col').forEach(el => el.classList.remove('hidden'));
    $('#adminActions').classList.remove('hidden');
  } else {
    $$('.admin-col').forEach(el => el.classList.add('hidden'));
    $('#adminActions').classList.add('hidden');
  }
  state.meta = await api('/meta');
  fillSelects();
  await loadHalls();
  await loadEquipment();
}

function fillSelects() {
  const opts = (list, allText) => `<option value="">${allText}</option>` + list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  $('#fCategory').innerHTML = opts(state.meta.categories, '全部类型');
  $('#fStatus').innerHTML = opts(state.meta.statuses, '全部状态');
  $('#efCategory').innerHTML = state.meta.categories.map(v => `<option>${esc(v)}</option>`).join('');
  $('#efStatus').innerHTML = state.meta.statuses.map(v => `<option>${esc(v)}</option>`).join('');
}

async function loadHalls() {
  const halls = await api('/halls');
  $('#fHall').innerHTML = '<option value="">全部影厅</option>' + halls.map(h => `<option>${esc(h)}</option>`).join('');
}

/* ============ 列表 ============ */
const CAT_ICONS = { '放映机': '📽️', '音响': '🔊', '银幕': '🎞️', '控制台': '🎛️' };

async function loadEquipment() {
  const params = new URLSearchParams();
  const hall = $('#fHall').value, cat = $('#fCategory').value, st = $('#fStatus').value, kw = $('#fKeyword').value.trim();
  if (hall) params.set('hall', hall);
  if (cat) params.set('category', cat);
  if (st) params.set('status', st);
  if (kw) params.set('keyword', kw);
  const data = await api('/equipment?' + params.toString());
  $('#totalCount').textContent = data.total;
  const isAdmin = state.user.role === 'admin';
  $('#eqTbody').innerHTML = data.list.map(r => `
    <tr>
      <td>${esc(r.hall)}</td>
      <td><span class="cat-icon">${CAT_ICONS[r.category] || '🔧'}</span>${esc(r.category)}</td>
      <td>${esc(r.brand)}</td>
      <td>${esc(r.serial_no)}</td>
      <td>${esc(r.owner)}</td>
      <td><span class="status-tag st-${esc(r.status)}">${esc(r.status)}</span></td>
      <td class="remark-cell">${esc(r.remark)}</td>
      <td>${esc(r.updated_at)}</td>
      <td class="admin-col" ${isAdmin ? '' : 'hidden'}>
        <button class="btn btn-sm" onclick="openEdit(${r.id})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delEq(${r.id}, '${esc(r.serial_no)}')">删除</button>
      </td>
    </tr>`).join('');
  $('#emptyTip').classList.toggle('hidden', data.list.length > 0);
}

$('#searchBtn').addEventListener('click', loadEquipment);
$('#resetBtn').addEventListener('click', () => {
  $('#fHall').value = ''; $('#fCategory').value = ''; $('#fStatus').value = ''; $('#fKeyword').value = '';
  loadEquipment();
});
$('#fKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') loadEquipment(); });

/* ============ 新增 / 编辑 ============ */
window.openEdit = async function (id) {
  $('#editTitle').textContent = id ? '编辑设备' : '新增设备';
  $('#efId').value = id || '';
  if (id) {
    const { list } = await api('/equipment');
    const r = list.find(x => x.id === id);
    if (!r) return;
    $('#efHall').value = r.hall; $('#efCategory').value = r.category; $('#efBrand').value = r.brand;
    $('#efSerial').value = r.serial_no; $('#efOwner').value = r.owner; $('#efStatus').value = r.status;
    $('#efRemark').value = r.remark || '';
  } else {
    $('#editForm').reset();
  }
  $('#editModal').classList.remove('hidden');
};

$('#addBtn').addEventListener('click', () => openEdit(null));

$('#saveBtn').addEventListener('click', async () => {
  const body = {
    hall: $('#efHall').value.trim(), category: $('#efCategory').value, brand: $('#efBrand').value.trim(),
    serial_no: $('#efSerial').value.trim(), owner: $('#efOwner').value.trim(), status: $('#efStatus').value,
    remark: $('#efRemark').value.trim(),
  };
  const id = $('#efId').value;
  try {
    if (id) await api('/equipment/' + id, { method: 'PUT', body });
    else await api('/equipment', { method: 'POST', body });
    toast(id ? '修改已保存' : '设备已新增', 'success');
    $('#editModal').classList.add('hidden');
    await loadHalls();
    await loadEquipment();
  } catch (e) { toast(e.message, 'error'); }
});

window.delEq = async function (id, serial) {
  if (!confirm(`确认删除设备「${serial}」吗？此操作不可恢复。`)) return;
  try {
    await api('/equipment/' + id, { method: 'DELETE' });
    toast('已删除', 'success');
    await loadHalls();
    await loadEquipment();
  } catch (e) { toast(e.message, 'error'); }
};

/* ============ 模板 & 导入 ============ */
$('#tplBtn').addEventListener('click', () => download('/import/template'));
$('#tplLink').addEventListener('click', e => { e.preventDefault(); download('/import/template'); });
$('#importBtn').addEventListener('click', () => {
  resetImportUI();
  $('#importModal').classList.remove('hidden');
});

function resetImportUI() {
  state.selectedFile = null;
  $('#importFile').value = '';
  $('#uploadHint').textContent = '📄 点击选择 Excel 文件（.xlsx，≤10MB）';
  $('#doImportBtn').disabled = true;
  const r = $('#importResult');
  r.className = 'import-result hidden';
  r.innerHTML = '';
}

$('#importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (!/\.xlsx?$/i.test(f.name)) { toast('请选择 .xlsx 格式文件', 'error'); return; }
  if (f.size > 10 * 1024 * 1024) { toast('文件不能超过 10MB', 'error'); return; }
  state.selectedFile = f;
  $('#uploadHint').textContent = '已选择：' + f.name + '（' + (f.size / 1024).toFixed(1) + ' KB）';
  $('#doImportBtn').disabled = false;
});

$('#doImportBtn').addEventListener('click', async () => {
  if (!state.selectedFile) return;
  const fd = new FormData();
  fd.append('file', state.selectedFile);
  const btn = $('#doImportBtn');
  btn.disabled = true; btn.textContent = '导入中...';
  try {
    const r = await api('/import', { method: 'POST', body: fd });
    renderImportResult(r);
    await loadHalls();
    await loadEquipment();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '开始导入';
  }
});

function renderImportResult(r) {
  const box = $('#importResult');
  box.classList.remove('hidden');
  let level = 'ok';
  if (r.failedCount > 0 && r.successCount > 0) level = 'partial';
  if (r.failedCount > 0 && r.successCount === 0) level = 'fail';
  box.className = 'import-result ' + level;
  let html = `<div>✔ 成功导入 <b>${r.successCount}</b> 条；✘ 失败 <b>${r.failedCount}</b> 条（共解析 ${r.total} 条有效行）</div>`;
  if (r.failedCount > 0) {
    html += `<div style="margin:8px 0"><button class="btn btn-sm btn-danger" onclick="download('/import/${r.batchId}/errors')">⬇ 下载失败行（含失败原因）</button></div>`;
    html += '<div class="fail-table"><table><thead><tr><th>行号</th><th>影厅</th><th>类型</th><th>序列号</th><th>失败原因</th></tr></thead><tbody>';
    html += r.failed.slice(0, 50).map(f =>
      `<tr><td>${f.row}</td><td>${esc(f.hall)}</td><td>${esc(f.category)}</td><td>${esc(f.serial_no)}</td><td>${esc(f.reason)}</td></tr>`
    ).join('');
    html += '</tbody></table></div>';
    if (r.failed.length > 50) html += `<div style="margin-top:6px;color:#8a93a3">仅预览前 50 条，完整列表请下载文件</div>`;
  }
  box.innerHTML = html;
}

/* ============ 弹窗通用关闭 ============ */
$$('[data-close]').forEach(btn => btn.addEventListener('click', () => {
  $('#' + btn.dataset.close).classList.add('hidden');
}));
$$('.modal-mask').forEach(mask => mask.addEventListener('click', e => {
  if (e.target === mask) mask.classList.add('hidden');
}));

/* ============ 启动 ============ */
(async function init() {
  if (state.token && state.user) {
    try { await api('/me'); enterApp(); } catch { logout(false); }
  } else {
    $('#loginPage').classList.remove('hidden');
  }
})();
