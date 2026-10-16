/**
 * 全量备份工具
 *
 * 导出：
 * - exportAllCSV()    单文件 CSV，内含「打卡项目 / 打卡记录 / 待办事项 / 临时任务」四个区块
 * - exportBackupJSON() 完整备份 JSON，保留 id、阶段、排序等全部结构（推荐用于迁移）
 *
 * 恢复：
 * - parseBackupCSV(text) / parseBackupJSON(text) → { items, records, todos, warnings }
 * - restoreData(parsed, mode)  mode='merge' 只补缺失 | 'replace' 清空后重建
 */

import {
  getCheckinItems,
  getCheckinRecords,
  getTodos,
  getArchivedCheckinItems,
  getArchivedTodos,
  getAllQuickNotes,
  getAllData,
  setAllData,
  TODO_PRIORITIES,
} from './storage';

/* ==================== 文件下载 ==================== */

/**
 * 触发浏览器/WebView 下载
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==================== 区块与表头定义 ==================== */

const SECTION = {
  ITEMS: '打卡项目',
  RECORDS: '打卡记录',
  TODOS: '待办事项',
  NOTES: '临时任务',
};

const ITEM_HEADERS = ['项目名称', '创建日期', '排序', '归档日期'];
const RECORD_HEADERS = ['日期', '项目名称', '状态', '完成时间', '备注'];
const NOTE_HEADERS = ['日期', '内容', '状态', '完成时间', '创建时间'];
const TODO_HEADERS = [
  '标题', '背景', '目标', '行动', '结果', '阶段',
  '优先级', '状态', '完成时间', '创建时间', '截止日期',
  '保持', '改进', '停止', '开始', '归档日期',
];

/* ==================== CSV 基础 ==================== */

/**
 * 电子表格公式注入护栏：以 = + - @ 或制表符开头的单元格，Excel 会当公式/DDE 执行。
 * 备份 CSV 的内容可能来自另一台设备或一份别人给的备份文件，属于跨信任边界，
 * 因此导出时前置单引号使其退化为纯文本（Excel 里会看到这个撇号，是有意为之）。
 * parseCSV 读回时会脱掉同一层护栏，DayMark 自身的导出→导入往返不受影响
 * （唯一例外：内容本身就以 `'= ` 这类「撇号+公式符」开头，会被当成护栏少一个撇号）。
 */
const FORMULA_LEAD_RE = /^[=+\-@\t]/;

function guardFormulaCell(s) {
  return FORMULA_LEAD_RE.test(s) ? `'${s}` : s;
}

function unguardCell(s) {
  return s[0] === "'" && FORMULA_LEAD_RE.test(s.slice(1)) ? s.slice(1) : s;
}

function csvCell(value) {
  const raw = value == null ? '' : String(value);
  const s = guardFormulaCell(raw);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

/**
 * 完整 CSV 解析：支持引号内的逗号、换行与转义双引号
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else { inQuotes = false; }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (c === '\r') {
      // 忽略 CR，统一按 LF 处理
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 脱掉导出时加的公式护栏，保证「导出 → 导入」拿到原文
  return rows.map((r) => r.map(unguardCell));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatDateOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ==================== 字段转换 ==================== */

function priorityLabel(key) {
  const entry = TODO_PRIORITIES[key];
  if (entry) return entry.label;
  // 兼容旧版 high / medium / low 等非法值，统一导出为默认档的中文标签
  return TODO_PRIORITIES.not_urgent_important.label;
}

function priorityKey(label) {
  const s = String(label == null ? '' : label).trim();
  if (!s) return 'not_urgent_important';
  if (TODO_PRIORITIES[s]) return s;
  const found = Object.keys(TODO_PRIORITIES).find((k) => TODO_PRIORITIES[k].label === s);
  return found || 'not_urgent_important';
}

function formatPhases(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return '';
  return phases
    .map((p) => {
      const label = p.completed ? '已完成' : '未完成';
      const due = p.dueDate ? `@${p.dueDate}` : '';
      const time = p.completed && p.completedTime ? ` (${p.completedTime})` : '';
      return `[${label}${due}]${p.name}${time}`;
    })
    .join(' | ');
}

function parsePhases(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return undefined;
  const phases = [];
  s.split('|').forEach((part) => {
    const p = String(part).trim();
    if (!p) return;
    const m = p.match(/^\[(已完成|未完成)(?:@(\d{4}-\d{2}-\d{2}))?\]([\s\S]*)$/);
    if (!m) return;
    const dueDate = m[2] || '';
    let rest = m[3].trim();
    let completedTime = '';
    const tm = rest.match(/\s\(([^()]*)\)\s*$/);
    if (tm) {
      completedTime = tm[1].trim();
      rest = rest.slice(0, tm.index).trim();
    }
    if (!rest) return;
    phases.push({ name: rest, completed: m[1] === '已完成', completedTime, dueDate });
  });
  return phases.length > 0 ? phases : undefined;
}

function isDone(status) {
  const s = String(status == null ? '' : status).trim();
  return s === '已完成' || s === '✓' || s === '是' || s === '1' || s === 'true';
}

/**
 * 归档列：已归档就写归档日期（未归档留空）。
 * 归档但日期缺失的外来数据补成今天，保证「导出 → 导入」不会把归档状态走丢。
 */
function archivedCell(entry) {
  if (!entry || entry.archived !== true) return '';
  const s = String(entry.archivedAt || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : formatDateOnly(new Date());
}

/** CSV 的「归档日期」列 → 归档日期字符串；空或非法即未归档 */
function archivedFromCell(cell) {
  const s = String(cell == null ? '' : cell).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/* ==================== 导出 ==================== */

/**
 * 生成全量 CSV 文本（三个区块）
 * @returns {string}
 */
export function buildAllCSV() {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  const todos = getTodos();
  const quickNotes = getAllQuickNotes();

  const lines = [];
  lines.push('DayMark 全量数据导出');
  lines.push(csvRow(['导出时间', formatDateTime(new Date())]));
  lines.push('');

  /* --- 区块一：打卡项目 --- */
  lines.push(`[${SECTION.ITEMS}]`);
  lines.push(csvRow(ITEM_HEADERS));
  items.forEach((it) => {
    lines.push(csvRow([it.name, it.createdAt || '', it.order != null ? it.order : '', archivedCell(it)]));
  });
  lines.push('');

  /* --- 区块二：打卡记录 --- */
  lines.push(`[${SECTION.RECORDS}]`);
  lines.push(csvRow(RECORD_HEADERS));
  const nameOf = {};
  items.forEach((i) => { nameOf[i.id] = i.name; });
  Object.keys(records).sort().forEach((date) => {
    const day = records[date];
    if (!day || typeof day !== 'object') return;
    Object.keys(day).forEach((itemId) => {
      const v = day[itemId];
      if (!v || v === false) return;
      if (v !== true && v.completed === false) return;
      lines.push(csvRow([
        date,
        nameOf[itemId] || itemId,
        '已完成',
        (v && v.time) || '',
        (v && v.note) || '',
      ]));
    });
  });
  lines.push('');

  /* --- 区块三：待办事项 --- */
  lines.push(`[${SECTION.TODOS}]`);
  lines.push(csvRow(TODO_HEADERS));
  todos.forEach((t) => {
    const d = t.description || {};
    const r = t.review || {};
    lines.push(csvRow([
      t.title,
      d.situation || '',
      d.target || '',
      d.action || '',
      d.result || '',
      formatPhases(t.phases),
      priorityLabel(t.priority),
      t.completed ? '已完成' : '未完成',
      t.completedTime || '',
      t.createdAt || '',
      t.dueDate || '',
      r.keep || '',
      r.improve || '',
      r.stop || '',
      r.start || '',
      archivedCell(t),
    ]));
  });
  lines.push('');

  /* --- 区块四：临时任务 --- */
  lines.push(`[${SECTION.NOTES}]`);
  lines.push(csvRow(NOTE_HEADERS));
  Object.keys(quickNotes).sort().forEach((date) => {
    (quickNotes[date] || []).forEach((n) => {
      lines.push(csvRow([
        date,
        n.text,
        n.done ? '已完成' : '未完成',
        n.doneAt || '',
        n.createdAt || '',
      ]));
    });
  });

  return lines.join('\n');
}

/** 导出全量 CSV（单文件，含全部三类数据） */
export function exportAllCSV() {
  const filename = `DayMark全量数据_${formatDateOnly(new Date())}`;
  downloadFile(`\uFEFF${buildAllCSV()}`, `${filename}.csv`, 'text/csv;charset=utf-8');
}

/** 导出完整备份 JSON（无损，推荐用于换设备迁移） */
export function exportBackupJSON() {
  const filename = `DayMark备份_${formatDateOnly(new Date())}`;
  downloadFile(JSON.stringify(getAllData(), null, 2), `${filename}.json`, 'application/json;charset=utf-8');
}

/* ==================== 解析 ==================== */

/**
 * 解析全量 CSV 文本
 * @param {string} text
 * @returns {{items:Array, records:Object, todos:Array, warnings:Array<string>}}
 */
export function parseBackupCSV(text) {
  const rows = parseCSV(text);
  const sections = {};
  let current = null;

  rows.forEach((row) => {
    if (!row || row.length === 0) return;
    const isBlank = row.every((c) => !String(c == null ? '' : c).trim());
    if (isBlank) return;

    const first = String(row[0] == null ? '' : row[0]).trim();
    const secMatch = first.match(/^\[(.+)\]$/);
    if (secMatch && row.length === 1) {
      current = secMatch[1].trim();
      sections[current] = { header: null, rows: [] };
      return;
    }
    if (!current) return;

    const sec = sections[current];
    if (!sec.header) {
      sec.header = row.map((h) => String(h == null ? '' : h).trim());
      return;
    }
    const obj = {};
    sec.header.forEach((h, idx) => {
      obj[h] = row[idx] != null ? String(row[idx]) : '';
    });
    sec.rows.push(obj);
  });

  const warnings = [];
  const items = [];
  const records = {};
  const todos = [];
  const quickNotes = {};

  const known = [SECTION.ITEMS, SECTION.RECORDS, SECTION.TODOS, SECTION.NOTES];
  const found = Object.keys(sections).filter((k) => known.includes(k));
  if (found.length === 0) {
    warnings.push('未识别到有效数据区块，请确认选择的是本应用导出的 CSV 文件。');
  }

  /* --- 打卡项目 --- */
  const secItems = sections[SECTION.ITEMS];
  if (secItems && secItems.header) {
    secItems.rows.forEach((r) => {
      const name = String(r['项目名称'] || '').trim();
      if (!name) return;
      const orderRaw = String(r['排序'] || '').trim();
      const order = orderRaw !== '' && Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : undefined;
      const archivedAt = archivedFromCell(r['归档日期']);
      items.push({
        name,
        createdAt: String(r['创建日期'] || '').trim(),
        order,
        archived: !!archivedAt,
        archivedAt,
      });
    });
  }

  /* --- 打卡记录（以项目名称为键，导入时再映射到项目 id） --- */
  const secRecords = sections[SECTION.RECORDS];
  if (secRecords && secRecords.header) {
    secRecords.rows.forEach((r) => {
      const date = String(r['日期'] || '').trim();
      const name = String(r['项目名称'] || '').trim();
      if (!date || !name) return;
      if (!isDone(r['状态'])) return;
      if (!records[date]) records[date] = {};
      records[date][name] = {
        completed: true,
        time: String(r['完成时间'] || '').trim(),
        note: String(r['备注'] || '').trim(),
      };
    });
  }

  /* --- 待办事项 --- */
  const secTodos = sections[SECTION.TODOS];
  if (secTodos && secTodos.header) {
    secTodos.rows.forEach((r) => {
      const title = String(r['标题'] || '').trim();
      if (!title) return;
      const archivedAt = archivedFromCell(r['归档日期']);
      todos.push({
        title,
        description: {
          situation: String(r['背景'] || '').trim(),
          target: String(r['目标'] || '').trim(),
          action: String(r['行动'] || '').trim(),
          result: String(r['结果'] || '').trim(),
        },
        phases: parsePhases(r['阶段']),
        priority: priorityKey(r['优先级']),
        completed: isDone(r['状态']),
        completedTime: String(r['完成时间'] || '').trim(),
        createdAt: String(r['创建时间'] || '').trim() || new Date().toISOString(),
        dueDate: String(r['截止日期'] || '').trim(),
        review: {
          keep: String(r['保持'] || '').trim(),
          improve: String(r['改进'] || '').trim(),
          stop: String(r['停止'] || '').trim(),
          start: String(r['开始'] || '').trim(),
        },
        archived: !!archivedAt,
        archivedAt,
      });
    });
  }

  /* --- 临时任务（CSV 里没有 id，交由存储层在恢复时补） --- */
  const secNotes = sections[SECTION.NOTES];
  if (secNotes && secNotes.header) {
    secNotes.rows.forEach((r) => {
      const date = String(r['日期'] || '').trim();
      const text = String(r['内容'] || '').trim();
      if (!date || !text) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      if (!quickNotes[date]) quickNotes[date] = [];
      quickNotes[date].push({
        text,
        done: isDone(r['状态']),
        doneAt: String(r['完成时间'] || '').trim(),
        createdAt: String(r['创建时间'] || '').trim(),
      });
    });
  }

  return { items, records, todos, quickNotes, warnings };
}

/**
 * 解析备份 JSON 文本
 * @param {string} text
 * @returns {{items:Array, records:Object, todos:Array, warnings:Array<string>}}
 */
export function parseBackupJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败：${e.message}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('文件内容不是有效的 JSON 对象。');
  }
  const payload = data.items || data.records || data.todos ? data : data.data;
  if (!payload || typeof payload !== 'object') {
    throw new Error('JSON 中未找到 items / records / todos 数据。');
  }
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    records: payload.records && typeof payload.records === 'object' ? payload.records : {},
    todos: Array.isArray(payload.todos) ? payload.todos : [],
    quickNotes: payload.quickNotes && typeof payload.quickNotes === 'object' ? payload.quickNotes : {},
    warnings: [],
  };
}

/**
 * 根据文件后缀选择解析方式
 * @param {File} file
 * @returns {Promise<{items:Array, records:Object, todos:Array, warnings:Array<string>}>}
 */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const name = (file && file.name) || '';
        const parsed = /\.json$/i.test(name)
          ? parseBackupJSON(text)
          : parseBackupCSV(text);
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * 写回本地存储
 * @param {{items:Array, records:Object, todos:Array}} parsed
 * @param {'merge'|'replace'} mode
 */
export function restoreData(parsed, mode) {
  return setAllData(parsed, mode);
}

/* ==================== 概览 ==================== */

/**
 * 当前本地数据概览
 *
 * itemCount / todoCount 只数「界面上看得见的」（未归档），归档项单列成 archived*Count，
 * 否则数据管理里显示的数量会和页面上的列表对不上，用户会以为丢了数据。
 * recordCount 仍是全量：归档项的历史记录确实占着空间，也要算进备份体积。
 */
export function getDataOverview() {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  const todos = getTodos();
  const quickNotes = getAllQuickNotes();

  const activeItems = items.filter((i) => !i.archived);
  const archivedItems = items.filter((i) => i.archived === true);
  const activeTodos = todos.filter((t) => !t.archived);
  const archivedTodos = todos.filter((t) => t.archived === true);
  const archivedIds = {};
  archivedItems.forEach((i) => { archivedIds[i.id] = true; });

  let noteCount = 0;
  let noteDone = 0;
  Object.keys(quickNotes).forEach((date) => {
    (quickNotes[date] || []).forEach((n) => {
      noteCount += 1;
      if (n.done) noteDone += 1;
    });
  });

  let recordCount = 0;
  let archivedRecordCount = 0;
  const dates = [];
  Object.keys(records).forEach((date) => {
    const day = records[date];
    if (!day || typeof day !== 'object') return;
    let hasAny = false;
    Object.keys(day).forEach((k) => {
      const v = day[k];
      if (v && (v === true || v.completed !== false)) {
        recordCount += 1;
        if (archivedIds[k]) archivedRecordCount += 1;
        hasAny = true;
      }
    });
    if (hasAny) dates.push(date);
  });
  dates.sort();

  return {
    itemCount: activeItems.length,
    recordCount,
    dayCount: dates.length,
    firstDay: dates[0] || '',
    lastDay: dates[dates.length - 1] || '',
    todoCount: activeTodos.length,
    todoDone: activeTodos.filter((t) => t.completed).length,
    noteCount,
    noteDone,
    archivedItemCount: archivedItems.length,
    archivedRecordCount,
    archivedTodoCount: archivedTodos.length,
  };
}

/**
 * 归档清单：数据管理界面「归档」区块的数据来源。
 * 只读，不做任何写操作；带上的都是恢复/删除决策要看的量（历史条数、最近记录日、完成状态）。
 * @returns {{items:Array, todos:Array}}
 */
export function getArchiveInventory() {
  const records = getCheckinRecords();

  const items = getArchivedCheckinItems().map((item) => {
    let count = 0;
    let lastDate = '';
    Object.keys(records).sort().forEach((date) => {
      const v = records[date] && records[date][item.id];
      if (v && (v === true || v.completed !== false)) {
        count += 1;
        lastDate = date;
      }
    });
    return {
      id: item.id,
      name: item.name,
      createdAt: item.createdAt || '',
      archivedAt: item.archivedAt || '',
      recordCount: count,
      lastRecordDate: lastDate,
    };
  });

  const todos = getArchivedTodos().map((todo) => ({
    id: todo.id,
    title: todo.title,
    createdAt: todo.createdAt || '',
    archivedAt: todo.archivedAt || '',
    completed: !!todo.completed,
    completedTime: todo.completedTime || '',
    dueDate: todo.dueDate || '',
    priority: todo.priority || 'not_urgent_important',
    phaseTotal: (todo.phases || []).length,
    phaseDone: (todo.phases || []).filter((p) => p.completed).length,
  }));

  return { items, todos };
}
