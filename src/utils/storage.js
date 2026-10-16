/**
 * LocalStorage 读写工具
 * 提供打卡项目、打卡记录、待办事项的 CRUD 操作
 * - 打卡记录：{ completed, time, note }
 * - 待办描述：STAR 法则 { situation, target, action, result }
 * - 待办优先级：四象限 urgent_important / urgent_not_important / not_urgent_important / not_urgent_not_important
 * - 待办完成：{ completedTime, review: { keep, improve, stop, start } }
 * - 临时任务：按天存 { 'YYYY-MM-DD': [{ id, text, done, createdAt, doneAt }] }
 *
 * 数据持久化：所有写操作统一走 safeWrite，末尾通知 onDataWritten 的订阅者，
 * 由 utils/persistence 决定「何时」落盘到本机文件（浏览器 / Node 测试环境无订阅者即 no-op）。
 * 本模块刻意不 import persistence：数据访问层不该决定传输时序，
 * 否则模块导入期的 migrateIfNeeded 会在启动回填完成前就把未回填的 localStorage 写回文件。
 */

/* ==================== 通用工具 ==================== */

const STORAGE_KEYS = {
  CHECKIN_ITEMS: 'daily_checkin_items',
  CHECKIN_RECORDS: 'daily_checkin_records',
  TODOS: 'daily_todos',
  QUICK_NOTES: 'daily_quick_notes',
  SCHEMA_VERSION: 'daily_schema_version',
};

const SCHEMA_VERSION = 2;

const VALID_PRIORITIES = [
  'urgent_important',
  'urgent_not_important',
  'not_urgent_important',
  'not_urgent_not_important',
];

/**
 * 生成简易 UUID
 * @returns {string} UUID v4 格式
 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取今天的日期字符串
 * @returns {string} YYYY-MM-DD
 */
function getToday() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 两个 YYYY-MM-DD 之间的整天差（b - a）；无法解析时按 0 处理 */
function daysBetween(a, b) {
  const ta = Date.parse(`${a}T00:00:00`);
  const tb = Date.parse(`${b}T00:00:00`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

/**
 * 未来 withinDays 天内需要完成的行动项（含已逾期的），按紧急度从高到低排列。
 * 排序只有一个键：剩余天数升序 —— 逾期项是负数，因此天然置顶，无需再单独分类。
 * 未设截止日的行动项无法判定紧急度，不进提醒；所属待办已完成时其行动也不再提醒。
 * @returns {Array<{todo:Object, phase:Object, dueDate:string, daysLeft:number, overdue:boolean}>}
 */
export function getUpcomingPhases(withinDays = 7, todayStr = getToday()) {
  const out = [];
  getTodos().forEach((todo) => {
    if (todo.completed) return;
    (todo.phases || []).forEach((phase) => {
      if (phase.completed || !phase.dueDate) return;
      const daysLeft = daysBetween(todayStr, phase.dueDate);
      if (daysLeft > withinDays) return;
      out.push({ todo, phase, dueDate: phase.dueDate, daysLeft, overdue: daysLeft < 0 });
    });
  });
  out.sort((a, b) => a.daysLeft - b.daysLeft || String(a.todo.title).localeCompare(String(b.todo.title)));
  return out;
}

/**
 * 是否已过期：必须有截止日，且截止日早于今天（当天到期不算过期）
 * 空 dueDate 不能直接参与字符串比较——'' < '2026-10-11' 恒真，
 * 那会把所有未设截止日的待办都标成「已过期」。
 */
export function isPastDue(completed, dueDate, todayStr) {
  return !completed && !!dueDate && String(dueDate) < String(todayStr);
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取当前月份字符串
 * @returns {string} YYYY-MM
 */
function getCurrentMonth() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 获取当前时间 HH:mm
 */
function getNowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ==================== 安全读写 ==================== */

function safeRead(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * 「数据已写入 localStorage」订阅表。
 * 必须在模块导入期就初始化：migrateIfNeeded() 在文件末尾的顶层就会调用 safeWrite。
 */
const writeListeners = [];

/** 订阅数据变更（persistence 用它做防抖落盘），返回取消订阅函数 */
export function onDataWritten(cb) {
  writeListeners.push(cb);
  return () => {
    const i = writeListeners.indexOf(cb);
    if (i !== -1) writeListeners.splice(i, 1);
  };
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('LocalStorage write failed:', e);
    return;
  }
  // 桌面版：由 persistence 决定何时落盘；监听器异常不应影响本次写入结果
  writeListeners.forEach((cb) => {
    try {
      cb(key);
    } catch (e) {
      console.error('onDataWritten listener failed:', e);
    }
  });
}

/* ==================== 数据迁移 ==================== */

/**
 * 迁移旧版数据到新 schema
 * - 旧打卡记录 { itemId: true/false } -> { itemId: { completed, time, note } } 或 null
 * - 旧待办 description (string) -> { situation, target, action, result }
 * - 旧待办 priority (high/medium/low) -> 四象限
 * - 旧待办 无 review 字段
 */
function migrateIfNeeded() {
  const current = safeRead(STORAGE_KEYS.SCHEMA_VERSION, 1);
  if (current >= SCHEMA_VERSION) return;

  // 迁移打卡记录
  const records = getCheckinRecords();
  Object.keys(records).forEach((date) => {
    const day = records[date] || {};
    Object.keys(day).forEach((itemId) => {
      const v = day[itemId];
      if (typeof v === 'boolean') {
        day[itemId] = v
          ? { completed: true, time: '', note: '' }
          : null;
      } else if (v && typeof v === 'object') {
        // 兼容已有对象，补齐字段
        day[itemId] = {
          completed: v.completed !== false,
          time: v.time || '',
          note: v.note || '',
        };
      }
    });
    records[date] = day;
  });
  safeWrite(STORAGE_KEYS.CHECKIN_RECORDS, records);

  // 迁移待办
  const todos = safeRead(STORAGE_KEYS.TODOS, []);
  const priorityMap = {
    high: 'urgent_important',
    medium: 'not_urgent_important',
    low: 'not_urgent_not_important',
  };
  const validPriorities = [
    'urgent_important',
    'urgent_not_important',
    'not_urgent_important',
    'not_urgent_not_important',
  ];
  todos.forEach((t) => {
    // description 字符串 -> STAR 对象
    if (typeof t.description === 'string') {
      const old = t.description;
      t.description = {
        situation: old || '',
        target: '',
        action: '',
        result: '',
      };
    } else if (!t.description || typeof t.description !== 'object') {
      t.description = { situation: '', target: '', action: '', result: '' };
    } else {
      t.description = {
        situation: t.description.situation || '',
        target: t.description.target || '',
        action: t.description.action || '',
        result: t.description.result || '',
      };
    }
    // priority 映射
    if (priorityMap[t.priority]) {
      t.priority = priorityMap[t.priority];
    } else if (!validPriorities.includes(t.priority)) {
      t.priority = 'not_urgent_important';
    }
    // review 补齐
    if (!t.review || typeof t.review !== 'object') {
      t.review = { keep: '', improve: '', stop: '', start: '' };
    } else {
      t.review = {
        keep: t.review.keep || '',
        improve: t.review.improve || '',
        stop: t.review.stop || '',
        start: t.review.start || '',
      };
    }
    if (t.completedTime === undefined) t.completedTime = '';
  });
  safeWrite(STORAGE_KEYS.TODOS, todos);

  safeWrite(STORAGE_KEYS.SCHEMA_VERSION, SCHEMA_VERSION);
}

migrateIfNeeded();

/* ==================== 打卡项目管理 ==================== */

export function getCheckinItems() {
  return safeRead(STORAGE_KEYS.CHECKIN_ITEMS, []);
}

export function addCheckinItem(name) {
  const items = getCheckinItems();
  const newItem = {
    id: generateId(),
    name: name.trim(),
    createdAt: getToday(),
    order: items.length,
  };
  items.push(newItem);
  safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);
  return items;
}

export function editCheckinItem(id, newName) {
  const items = getCheckinItems();
  const idx = items.findIndex((item) => item.id === id);
  if (idx !== -1) {
    items[idx].name = newName.trim();
    safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);
  }
  return items;
}

export function deleteCheckinItem(id) {
  const items = getCheckinItems().filter((item) => item.id !== id);
  // 重新赋予 order（保持连续）
  items.forEach((item, idx) => { item.order = idx; });
  safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);

  const records = getCheckinRecords();
  Object.keys(records).forEach((date) => {
    if (records[date]) {
      delete records[date][id];
    }
  });
  safeWrite(STORAGE_KEYS.CHECKIN_RECORDS, records);

  return items;
}

/**
 * 重新排序打卡项目
 * @param {Array<string>} reorderedIds 按新顺序排列的 ID 数组
 */
export function reorderCheckinItems(reorderedIds) {
  const items = getCheckinItems();
  const map = {};
  items.forEach((item) => { map[item.id] = item; });
  const reordered = reorderedIds
    .filter((id) => map[id])
    .map((id, idx) => { map[id].order = idx; return map[id]; });
  safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, reordered);
  return reordered;
}

/* ==================== 打卡记录管理 ==================== */

export function getCheckinRecords() {
  return safeRead(STORAGE_KEYS.CHECKIN_RECORDS, {});
}

export function getCheckinRecordByDate(date) {
  const records = getCheckinRecords();
  return records[date] || {};
}

/**
 * 获取某日某打卡项的记录
 */
export function getCheckinRecordItem(date, itemId) {
  const day = getCheckinRecordByDate(date);
  return day[itemId] || null;
}

/**
 * 切换打卡状态
 * @param {string} date
 * @param {string} itemId
 * @param {boolean} completed
 * @param {{ time?: string, note?: string }} extra 打卡时间和备注（仅在变为完成时使用）
 */
export function toggleCheckin(date, itemId, completed, extra) {
  const records = getCheckinRecords();
  if (!records[date]) records[date] = {};
  if (completed) {
    records[date][itemId] = {
      completed: true,
      time: (extra && extra.time) || getNowTime(),
      note: (extra && extra.note) || '',
    };
  } else {
    records[date][itemId] = null;
  }
  safeWrite(STORAGE_KEYS.CHECKIN_RECORDS, records);
}

export function getCheckinStats(date) {
  const items = getCheckinItems();
  const record = getCheckinRecordByDate(date);
  const total = items.length;
  let completed = 0;
  items.forEach((item) => {
    const r = record[item.id];
    if (r && (r === true || (typeof r === 'object' && r.completed))) {
      completed++;
    }
  });
  return {
    completed,
    total,
    rate: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * 获取某月每日统计数据
 *
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} [itemId] 传入则只统计该打卡项目（单项目模式）。
 *   单项目模式下 total 恒为 1（项目存在时），completed 为 0 或 1；
 *   项目创建日之前的日期标记 excluded，completed/total/rate 均为 0，不计入统计。
 *   不传此参数时行为与原来完全一致。
 * @returns {Array<{date:string, completed:number, total:number, rate:number, excluded?:boolean}>}
 */
export function getMonthlyData(year, month, itemId) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const items = getCheckinItems();
  const records = getCheckinRecords();
  const today = getToday();
  const data = [];

  // 单项目模式：统计起点为项目创建日，避免把项目诞生前的日子算成「未完成」
  let sinceDate = null;
  if (itemId) {
    const target = items.find((i) => i.id === itemId);
    if (target && target.createdAt) sinceDate = target.createdAt;
  }

  const list = itemId ? items.filter((i) => i.id === itemId) : items;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (sinceDate && dateStr < sinceDate) {
      data.push({ date: dateStr, completed: 0, total: 0, rate: 0, excluded: true });
      continue;
    }

    // 分母只算「这一天已经存在的项目」，并且还没到来的日子不参与统计。
    // 口径与 getOverallStats / getItemStats 对齐：项目诞生前与未来日子都不是「未完成」，
    // 否则多项视图里晚建的项目会系统性拉低完成率（跨年视图更是把整个未来月份算成 0%）。
    const active = list.filter((i) => !i.createdAt || i.createdAt.slice(0, 10) <= dateStr);
    const total = active.length;
    if (total === 0 || dateStr > today) {
      data.push({ date: dateStr, completed: 0, total: 0, rate: 0, excluded: true });
      continue;
    }

    const record = records[dateStr] || {};
    let completed = 0;
    active.forEach((item) => {
      const r = record[item.id];
      if (r && (r === true || (typeof r === 'object' && r.completed))) {
        completed++;
      }
    });
    data.push({
      date: dateStr,
      completed,
      total,
      rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  }

  return data;
}

/**
 * 获取某季度统计数据
 * @param {number} year
 * @param {number} quarter 1-4
 * @param {string} [itemId] 传入则只统计该打卡项目
 */
export function getQuarterlyData(year, quarter, itemId) {
  const startMonth = (quarter - 1) * 3 + 1;
  let totalCompleted = 0;
  let totalItems = 0;
  const monthData = [];

  for (let m = 0; m < 3; m++) {
    const month = startMonth + m;
    const monthly = getMonthlyData(year, month, itemId);
    const monthCompleted = monthly.reduce((sum, d) => sum + d.completed, 0);
    const monthTotal = monthly.reduce((sum, d) => sum + d.total, 0);
    totalCompleted += monthCompleted;
    totalItems += monthTotal;
    monthData.push({
      month: `${year}-${String(month).padStart(2, '0')}`,
      completed: monthCompleted,
      total: monthTotal,
      rate: monthTotal > 0 ? Math.round((monthCompleted / monthTotal) * 100) : 0,
      dailyData: monthly,
    });
  }

  return {
    monthData,
    avgRate: totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0,
  };
}

/**
 * 获取某年度统计数据
 * @param {number} year
 * @param {string} [itemId] 传入则只统计该打卡项目
 */
export function getYearlyData(year, itemId) {
  const monthData = [];
  let yearCompleted = 0;
  let yearTotal = 0;

  for (let month = 1; month <= 12; month++) {
    const monthly = getMonthlyData(year, month, itemId);
    const mCompleted = monthly.reduce((sum, d) => sum + d.completed, 0);
    const mTotal = monthly.reduce((sum, d) => sum + d.total, 0);
    yearCompleted += mCompleted;
    yearTotal += mTotal;
    monthData.push({
      month: `${year}-${String(month).padStart(2, '0')}`,
      completed: mCompleted,
      total: mTotal,
      rate: mTotal > 0 ? Math.round((mCompleted / mTotal) * 100) : 0,
    });
  }

  return {
    monthData,
    avgRate: yearTotal > 0 ? Math.round((yearCompleted / yearTotal) * 100) : 0,
  };
}

/* ==================== 单项目汇总统计 ==================== */

/**
 * 单个打卡项目的汇总统计（统计区间：项目创建日 → 今天）
 *
 * 与按月的 getMonthlyData 不同，这里统计的是该项目的全生命周期：
 * 完成天数、完成率、当前连续打卡天数、历史最长连续天数。
 *
 * @param {string} itemId
 * @returns {null|{itemId:string, name:string, createdAt:string, totalDays:number,
 *   doneDays:number, missedDays:number, rate:number, currentStreak:number,
 *   longestStreak:number, firstDone:string, lastDone:string}}
 */
export function getItemStats(itemId) {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  const target = items.find((i) => i.id === itemId);
  if (!target) return null;

  const today = getToday();
  const allDates = Object.keys(records).sort();

  // 统计起点：项目创建日；缺失时回退到最早有记录的日期
  let start = target.createdAt || (allDates.length > 0 ? allDates[0] : today);
  if (start > today) start = today;

  // 安全上限：异常数据下最多回溯 10 年，避免超长循环
  const MAX_DAYS = 3660;
  const cursor = new Date(`${start}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  const earliest = new Date(end.getTime() - MAX_DAYS * 24 * 60 * 60 * 1000);
  if (cursor < earliest) cursor.setTime(earliest.getTime());

  let totalDays = 0;
  let doneDays = 0;
  let running = 0;
  let longest = 0;
  let streakEnd = '';
  // streakEnd 那一段连续的长度。必须与 streakEnd 同步保存：
  // 若今天尚未打卡，循环结束时 running 已被重置为 0，但连续段其实结束于昨天
  let streakEndRun = 0;
  let firstDone = '';
  let lastDone = '';

  while (cursor <= end) {
    const dateStr = formatDate(cursor);
    const r = records[dateStr] && records[dateStr][itemId];
    const done = !!(r && (r === true || (typeof r === 'object' && r.completed)));

    totalDays += 1;
    if (done) {
      doneDays += 1;
      running += 1;
      if (running > longest) longest = running;
      streakEnd = dateStr;
      streakEndRun = running;
      if (!firstDone) firstDone = dateStr;
      lastDone = dateStr;
    } else {
      running = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // 当前连续：连续段需结束于今天或昨天（今天还没打卡不算中断）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  const currentStreak =
    streakEnd === today || streakEnd === yesterdayStr ? streakEndRun : 0;

  return {
    itemId,
    name: target.name,
    createdAt: target.createdAt || '',
    totalDays,
    doneDays,
    missedDays: totalDays - doneDays,
    rate: totalDays > 0 ? Math.round((doneDays / totalDays) * 100) : 0,
    currentStreak,
    longestStreak: longest,
    firstDone,
    lastDone,
  };
}

/**
 * 全部项目的聚合统计（与单项目 getItemStats 同构，天级「全勤日」口径）
 *
 * 统计区间：最早项目的创建日 → 今天。每一天按「当日所有已创建项目是否全部打卡完成」
 * 判定为完成日（全勤日）或未完成日。因此：
 * - 完成天数 = 全勤天数；完成率 = 全勤率
 * - 当前连续 / 最长连续 = 连续全勤天数（结束于今天或昨天都不算中断）
 *
 * @returns {null|{itemId:null, name:'全部项目', createdAt:string, totalDays:number,
 *   doneDays:number, missedDays:number, rate:number, currentStreak:number,
 *   longestStreak:number, firstDone:string, lastDone:string}}
 */
export function getOverallStats() {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  if (items.length === 0) return null;

  const today = getToday();
  const allDates = Object.keys(records).sort();

  // 统计起点：最早项目的创建日；缺失时回退到最早有记录的日期
  let start = items.reduce(
    (m, i) => (i.createdAt && i.createdAt.slice(0, 10) < m ? i.createdAt.slice(0, 10) : m),
    allDates[0] || today,
  );
  if (!start || start > today) start = today;

  // 统计终点：今天；安全上限 10 年
  const MAX_DAYS = 3660;
  const cursor = new Date(`${start}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  const earliest = new Date(end.getTime() - MAX_DAYS * 24 * 60 * 60 * 1000);
  if (cursor < earliest) cursor.setTime(earliest.getTime());

  const isDoneDay = (dateStr) => {
    const active = items.filter((i) => !i.createdAt || i.createdAt.slice(0, 10) <= dateStr);
    if (active.length === 0) return false;
    const day = records[dateStr] || {};
    const doneCnt = active.reduce((n, i) => {
      const r = day[i.id];
      return n + (r && (r === true || (typeof r === 'object' && r.completed)) ? 1 : 0);
    }, 0);
    return doneCnt === active.length;
  };

  let totalDays = 0;
  let doneDays = 0;
  let running = 0;
  let longest = 0;
  let streakEnd = '';
  let streakEndRun = 0;
  let firstDone = '';
  let lastDone = '';

  while (cursor <= end) {
    const dateStr = formatDate(cursor);
    totalDays += 1;
    if (isDoneDay(dateStr)) {
      doneDays += 1;
      running += 1;
      if (running > longest) longest = running;
      streakEnd = dateStr;
      streakEndRun = running;
      if (!firstDone) firstDone = dateStr;
      lastDone = dateStr;
    } else {
      running = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // 当前连续：连续段结束于今天或昨天都算（今天还没打卡不算中断）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDate(yesterday);
  const currentStreak =
    streakEnd === today || streakEnd === yesterdayStr ? streakEndRun : 0;

  return {
    itemId: null,
    name: '全部项目',
    createdAt: start,
    totalDays,
    doneDays,
    missedDays: totalDays - doneDays,
    rate: totalDays > 0 ? Math.round((doneDays / totalDays) * 100) : 0,
    currentStreak,
    longestStreak: longest,
    firstDone,
    lastDone,
  };
}

/* ==================== 待办事项管理 ==================== */

export const TODO_PRIORITIES = {
  urgent_important: {
    label: '重要且紧急',
    short: 'Q1',
    color: '#f85149',
    bg: 'rgba(255, 82, 82, 0.15)',
    border: 'rgba(255, 82, 82, 0.4)',
  },
  urgent_not_important: {
    label: '紧急不重要',
    short: 'Q2',
    color: '#d29922',
    bg: 'rgba(255, 193, 7, 0.15)',
    border: 'rgba(255, 193, 7, 0.4)',
  },
  not_urgent_important: {
    label: '重要不紧急',
    short: 'Q3',
    color: '#58a6ff',
    bg: 'rgba(77, 159, 255, 0.15)',
    border: 'rgba(77, 159, 255, 0.4)',
  },
  not_urgent_not_important: {
    label: '不重要不紧急',
    short: 'Q4',
    color: '#484f58',
    bg: 'rgba(90, 90, 114, 0.15)',
    border: 'rgba(90, 90, 114, 0.4)',
  },
};

export function getTodos() {
  const todos = safeRead(STORAGE_KEYS.TODOS, []);
  return todos.sort((a, b) => {
    // 优先按 order 排序（手动拖拽排序），无 order 的按创建时间降序
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

export function addTodo(todoData) {
  const todos = getTodos();
  const desc = todoData.description || {};
  const maxOrder = todos.length > 0 ? Math.max(...todos.map((t) => t.order !== undefined ? t.order : -1)) : -1;
  const phaseArr = todoData.phases || [];
  const newTodo = {
    id: generateId(),
    title: todoData.title.trim(),
    description: {
      situation: (desc.situation || '').trim(),
      target: (desc.target || '').trim(),
      action: (desc.action || '').trim(),
      result: (desc.result || '').trim(),
    },
    createdAt: new Date().toISOString(),
    dueDate: todoData.dueDate || '',
    priority: todoData.priority || 'not_urgent_important',
    completed: false,
    completedTime: '',
    review: { keep: '', improve: '', stop: '', start: '' },
    order: maxOrder + 1,
    phases: phaseArr.length > 0 ? phaseArr.map((p) => ({
      id: p.id || generateId(),
      name: p.name.trim(),
      completed: p.completed || false,
      completedTime: p.completedTime || '',
      dueDate: p.dueDate || '',
    })) : undefined,
  };
  todos.unshift(newTodo);
  safeWrite(STORAGE_KEYS.TODOS, todos);
  return todos;
}

export function editTodo(id, updates) {
  const todos = getTodos();
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const next = { ...todos[idx], ...updates };
    if (updates.description && typeof updates.description === 'object') {
      next.description = {
        situation: (updates.description.situation || '').trim(),
        target: (updates.description.target || '').trim(),
        action: (updates.description.action || '').trim(),
        result: (updates.description.result || '').trim(),
      };
    }
    // 处理 phases 更新
    if (updates.phases !== undefined) {
      const phaseArr = updates.phases || [];
      next.phases = phaseArr.length > 0
        ? phaseArr.map((p) => ({
            id: p.id || generateId(),
            name: p.name.trim(),
            completed: p.completed || false,
            completedTime: p.completedTime || '',
            dueDate: p.dueDate || '',
          }))
        : undefined;
    }
    todos[idx] = next;
    safeWrite(STORAGE_KEYS.TODOS, todos);
  }
  return todos;
}

/**
 * 切换待办完成状态
 * @param {string} id
 * @param {{ completedTime?: string, review?: { keep, improve, stop, start } }} extra 完成时填写
 */
export function toggleTodo(id, extra) {
  const todos = getTodos();
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const t = todos[idx];
    t.completed = !t.completed;
    if (t.completed) {
      t.completedTime = (extra && extra.completedTime) || getNowTime();
      t.review = {
        keep: (extra && extra.review && extra.review.keep) || '',
        improve: (extra && extra.review && extra.review.improve) || '',
        stop: (extra && extra.review && extra.review.stop) || '',
        start: (extra && extra.review && extra.review.start) || '',
      };
    } else {
      // 取消完成时清空
      t.completedTime = '';
      t.review = { keep: '', improve: '', stop: '', start: '' };
    }
    safeWrite(STORAGE_KEYS.TODOS, todos);
  }
  return todos;
}

export function deleteTodo(id) {
  const todos = getTodos().filter((t) => t.id !== id);
  // 重新赋予 order（保持连续）
  todos.forEach((t, idx) => { t.order = idx; });
  safeWrite(STORAGE_KEYS.TODOS, todos);
  return todos;
}

/**
 * 重新排序待办事项
 * @param {Array<string>} reorderedIds 按新顺序排列的 ID 数组
 */
export function reorderTodos(reorderedIds) {
  const todos = getTodos();
  const map = {};
  todos.forEach((t) => { map[t.id] = t; });
  const reordered = reorderedIds
    .filter((id) => map[id])
    .map((id, idx) => { map[id].order = idx; return map[id]; });
  safeWrite(STORAGE_KEYS.TODOS, reordered);
  return reordered;
}

export { generateId, getToday, formatDate, getCurrentMonth, getNowTime };

/**
 * 切换待办事项中某个阶段的完成状态
 * @param {string} todoId
 * @param {string} phaseId
 * @returns {Array} 更新后的 todos
 */
export function toggleTodoPhase(todoId, phaseId) {
  const todos = getTodos();
  const todo = todos.find(t => t.id === todoId);
  if (!todo || !todo.phases) return todos;
  const phase = todo.phases.find(p => p.id === phaseId);
  if (!phase) return todos;
  phase.completed = !phase.completed;
  phase.completedTime = phase.completed ? getNowTime() : '';
  safeWrite(STORAGE_KEYS.TODOS, todos);
  return todos;
}

/* ==================== 批量导出 / 导入 ==================== */

/**
 * 归一化一条打卡记录值
 * 未完成（null / false）返回 null，表示无需写入
 */
function normalizeRecordValue(v) {
  if (v === true) return { completed: true, time: '', note: '' };
  if (!v || typeof v !== 'object') return null;
  if (v.completed === false) return null;
  return {
    completed: true,
    time: typeof v.time === 'string' ? v.time : '',
    note: typeof v.note === 'string' ? v.note : '',
  };
}

/**
 * 归一化一条待办数据（补齐缺失字段，保证结构合法）
 */
function normalizeTodo(t) {
  if (!t || typeof t !== 'object') return null;
  const title = (t.title || '').trim();
  if (!title) return null;

  const rawDesc = t.description;
  let desc;
  if (typeof rawDesc === 'string') {
    desc = { situation: rawDesc, target: '', action: '', result: '' };
  } else {
    const d = rawDesc && typeof rawDesc === 'object' ? rawDesc : {};
    desc = {
      situation: d.situation || '',
      target: d.target || '',
      action: d.action || '',
      result: d.result || '',
    };
  }

  const r = t.review && typeof t.review === 'object' ? t.review : {};
  const priority = VALID_PRIORITIES.includes(t.priority)
    ? t.priority
    : 'not_urgent_important';

  const phases = Array.isArray(t.phases) && t.phases.length > 0
    ? t.phases
        .filter((p) => p && String(p.name || '').trim())
        .map((p) => ({
          id: p.id || generateId(),
          name: String(p.name).trim(),
          completed: !!p.completed,
          completedTime: p.completedTime || '',
          dueDate: p.dueDate || '',
        }))
    : undefined;

  const normalized = {
    id: t.id || generateId(),
    title,
    description: desc,
    createdAt: t.createdAt || new Date().toISOString(),
    dueDate: t.dueDate || '',
    priority,
    completed: !!t.completed,
    completedTime: t.completedTime || '',
    review: {
      keep: r.keep || '',
      improve: r.improve || '',
      stop: r.stop || '',
      start: r.start || '',
    },
    order: typeof t.order === 'number' ? t.order : undefined,
  };
  if (phases) normalized.phases = phases;
  return normalized;
}

/**
 * 读取全部数据（备份用）
 */
export function getAllData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportDate: new Date().toISOString(),
    items: getCheckinItems(),
    records: getCheckinRecords(),
    todos: getTodos(),
    quickNotes: getAllQuickNotes(),
  };
}

/* ==================== 临时任务（按天手动记录） ==================== */

/**
 * 结构：{ 'YYYY-MM-DD': [{ id, text, done, createdAt, doneAt }] }
 * 新增这个键不需要动 SCHEMA_VERSION / migrateIfNeeded：老数据里没有它，读取时归一化即为空。
 * 但读取一律过一次 normalize：这份数据可能来自另一台设备的快照或手工编辑过的备份，
 * 缺字段、类型不对要在边界上修掉，而不是带进界面。
 */
function normalizeQuickNote(n) {
  if (!n || typeof n !== 'object') return null;
  const text = String(n.text == null ? '' : n.text).trim();
  if (!text) return null;
  const done = !!n.done;
  return {
    id: n.id || generateId(),
    text: text.slice(0, 200),
    done,
    createdAt: n.createdAt || '',
    doneAt: done ? n.doneAt || '' : '',
  };
}

function normalizeQuickNotes(raw) {
  const out = {};
  const map = raw && typeof raw === 'object' ? raw : {};
  Object.keys(map).forEach((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const arr = Array.isArray(map[date]) ? map[date] : [];
    const cleaned = arr.map(normalizeQuickNote).filter(Boolean);
    if (cleaned.length > 0) out[date] = cleaned;
  });
  return out;
}

/** 某天的临时任务，按录入顺序 */
export function getQuickNotes(dateStr) {
  const all = normalizeQuickNotes(safeRead(STORAGE_KEYS.QUICK_NOTES, {}));
  return all[dateStr] || [];
}

/** 全部临时任务（键为日期），快照与统计用 */
export function getAllQuickNotes() {
  return normalizeQuickNotes(safeRead(STORAGE_KEYS.QUICK_NOTES, {}));
}

/** 新增一条，返回该日期最新列表；日期非法或内容为空则不写 */
export function addQuickNote(dateStr, text) {
  const content = String(text == null ? '' : text).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr)) || !content) return [];
  const all = getAllQuickNotes();
  const day = Array.isArray(all[dateStr]) ? all[dateStr] : [];
  day.push({
    id: generateId(),
    text: content.slice(0, 200),
    done: false,
    createdAt: new Date().toISOString(),
    doneAt: '',
  });
  all[dateStr] = day;
  safeWrite(STORAGE_KEYS.QUICK_NOTES, all);
  return all[dateStr];
}

/** 勾选 / 取消勾选：完成时记下时间，取消时清空 */
export function toggleQuickNote(dateStr, id) {
  const all = getAllQuickNotes();
  const day = Array.isArray(all[dateStr]) ? all[dateStr] : [];
  const next = day.map((n) => (n.id === id
    ? { ...n, done: !n.done, doneAt: !n.done ? getNowTime() : '' }
    : n));
  if (next.length > 0) all[dateStr] = next;
  safeWrite(STORAGE_KEYS.QUICK_NOTES, all);
  return next;
}

/** 删除一条；该日清空后不留空数组键 */
export function deleteQuickNote(dateStr, id) {
  const all = getAllQuickNotes();
  const day = Array.isArray(all[dateStr]) ? all[dateStr] : [];
  const next = day.filter((n) => n.id !== id);
  if (next.length > 0) all[dateStr] = next;
  else delete all[dateStr];
  safeWrite(STORAGE_KEYS.QUICK_NOTES, all);
  return next;
}

/* ==================== 快照（桌面版落盘 / 云端同步的载荷） ==================== */

/** 组装当前 localStorage 里的全量快照；updatedAt 是同步比对的依据 */
export function buildSnapshot() {
  const snap = getAllData();
  return { ...snap, updatedAt: snap.exportDate };
}

/**
 * 把一份快照直写进 localStorage，并且**不**通知订阅者：
 * 启动回填时文件已是权威数据，云端拉取时主进程也已写好文件，
 * 再触发一次落盘只会把刚下载的数据用新时间戳回写、引发多余推送。
 * @returns {boolean} 是否应用成功
 */
export function applySnapshot(snap) {
  if (!snap || !snap.exportDate) return false;
  try {
    localStorage.setItem(STORAGE_KEYS.CHECKIN_ITEMS, JSON.stringify(Array.isArray(snap.items) ? snap.items : []));
    localStorage.setItem(STORAGE_KEYS.CHECKIN_RECORDS, JSON.stringify(snap.records && typeof snap.records === 'object' ? snap.records : {}));
    localStorage.setItem(STORAGE_KEYS.TODOS, JSON.stringify(Array.isArray(snap.todos) ? snap.todos : []));
    // 老版本快照里没有这一项，同样要写成空：回填是「整份替换」，留旧值会让界面显示不属于这份数据的内容
    localStorage.setItem(STORAGE_KEYS.QUICK_NOTES, JSON.stringify(normalizeQuickNotes(snap.quickNotes)));
    localStorage.setItem(STORAGE_KEYS.SCHEMA_VERSION, String(snap.schemaVersion || SCHEMA_VERSION));
    return true;
  } catch (e) {
    console.error('applySnapshot failed:', e);
    return false;
  }
}

/**
 * 批量写入数据
 *
 * 去重规则：
 * - 打卡项目：按名称，已存在则保留本地
 * - 打卡记录：按 日期 + 项目（id 或名称），已存在则保留本地
 * - 待办：按 id 或 标题 + 创建日期，已存在则保留本地
 *
 * @param {{items?:Array, records?:Object, todos?:Array}} data
 * @param {'merge'|'replace'} mode merge=只补缺失（安全）；replace=清空后重建
 * @returns {{items:Object, records:Object, todos:Object}} 各类新增/跳过统计
 */
export function setAllData(data, mode = 'merge') {
  const stats = {
    items: { added: 0, kept: 0 },
    records: { added: 0, skipped: 0 },
    todos: { added: 0, skipped: 0 },
    quickNotes: { added: 0, skipped: 0 },
  };

  const incoming = data || {};
  const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
  const incomingRecords =
    incoming.records && typeof incoming.records === 'object' ? incoming.records : {};
  const incomingTodos = Array.isArray(incoming.todos) ? incoming.todos : [];
  const incomingNotes = normalizeQuickNotes(incoming.quickNotes);

  const replace = mode === 'replace';
  const items = replace ? [] : [...getCheckinItems()];
  const records = replace ? {} : { ...getCheckinRecords() };
  const todos = replace ? [] : [...getTodos()];
  const quickNotes = replace ? {} : getAllQuickNotes();

  /* ---- 打卡项目：按名称去重 ---- */
  const nameToId = {};
  items.forEach((i) => { nameToId[i.name] = i.id; });

  incomingItems.forEach((src) => {
    const name = (src && src.name ? String(src.name) : '').trim();
    if (!name) return;
    if (nameToId[name]) {
      stats.items.kept++;
      return;
    }
    let id = src.id || generateId();
    if (items.some((i) => i.id === id)) id = generateId();
    items.push({
      id,
      name,
      createdAt: src.createdAt || getToday(),
      order: items.length,
    });
    nameToId[name] = id;
    stats.items.added++;
  });
  items.forEach((i, idx) => { i.order = idx; });

  /* ---- 打卡记录：按 日期 + 项目 去重 ---- */
  Object.keys(incomingRecords).forEach((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const day = incomingRecords[date];
    if (!day || typeof day !== 'object') return;

    if (!records[date]) records[date] = {};

    Object.keys(day).forEach((key) => {
      let itemId = key;
      if (!items.some((i) => i.id === itemId)) {
        const hit = items.find((i) => i.name === key);
        if (!hit) return;
        itemId = hit.id;
      }
      const value = normalizeRecordValue(day[key]);
      if (!value) return;
      if (records[date][itemId]) {
        stats.records.skipped++;
        return;
      }
      records[date][itemId] = value;
      stats.records.added++;
    });
  });

  /* ---- 待办：按 id 或 标题+创建日期 去重 ---- */
  const todoKey = (t) => `${t.title.trim()}|${String(t.createdAt || '').slice(0, 10)}`;
  const existingKeys = {};
  todos.forEach((t) => { existingKeys[todoKey(t)] = t; });

  incomingTodos.forEach((src) => {
    const t = normalizeTodo(src);
    if (!t) return;
    const found = todos.find((x) => x.id === t.id) || existingKeys[todoKey(t)];
    if (found) {
      stats.todos.skipped++;
      return;
    }
    if (t.order === undefined) t.order = todos.length;
    if (todos.some((x) => x.id === t.id)) t.id = generateId();
    todos.push(t);
    existingKeys[todoKey(t)] = t;
    stats.todos.added++;
  });
  todos.forEach((t, idx) => { t.order = idx; });

  /* ---- 临时任务：按 日期 + 内容 去重，同一天同一句话只留一条 ---- */
  const noteIdTaken = (id) => Object.keys(quickNotes).some((d) => quickNotes[d].some((n) => n.id === id));
  Object.keys(incomingNotes).forEach((date) => {
    const day = Array.isArray(quickNotes[date]) ? quickNotes[date] : [];
    incomingNotes[date].forEach((src) => {
      if (day.some((n) => n.text === src.text || n.id === src.id)) {
        stats.quickNotes.skipped++;
        return;
      }
      day.push(noteIdTaken(src.id) ? { ...src, id: generateId() } : src);
      stats.quickNotes.added++;
    });
    if (day.length > 0) quickNotes[date] = day;
  });

  safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);
  safeWrite(STORAGE_KEYS.CHECKIN_RECORDS, records);
  safeWrite(STORAGE_KEYS.TODOS, todos);
  safeWrite(STORAGE_KEYS.QUICK_NOTES, quickNotes);
  safeWrite(STORAGE_KEYS.SCHEMA_VERSION, SCHEMA_VERSION);

  return stats;
}

export { normalizeTodo, normalizeRecordValue };
