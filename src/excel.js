const XLSX = require('xlsx');
const { EQUIP_TYPES, STATUSES } = require('./db');

const HEADERS = ['设备类型', '影厅', '品牌', '序列号', '责任人', '状态'];
const EXAMPLE = ['放映机', '1号厅', 'Barco 巴可', 'B4K-2024-001', '李工', '正常'];

/* ---------- 工具 ---------- */
function colWidths(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}
function buf(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function cell(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/* ---------- 导入模板 ---------- */
function buildTemplateBuffer() {
  const wb = XLSX.utils.book_new();

  // Sheet1: 数据填写
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, EXAMPLE]);
  colWidths(ws, [12, 10, 22, 22, 10, 10]);
  XLSX.utils.book_append_sheet(wb, ws, '设备台账');

  // Sheet2: 填写说明
  const guide = [
    ['影院放映设备台账 - 导入模板填写说明'],
    [],
    ['列名', '是否必填', '允许值 / 说明'],
    ['设备类型', '必填', EQUIP_TYPES.join('、')],
    ['影厅', '必填', '如：1号厅、IMAX厅'],
    ['品牌', '必填', '设备品牌，可含型号，如 Barco 巴可'],
    ['序列号', '必填', '设备唯一序列号，平台内不可重复'],
    ['责任人', '必填', '该设备的负责人姓名'],
    ['状态', '可空(默认正常)', STATUSES.join('、')],
    [],
    ['注意事项：'],
    ['1. 请从「设备台账」工作表第 2 行开始填写，第 1 行为表头，请勿修改或删除。'],
    ['2. 黄色示例行仅供参考，正式导入前请删除或直接覆盖。'],
    ['3. 单次导入上限 5000 行；任一列校验不通过的整行会进入失败清单，不影响其他行。'],
    ['4. 导入完成后，失败行可在页面上下载，文件内含「失败原因」列，修正后可重新导入。']
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(guide);
  colWidths(ws2, [14, 14, 70]);
  XLSX.utils.book_append_sheet(wb, ws2, '填写说明');

  return buf(wb);
}

/* ---------- 解析上传文件 ---------- */
function parseImportBuffer(fileBuffer) {
  let wb;
  try {
    wb = XLSX.read(fileBuffer, { type: 'buffer' });
  } catch (e) {
    return { error: '无法解析文件，请上传 .xlsx 格式的导入模板' };
  }
  const first = wb.SheetNames[0];
  if (!first) return { error: '文件中没有工作表' };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[first], {
    header: 1, defval: '', raw: false
  });
  if (!rows.length) return { error: '文件为空' };

  // 定位表头
  const header = rows[0].map(cell);
  const idx = {};
  HEADERS.forEach(h => { idx[h] = header.findIndex(x => x === h); });
  const missing = HEADERS.filter(h => idx[h] < 0);
  if (missing.length) {
    return { error: `缺少必需列：${missing.join('、')}，请使用标准导入模板` };
  }

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const data = {
      type: cell(r[idx['设备类型']]),
      hall: cell(r[idx['影厅']]),
      brand: cell(r[idx['品牌']]),
      serial: cell(r[idx['序列号']]),
      owner: cell(r[idx['责任人']]),
      status: cell(r[idx['状态']]) || '正常'
    };
    // 全空行跳过
    if (!Object.values(data).some(v => v)) continue;
    records.push({ rowNum: i + 1, data }); // 行号按 Excel 实际行号(含表头)
  }
  if (!records.length) return { error: '未发现可导入的数据行' };
  if (records.length > 5000) return { error: '单次导入不能超过 5000 行' };
  return { records };
}

/* ---------- 失败行文件 ---------- */
function buildFailedBuffer(failedRows) {
  const wb = XLSX.utils.book_new();
  const aoa = [['Excel行号', ...HEADERS, '失败原因']];
  failedRows.forEach(f => {
    aoa.push([
      f.rowNum, f.data.type, f.data.hall, f.data.brand,
      f.data.serial, f.data.owner, f.data.status, f.reason
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  colWidths(ws, [9, 12, 10, 22, 22, 10, 10, 40]);
  XLSX.utils.book_append_sheet(wb, ws, '导入失败行');
  return buf(wb);
}

/* ---------- 台账导出 ---------- */
function buildExportBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const aoa = [['设备类型', '影厅', '品牌', '序列号', '责任人', '状态', '更新时间']];
  rows.forEach(r => aoa.push([
    r.type, r.hall, r.brand, r.serial, r.owner, r.status,
    r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''
  ]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  colWidths(ws, [12, 10, 22, 22, 10, 10, 20]);
  XLSX.utils.book_append_sheet(wb, ws, '设备台账');
  return buf(wb);
}

module.exports = {
  HEADERS,
  buildTemplateBuffer,
  parseImportBuffer,
  buildFailedBuffer,
  buildExportBuffer
};
