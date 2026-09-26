/* ========== 全局状态 ========== */
const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  meta: { categories: [], statuses: [], halls: [] },
  page: 1,
  pageSize: 10,
  total: 0,
  filters: { keyword: '', hall: '', category: '', status: '' },
  pendingDeleteId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ========== API 封装 ========== */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    options.body = JSON.stringify(options.json);
    delete options.json;
  }
  const resp = await fetch(path, { ...options, headers });
  let data = null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await resp.json();
  if (!resp.ok) {
    if (resp.status === 401 && state.user) {
      doLogout('登录已过期，请重新登录');
      throw new Error('未登录');
    }
    throw new Error((data && data.error) || `请求失败（${resp.status}）`);
  }
  return { data, resp };
}

/* ========== Toast ========== */
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('#toastBox').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ========== HTML 转义 ========== */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ========== 登录 / 登出 ========== */
function showView(name) {
  $('#loginView').classList.toggle('hidden', name !== 'login');
  $('#mainView').classList.toggle('hidden', name !== 'main');
}

async function doLogin(username, password) {
  const btn = $('#loginBtn');
  btn.disabled = true;
  try {
    const { data } = await api('/api/login', {
      method: 'POST',
      json: { username, password },
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    enterApp();
  } catch (e) {
    $('#loginError').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function doLogout(msg) {
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  showView('login');
  if (msg) toast(msg, 'info');
}

async function enterApp() {
  $('#loginError').textContent = '';
  await Promise.all([loadMeta(), loadList()]);
  applyRoleUI();
  renderUserInfo();
  showView('main');
}

function applyRoleUI() {
  const isAdmin = state.user.role === 'admin';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
}

function renderUserInfo() {
  const u = state.user;
  const badge = $('#userBadge');
  badge.textContent = u.role === 'admin' ? '管理员' : '普通员工（只读）';
  badge.className = 'user-badge ' + (u.role === 'admin' ? 'role-admin' : 'role-staff');
  $('#userName').textContent = `${u.name}（${u.username}）`;
}

/* ========== 元数据 / 列表 ========== */
async function loadMeta() {
  const { data } = await api('/api/meta');
  state.meta = data;
  const f = state.filters;

  $('#fCategory').innerHTML = '<option value="">全部类别</option>' +
    data.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#fStatus').innerHTML = '<option value="">全部状态</option>' +
    data.statuses.map((s) => `<option>${esc(s)}</option>`).join('');
  renderHallOptions();

  // 恢复筛选选中状态（选项不存在时回退为“全部”）
  f.category = data.categories.includes(f.category) ? f.category : '';
  f.status = data.statuses.includes(f.status) ? f.status : '';
  f.hall = data.halls.includes(f.hall) ? f.hall : '';
  $('#fCategory').value = f.category;
  $('#fStatus').value = f.status;
  $('#fHall').value = f.hall;

  $('#eCategory').innerHTML = data.categories.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#eStatus').innerHTML = data.statuses.map((s) => `<option>${esc(s)}</option>`).join('');
}

function renderHallOptions() {
  $('#fHall').innerHTML = '<option value="">全部影厅</option>' +
    state.meta.halls.map((h) => `<option>${esc(h)}</option>`).join('');
}

function listQuery() {
  const f = state.filters;
  const p = new URLSearchParams({
    page: state.page,
    pageSize: state.pageSize,
  });
  if (f.keyword) p.set('keyword', f.keyword);
  if (f.hall) p.set('hall', f.hall);
  if (f.category) p.set('category', f.category);
  if (f.status) p.set('status', f.status);
  return '/api/equipment?' + p.toString();
}

async function loadList() {
  const { data } = await api(listQuery());
  state.total = data.total;
  renderTable(data.items);
  renderPager();
}

function statusBadge(s) {
  const map = { 在用: 'in-use', 闲置: 'idle', 维修中: 'repair', 报废: 'scrapped' };
  return `<span class="badge badge-${map[s] || 'idle'}">${esc(s)}</span>`;
}

function renderTable(items) {
  const tbody = $('#tbody');
  const isAdmin = state.user && state.user.role === 'admin';
  if (!items.length) {
    tbody.innerHTML = '';
    $('#emptyTip').classList.remove('hidden');
  } else {
    $('#emptyTip').classList.add('hidden');
    tbody.innerHTML = items.map((it, i) => {
      const no = (state.page - 1) * state.pageSize + i + 1;
      return `<tr>
        <td class="idx">${no}</td>
        <td>${esc(it.hall)}</td>
        <td><span class="cat-tag">${esc(it.category)}</span></td>
        <td>${esc(it.brand)}</td>
        <td class="mono">${esc(it.serial)}</td>
        <td>${esc(it.owner)}</td>
        <td>${statusBadge(it.status)}</td>
        <td class="muted-text">${esc(it.updatedAt)}</td>
        ${isAdmin ? `<td class="admin-only">
          <div class="row-actions">
            <button class="link-btn link-edit" data-edit="${it.id}">编辑</button>
            <button class="link-btn link-del" data-del="${it.id}">删除</button>
          </div>
        </td>` : ''}
      </tr>`;
    }).join('');
  }
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  $('#totalText').textContent = `共 ${state.total} 条记录，第 ${state.page} / ${pages} 页`;
  $('#pageText').textContent = `${state.page} / ${pages}`;
  $('#prevBtn').disabled = state.page <= 1;
  $('#nextBtn').disabled = state.page >= pages;
}

/* ========== 新增 / 编辑 ========== */
function openEdit(item) {
  $('#editTitle').textContent = item ? '编辑设备' : '新增设备';
  $('#editError').textContent = '';
  $('#eId').value = item ? item.id : '';
  $('#eHall').value = item ? item.hall : '';
  $('#eCategory').value = item ? item.category : state.meta.categories[0] || '';
  $('#eBrand').value = item ? item.brand : '';
  $('#eSerial').value = item ? item.serial : '';
  $('#eOwner').value = item ? item.owner : '';
  $('#eStatus').value = item ? item.status : state.meta.statuses[0] || '';
  $('#editModal').classList.remove('hidden');
  setTimeout(() => $('#eHall').focus(), 50);
}

function closeModal(id) { $('#' + id).classList.add('hidden'); }

async function submitEdit(e) {
  e.preventDefault();
  const id = $('#eId').value;
  const payload = {
    hall: $('#eHall').value,
    category: $('#eCategory').value,
    brand: $('#eBrand').value,
    serial: $('#eSerial').value,
    owner: $('#eOwner').value,
    status: $('#eStatus').value,
  };
  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    if (id) {
      await api('/api/equipment/' + encodeURIComponent(id), { method: 'PUT', json: payload });
      toast('修改成功');
    } else {
      await api('/api/equipment', { method: 'POST', json: payload });
      toast('新增成功');
    }
    closeModal('editModal');
    await Promise.all([loadMeta(), loadList()]);
  } catch (err) {
    $('#editError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ========== 删除 ========== */
function askDelete(id) {
  const row = $$('#tbody tr').find((tr) => tr.querySelector(`[data-del="${CSS.escape(id)}"]`));
  let desc = id;
  if (row) {
    const tds = row.querySelectorAll('td');
    desc = `${tds[1].textContent} · ${tds[2].textContent} · ${tds[4].textContent}`;
  }
  $('#delText').textContent = `确定要删除「${desc}」吗？此操作不可恢复。`;
  state.pendingDeleteId = id;
  $('#delModal').classList.remove('hidden');
}

async function confirmDelete() {
  const id = state.pendingDeleteId;
  if (!id) return;
  $('#delConfirmBtn').disabled = true;
  try {
    await api('/api/equipment/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('已删除');
    closeModal('delModal');
    const pages = Math.max(1, Math.ceil((state.total - 1) / state.pageSize));
    if (state.page > pages) state.page = pages;
    await loadList();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('#delConfirmBtn').disabled = false;
  }
}

/* ========== 模板下载 ========== */
async function downloadTemplate() {
  try {
    const { resp } = await api('/api/import/template');
    const blob = await resp.blob();
    saveBlob(blob, '设备导入模板.csv');
    toast('模板已下载');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========== 批量导入 ========== */
function decodeCSV(buf) {
  // 优先 UTF-8（含 BOM），解码失败则回退 GBK（Excel 中文版常见编码）
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    toast('请上传 .csv 文件', 'err');
    return;
  }
  $('#fileDropText').textContent = `已选择：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  $('#importProgress').classList.remove('hidden');
  try {
    const buf = await file.arrayBuffer();
    const content = decodeCSV(buf);
    const { data } = await api('/api/equipment/import', { method: 'POST', json: { content } });
    renderImportResult(data);
    await Promise.all([loadMeta(), loadList()]);
  } catch (e) {
    toast(e.message, 'err');
    $('#importResult').classList.remove('hidden');
    $('#importResult').innerHTML = `<p class="fail-reason">导入失败：${esc(e.message)}</p>`;
  } finally {
    $('#importProgress').classList.add('hidden');
  }
}

function renderImportResult(r) {
  const box = $('#importResult');
  box.classList.remove('hidden');
  const failRows = (r.failedRows || []).map((f) => `
    <tr>
      <td>${f.lineNo}</td>
      <td>${esc(f.row.join(' | '))}</td>
      <td class="fail-reason">${esc(f.errors.join('；'))}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="import-summary">
      <div class="stat-pill stat-total"><div class="num">${r.total}</div><div class="lab">总行数</div></div>
      <div class="stat-pill stat-ok"><div class="num">${r.successCount}</div><div class="lab">成功导入</div></div>
      <div class="stat-pill stat-fail"><div class="num">${r.failedCount}</div><div class="lab">失败行数</div></div>
    </div>
    ${r.failedCount ? `
      <p style="font-size:13px;color:var(--muted);margin-bottom:8px">失败明细（修正后可重新导入）：</p>
      <div class="fail-table-wrap">
        <table class="fail-table">
          <thead><tr><th style="width:64px">行号</th><th>失败行内容</th><th style="width:200px">失败原因</th></tr></thead>
          <tbody>${failRows}</tbody>
        </table>
      </div>
      <div class="download-fail">
        <button class="btn btn-primary btn-sm" id="dlFailBtn">⬇ 下载失败行（CSV，含失败原因）</button>
      </div>` : '<p style="color:#15803d">全部导入成功 🎉</p>'}
  `;
  if (r.failedCount) {
    $('#dlFailBtn').addEventListener('click', () => {
      const blob = new Blob(['﻿' + r.failedCsv.replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' });
      saveBlob(blob, `导入失败行_${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }
}

/* ========== 事件绑定 ========== */
function bindEvents() {
  // 登录
  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin($('#loginUsername').value.trim(), $('#loginPassword').value);
  });
  $('#logoutBtn').addEventListener('click', () => doLogout('已退出登录'));

  // 筛选
  let kwTimer = null;
  $('#fKeyword').addEventListener('input', (e) => {
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => {
      state.filters.keyword = e.target.value.trim();
      state.page = 1;
      loadList();
    }, 300);
  });
  $('#fHall').addEventListener('change', (e) => { state.filters.hall = e.target.value; state.page = 1; loadList(); });
  $('#fCategory').addEventListener('change', (e) => { state.filters.category = e.target.value; state.page = 1; loadList(); });
  $('#fStatus').addEventListener('change', (e) => { state.filters.status = e.target.value; state.page = 1; loadList(); });
  $('#resetBtn').addEventListener('click', () => {
    state.filters = { keyword: '', hall: '', category: '', status: '' };
    state.page = 1;
    $('#fKeyword').value = '';
    $('#fHall').value = '';
    $('#fCategory').value = '';
    $('#fStatus').value = '';
    loadList();
  });

  // 分页
  $('#prevBtn').addEventListener('click', () => { if (state.page > 1) { state.page--; loadList(); } });
  $('#nextBtn').addEventListener('click', () => {
    const pages = Math.ceil(state.total / state.pageSize);
    if (state.page < pages) { state.page++; loadList(); }
  });

  // 新增/编辑
  $('#addBtn').addEventListener('click', () => openEdit(null));
  $('#editForm').addEventListener('submit', submitEdit);

  // 表格内编辑/删除（事件委托）
  $('#tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-edit');
      api('/api/equipment/' + encodeURIComponent(id)).then(({ data }) => openEdit(data.item));
    } else if (delBtn) {
      askDelete(delBtn.getAttribute('data-del'));
    }
  });
  $('#delConfirmBtn').addEventListener('click', confirmDelete);

  // 模板 / 导入
  $('#tplBtn').addEventListener('click', downloadTemplate);
  $('#tplBtn2').addEventListener('click', downloadTemplate);
  $('#importBtn').addEventListener('click', () => {
    $('#importResult').classList.add('hidden');
    $('#importResult').innerHTML = '';
    $('#fileDropText').textContent = '点击选择文件，或将 CSV 文件拖到此处';
    $('#fileInput').value = '';
    $('#importModal').classList.remove('hidden');
  });

  const drop = $('#fileDrop');
  const fileInput = $('#fileInput');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
  ['dragover', 'dragenter'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // 弹窗关闭
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-close]');
    if (btn) closeModal(btn.getAttribute('data-close'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal-mask').forEach((m) => m.classList.add('hidden'));
  });
}

/* ========== 启动 ========== */
(async function init() {
  bindEvents();
  if (state.token) {
    try {
      const { data } = await api('/api/me');
      state.user = data.user;
      await enterApp();
      return;
    } catch {
      state.token = '';
      localStorage.removeItem('token');
    }
  }
  showView('login');
})();
