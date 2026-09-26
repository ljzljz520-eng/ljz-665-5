/* ================= 全局状态 ================= */
const state = { me: null, meta: null, editingId: null, failedToken: null };
const $ = id => document.getElementById(id);

/* ================= 工具 ================= */
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401 && !url.includes('/auth/login')) {
    showLogin();
    throw new Error('登录已过期');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `请求失败(${res.status})`);
  return data;
}
function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
function isAdmin() { return state.me && state.me.role === 'admin'; }

/* ================= 登录 / 登出 ================= */
function showLogin() {
  state.me = null;
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}
function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('userInfo').textContent = `${state.me.name}（${state.me.username}）`;
  const badge = $('roleBadge');
  if (isAdmin()) { badge.textContent = '管理员'; badge.className = 'badge admin'; }
  else { badge.textContent = '普通员工 · 只读'; badge.className = 'badge staff'; }
  // 权限控制：员工隐藏所有维护入口
  $('adminBar').style.display = isAdmin() ? '' : 'none';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    state.me = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('loginUser').value.trim(), password: $('loginPwd').value })
    });
    await bootstrap();
    toast(`欢迎，${state.me.name}`);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '登 录';
  }
});
$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

/* ================= 初始化 ================= */
async function bootstrap() {
  state.meta = await api('/api/meta');
  fillMeta();
  showApp();
  await loadList();
}
function fillMeta() {
  const { types, statuses, halls } = state.meta;
  const fill = (el, items, withAll) => {
    el.innerHTML = (withAll ? '<option value="">全部</option>' : '') +
      items.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  };
  fill($('fType'), types, true);
  fill($('fStatus'), statuses, true);
  fill($('fHall'), halls, true);
  fill($('efType'), types, false);
  fill($('efStatus'), statuses, false);
  $('hallList').innerHTML = halls.map(h => `<option value="${esc(h)}">`).join('');
}

/* ================= 台账列表 ================= */
function currentFilters() {
  const p = new URLSearchParams();
  if ($('fQ').value.trim()) p.set('q', $('fQ').value.trim());
  if ($('fType').value) p.set('type', $('fType').value);
  if ($('fHall').value) p.set('hall', $('fHall').value);
  if ($('fStatus').value) p.set('status', $('fStatus').value);
  return p.toString();
}
async function loadList() {
  const rows = await api('/api/equipment?' + currentFilters());
  const tbody = $('equipTbody');
  $('totalCount').textContent = `共 ${rows.length} 条`;
  $('emptyTip').classList.toggle('hidden', rows.length > 0);
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><span class="type-tag">${esc(r.type)}</span></td>
      <td>${esc(r.hall)}</td>
      <td>${esc(r.brand)}</td>
      <td class="serial">${esc(r.serial)}</td>
      <td>${esc(r.owner)}</td>
      <td><span class="status s-${esc(r.status)}">${esc(r.status)}</span></td>
      <td>${fmtTime(r.updatedAt)}</td>
      <td class="admin-only" style="display:${isAdmin() ? '' : 'none'}">
        <div class="row-actions">
          <button class="btn btn-mini" onclick="openEdit('${r.id}')">编辑</button>
          <button class="btn btn-danger" onclick="removeEquip('${r.id}','${esc(r.serial)}')">删除</button>
        </div>
      </td>
    </tr>`).join('');
  state.rows = rows;
}
$('searchBtn').addEventListener('click', loadList);
$('resetBtn').addEventListener('click', () => {
  ['fQ', 'fType', 'fHall', 'fStatus'].forEach(id => $(id).value = '');
  loadList();
});
$('fQ').addEventListener('keydown', e => { if (e.key === 'Enter') loadList(); });

/* ================= 新增 / 编辑 ================= */
function resetForm() {
  $('equipForm').reset();
  $('formError').classList.add('hidden');
  state.editingId = null;
}
$('addBtn').addEventListener('click', () => {
  resetForm();
  $('formTitle').textContent = '新增设备';
  openModal('formModal');
});
window.openEdit = id => {
  const r = state.rows.find(x => x.id === id);
  if (!r) return;
  resetForm();
  state.editingId = id;
  $('formTitle').textContent = '编辑设备';
  $('efType').value = r.type;
  $('efHall').value = r.hall;
  $('efBrand').value = r.brand;
  $('efSerial').value = r.serial;
  $('efOwner').value = r.owner;
  $('efStatus').value = r.status;
  openModal('formModal');
};
$('equipForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    type: $('efType').value, hall: $('efHall').value, brand: $('efBrand').value,
    serial: $('efSerial').value, owner: $('efOwner').value, status: $('efStatus').value
  };
  const btn = $('formSubmit');
  btn.disabled = true;
  try {
    if (state.editingId) {
      await api(`/api/equipment/${state.editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('设备已更新');
    } else {
      await api('/api/equipment', { method: 'POST', body: JSON.stringify(body) });
      toast('设备已新增');
    }
    closeModal('formModal');
    state.meta = await api('/api/meta'); // 影厅可能有新值
    fillMeta();
    await loadList();
  } catch (err) {
    const fe = $('formError');
    fe.textContent = err.message;
    fe.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

/* ================= 删除 ================= */
window.removeEquip = async (id, serial) => {
  if (!confirm(`确定删除序列号为「${serial}」的设备吗？此操作不可恢复。`)) return;
  try {
    await api(`/api/equipment/${id}`, { method: 'DELETE' });
    toast('已删除');
    await loadList();
  } catch (err) {
    toast(err.message, 'err');
  }
};

/* ================= 导入 ================= */
$('importBtn').addEventListener('click', () => {
  $('importFile').value = '';
  $('importResult').classList.add('hidden');
  $('dlFailedBtn').style.display = 'none';
  state.failedToken = null;
  openModal('importModal');
});
$('tplBtn').addEventListener('click', () => { window.location.href = '/api/import/template'; });
$('exportBtn').addEventListener('click', () => {
  const qs = currentFilters();
  window.location.href = '/api/equipment/export' + (qs ? '?' + qs : '');
});
$('doImportBtn').addEventListener('click', async () => {
  const file = $('importFile').files[0];
  if (!file) return toast('请先选择 .xlsx 文件', 'err');
  if (!/\.xlsx$/i.test(file.name)) return toast('仅支持 .xlsx 格式', 'err');
  const btn = $('doImportBtn');
  btn.disabled = true; btn.textContent = '导入中…';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const result = await api('/api/import', { method: 'POST', body: fd });
    renderImportResult(result);
    state.meta = await api('/api/meta');
    fillMeta();
    await loadList();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '开始导入';
  }
});
function renderImportResult(r) {
  const box = $('importResult');
  box.classList.remove('hidden');
  let html = `<div class="import-summary">
    <span class="sum-total">共 ${r.total} 行</span>
    <span class="sum-ok">成功 ${r.inserted} 行</span>
    <span class="sum-fail">失败 ${r.failedCount} 行</span>
  </div>`;
  if (r.failedCount > 0) {
    html += `<table class="fail-table"><thead>
      <tr><th>Excel行号</th><th>序列号</th><th>失败原因</th></tr></thead><tbody>` +
      r.failedPreview.map(f => `<tr>
        <td>${f.rowNum}</td><td class="serial">${esc(f.data.serial) || '-'}</td>
        <td>${esc(f.reason)}</td></tr>`).join('') +
      `</tbody></table>` +
      (r.failedCount > r.failedPreview.length
        ? `<p style="margin-top:8px;color:var(--text-2)">仅预览前 ${r.failedPreview.length} 条，完整清单请下载失败行文件。</p>` : '');
    const dl = $('dlFailedBtn');
    dl.href = `/api/import/failed/${r.failedToken}`;
    dl.style.display = '';
  } else {
    $('dlFailedBtn').style.display = 'none';
  }
  box.innerHTML = html;
  toast(r.failedCount ? `导入完成：成功 ${r.inserted} 行，失败 ${r.failedCount} 行` : `全部 ${r.inserted} 行导入成功`,
    r.failedCount ? 'err' : 'ok');
}

/* ================= 弹窗关闭 ================= */
document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => closeModal(el.dataset.close)));
document.querySelectorAll('.modal-mask').forEach(mask =>
  mask.addEventListener('click', e => { if (e.target === mask) mask.classList.add('hidden'); }));

/* ================= 启动 ================= */
(async () => {
  try {
    state.me = await api('/api/auth/me');
    await bootstrap();
  } catch (e) {
    showLogin();
  }
})();
