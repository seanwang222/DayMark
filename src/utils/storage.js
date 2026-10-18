/**
 * LocalStorage 读写工具
 * 提供打卡项目、打卡记录、待办事项的 CRUD 操作
 * - 打卡记录：{ completed, time, note }
 * - 待办描述：STAR 法则 { situation, target, action, result }
 * - 待办优先级：四象限 urgent_important / urgent_not_important / not_urgent_important / not_urgent_not_important
 * - 待办完成：{ completedTime, review: { keep, improve, stop, start } }
 * - 临时任务：按天存 { 'YYYY-MM-DD': [{ id, text, done, createdAt, doneAt }] }
 * - 归档：打卡项与待办共用同一份数组，归档只是加 { archived: true, archivedAt: 'YYYY-MM-DD' } 两个字段。
 *   不另开存储键，是为了让打卡记录始终挂在同一个 itemId 上——恢复归档即恢复全部历史，
 *   统计也能按「在册区间」（创建日 → 归档日前一天）继续算旧账。
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
 * 今天到期（daysLeft === 0）同样不进提醒：日程页右栏的「行动」当天已经列出了这些行动，
 * 在同一屏里再抄一遍只会让同一件事占两行，还会把真正需要往前看的项挤出视野。
 *
 * 已完成项去不去列表，看的是「什么时候勾的」，不是「勾没勾」：
 * - **计划完成日当天或之前勾掉的**（按时、提前）→ 留在列表里，由界面划掉变灰，
 *   作为最近做完了什么的回看；但同样只向前看 withinDays 天，更早的成功不必一直占位。
 * - **计划完成日之后才勾掉的**（逾期后补做）→ 直接不显示。提醒负责「还没做」，
 *   一次迟到的补做既不该继续标红「已逾期」，也不该在灰色里长期留痕。
 * - 完成日期来自 `phase.completedAt`（1.1.4 起由 toggleTodoPhase 写入）。1.1.4 之前
 *   的数据与旧备份没有它，无法判断是否补做，一律退回上面第一条的窗口规则。
 *
 * `overdue` 只描述截止日与今天的关系（已完成项也可能曾经逾期），状态一律读 `phase.completed`。
 * @returns {Array<{todo:Object, phase:Object, dueDate:string, daysLeft:number, overdue:boolean}>}
 */
export function getUpcomingPhases(withinDays = 7, todayStr = getToday()) {
  const out = [];
  getActiveTodos().forEach((todo) => {
    if (todo.completed) return;
    (todo.phases || []).forEach((phase) => {
      if (!phase.dueDate) return;
      const daysLeft = daysBetween(todayStr, phase.dueDate);
      if (daysLeft === 0 || daysLeft > withinDays) return;
      if (phase.completed) {
        if (phase.completedAt && String(phase.completedAt) > String(phase.dueDate)) return;
        if (daysLeft < -withinDays) return;
      }
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
 * 是否已归档。只认真值，老数据里根本没有这个字段（undefined）即「未归档」，
 * 因此新增归档不需要动 SCHEMA_VERSION。
 */
function isArchived(entry) {
  return !!(entry && entry.archived);
}

/** 合法的归档日期字符串；非法值一律归零，避免脏数据把统计区间带歪 */
function normalizeArchivedAt(v) {
  const s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/**
 * 打卡项在某一天是否「在册」——所有统计口径的唯一入口。
 * 与「项目诞生前不算未完成」对称：归档日及之后也不算未完成，那天的任务已经交接掉了。
 * 已归档但没有归档日期（外来的脏数据）按「全程不在册」处理，宁可少算也不凭空拉低完成率。
 */
export function isItemActiveOn(item, dateStr) {
  if (!item) return false;
  const created = item.createdAt ? String(item.createdAt).slice(0, 10) : '';
  if (created && String(dateStr) < created) return false;
  if (isArchived(item)) {
    const ended = normalizeArchivedAt(item.archivedAt);
    if (!ended || String(dateStr) >= ended) return false;
  }
  return true;
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

/** 界面上可见的打卡项（未归档）：列表、今日分母、统计与筛选下拉都从这里取 */
export function getActiveCheckinItems() {
  return getCheckinItems().filter((item) => !isArchived(item));
}

/** 已归档的打卡项：最近归档的排前面，只在「数据管理 → 归档」里出现 */
export function getArchivedCheckinItems() {
  return getCheckinItems()
    .filter(isArchived)
    .sort(
      (a, b) =>
        String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')) ||
        (a.order || 0) - (b.order || 0),
    );
}

/** 归档一个打卡项：归档日就是它「在册区间」的终点（当天起不再参与统计） */
export function archiveCheckinItem(id) {
  const items = getCheckinItems();
  const idx = items.findIndex((item) => item.id === id);
  if (idx !== -1) {
    items[idx] = { ...items[idx], archived: true, archivedAt: getToday() };
    safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);
  }
  return items;
}

/** 取消归档：整体删掉两个字段，让恢复后的项目与从未归档过完全等价（历史记录一直还在） */
export function unarchiveCheckinItem(id) {
  const items = getCheckinItems();
  const idx = items.findIndex((item) => item.id === id);
  if (idx !== -1) {
    const next = { ...items[idx] };
    delete next.archived;
    delete next.archivedAt;
    items[idx] = next;
    safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, items);
  }
  return items;
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
 *
 * 界面只会把「当前可见」的 id 传进来（归档项、被筛掉的项都不在里面），
 * 所以这里不能拿 reorderedIds 直接当成整份数组写回——那等于一次拖拽就把没点到的条目从存储里抹掉。
 * 规则：先按传入顺序排，再把没被点到的按原顺序追加，最后统一重排 order。返回值是完整数组（含归档项）。
 * @param {Array<string>} reorderedIds 按新顺序排列的 ID 数组
 */
export function reorderCheckinItems(reorderedIds) {
  const all = getCheckinItems();
  const map = {};
  all.forEach((item) => { map[item.id] = item; });
  const seen = {};
  const ordered = [];
  reorderedIds.forEach((id) => {
    if (!map[id] || seen[id]) return;
    seen[id] = true;
    ordered.push(map[id]);
  });
  all.forEach((item) => { if (!seen[item.id]) ordered.push(item); });
  ordered.forEach((item, idx) => { item.order = idx; });
  safeWrite(STORAGE_KEYS.CHECKIN_ITEMS, ordered);
  return ordered;
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

/**
 * 某日的「完成 x / 分母 y」。分母用 isItemActiveOn 逐日判定，而不是简单取当前可见项：
 * 这一格在界面上可以翻到过去某天，那天在册的项目（含后来才被归档的）当年确实要打卡，
 * 而那天还没创建或已归档的项目不该被算成未完成。
 */
export function getCheckinStats(date) {
  const items = getCheckinItems().filter((i) => isItemActiveOn(i, date));
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

    // 分母只算「这一天在册的项目」，并且还没到来的日子不参与统计。
    // 在册 = 已创建 且 未归档（isItemActiveOn：创建日 ≤ 当天 < 归档日），
    // 口径与 getCheckinStats / getOverallStats / getItemStats 完全对齐：
    // 项目诞生前、归档日及以后与未来日子都不是「未完成」，否则晚建的项目会系统性拉低完成率
    // （跨年视图更是把整个未来月份算成 0%），归档掉的项目会把往年月份的数字追溯改写。
    const active = list.filter((i) => isItemActiveOn(i, dateStr));
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

/* ==================== 汇总统计（按区间） ==================== */

const pad2 = (n) => String(n).padStart(2, '0');

/** 某年某月（1-12）的最后一天 */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 月度 / 季度 / 年度视图对应的统计区间（首尾都含，YYYY-MM-DD）。
 * 这里只回答「看哪一段」，是否超出今天由 statsFromRange 裁剪。
 *
 * dayBasis 决定「分母是谁的天数」：
 * - `period`（季度 / 年度）：分母 = 这段区间**已经过去的天数**，不与项目的在册区间求交。
 *   看第三季度就该按 92 天衡量，而不是只按项目恰好诞生的那 30 天——否则季度视图的分母
 *   会被创建日、归档日裁成一小截，读起来跟月度视图没区别。代价是晚建的项目要背上
 *   「这个季度已经过去的日子」，完成率会低于按在册天数算的那一份。
 * - `active`（月度）：沿用「当天在册才参与」的口径，项目诞生前、归档日及以后整天跳过，
 *   不把一个还没出现的项目算成「这个月没打卡」。
 *
 * @param {'monthly'|'quarterly'|'yearly'} view
 */
export function getViewRange(view, year, month, quarter) {
  if (view === 'yearly') {
    return { start: `${year}-01-01`, end: `${year}-12-31`, dayBasis: 'period' };
  }
  if (view === 'quarterly') {
    const first = (quarter - 1) * 3 + 1;
    return {
      start: `${year}-${pad2(first)}-01`,
      end: `${year}-${pad2(first + 2)}-${pad2(lastDayOfMonth(year, first + 2))}`,
      dayBasis: 'period',
    };
  }
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
    dayBasis: 'active',
  };
}

/**
 * 逐日走一遍统计区间，产出「完成天数 / 完成率 / 当前连续 / 最长连续」。
 *
 * 全应用唯一的汇总统计实现：单项目与全部项目、月度/季度/年度都经由这里，
 * 界面只负责显示——避免出现「月历一套口径、汇总一套口径」那种错得很安静的分裂。
 *
 * classify(dateStr) → 'done' | 'miss' | 'skip'。skip 的那天整天不参与：
 * 既不进分母，也不把连续段打断。「项目还没创建 / 已经归档」算不算 skip 由调用方按
 * getViewRange 的 dayBasis 决定（月度算、季度与年度不算），本函数只管走日子。
 * 结束日一律裁剪到今天，未来的日子不配拉低完成率。
 */
function statsFromRange(startStr, endStr, classify, meta) {
  const today = getToday();
  let start = startStr || today;
  const end = endStr && endStr <= today ? endStr : today;

  // 区间整体落在未来（或起点晚于终点）：没有任何可统计的日子
  if (start > end) {
    return {
      ...meta,
      empty: true,
      rangeStart: '',
      rangeEnd: '',
      totalDays: 0,
      doneDays: 0,
      missedDays: 0,
      rate: 0,
      currentStreak: 0,
      longestStreak: 0,
      firstDone: '',
      lastDone: '',
    };
  }

  // 安全上限：异常数据下最多回溯 10 年，避免超长循环
  const MAX_DAYS = 3660;
  const endDay = new Date(`${end}T00:00:00`);
  const floor = new Date(endDay.getTime());
  floor.setDate(floor.getDate() - MAX_DAYS);
  let cursor = new Date(`${start}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || cursor < floor) cursor = floor;
  start = formatDate(cursor);

  let totalDays = 0;
  let doneDays = 0;
  let running = 0;
  let longest = 0;
  let streakEnd = '';
  // streakEnd 那一段连续的长度。必须与 streakEnd 同步保存：
  // 若区间末当天尚未打卡，循环结束时 running 已被重置为 0，但连续段其实结束于前一天
  let streakEndRun = 0;
  let firstDone = '';
  let lastDone = '';

  while (cursor <= endDay) {
    const dateStr = formatDate(cursor);
    const kind = classify(dateStr);
    if (kind !== 'skip') {
      totalDays += 1;
      if (kind === 'done') {
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
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // 当前连续：连续段需结束于区间末，或区间末的前一天（当天还没打卡不算中断）
  const prevDay = new Date(endDay);
  prevDay.setDate(prevDay.getDate() - 1);
  const currentStreak =
    streakEnd === end || streakEnd === formatDate(prevDay) ? streakEndRun : 0;

  return {
    ...meta,
    empty: totalDays === 0,
    rangeStart: start,
    rangeEnd: end,
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

/** 打卡记录值是否表示已完成（兼容历史遗留的 boolean 形态） */
function isRecordDone(v) {
  return !!(v && (v === true || (typeof v === 'object' && v.completed)));
}

/**
 * 单个打卡项目的汇总统计
 *
 * @param {string} itemId
 * @param {{start?:string, end?:string, dayBasis?:'active'|'period'}} [range] 统计区间
 *   （月度 / 季度 / 年度视图由 getViewRange 给出）。不传即全生命周期（创建日 → 今天）。
 *   `dayBasis:'active'`（月度与默认）会与项目的「在册区间」求交：创建日之前、归档日及以后
 *   都不参与，因此切换视图不会追溯改写历史月份的数字。
 *   `dayBasis:'period'`（季度 / 年度）从区间首日开始，在册与否都进分母，
 *   分母就是「这段区间已经过去多少天」。
 * @returns {null|{itemId:string, name:string, createdAt:string, empty:boolean,
 *   rangeStart:string, rangeEnd:string, totalDays:number, doneDays:number, missedDays:number,
 *   rate:number, currentStreak:number, longestStreak:number, firstDone:string, lastDone:string}}
 */
export function getItemStats(itemId, range) {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  const target = items.find((i) => i.id === itemId);
  if (!target) return null;

  const periodDays = !!(range && range.dayBasis === 'period');
  const created = target.createdAt ? String(target.createdAt).slice(0, 10) : '';
  const allDates = Object.keys(records).sort();
  const lifeStart = created || (allDates.length > 0 ? allDates[0] : getToday());
  const start = periodDays && range.start
    ? range.start
    : (range && range.start && range.start > lifeStart ? range.start : lifeStart);
  const end = range && range.end ? range.end : getToday();

  return statsFromRange(
    start,
    end,
    (dateStr) => {
      // period 基数下「不在册」不再是跳过的理由：那天确实过去了，只是没达成
      if (!periodDays && !isItemActiveOn(target, dateStr)) return 'skip';
      return isRecordDone(records[dateStr] && records[dateStr][itemId]) ? 'done' : 'miss';
    },
    { itemId, name: target.name, createdAt: target.createdAt || '' },
  );
}

/**
 * 全部项目的聚合统计（与单项目 getItemStats 同构，天级「全勤日」口径）
 *
 * 每一天按「当日在册（已创建且未归档）的项目是否全部打卡完成」判定为完成日（全勤日）或未完成日。
 * 某天没有任何在册项目时，月度口径下整天不参与、也不打断连续段；季度 / 年度的 period 口径下
 * 记为「这天没达成」。因此：
 * - 完成天数 = 全勤天数；完成率 = 全勤率
 * - 当前连续 / 最长连续 = 连续全勤天数（结束于区间末或其前一天都不算中断）
 *
 * @param {{start?:string, end?:string, dayBasis?:'active'|'period'}} [range] 同 getItemStats，
 *   不传即全生命周期。`dayBasis:'period'` 时某天没有任何在册项目也算「这一天没达成」，
 *   分母仍是区间已过去的天数；`active` 时那样的日子整天跳过，既不进分母也不打断连续段。
 * @returns {null|{itemId:null, name:'全部项目', createdAt:string, empty:boolean,
 *   rangeStart:string, rangeEnd:string, totalDays:number, doneDays:number, missedDays:number,
 *   rate:number, currentStreak:number, longestStreak:number, firstDone:string, lastDone:string}}
 */
export function getOverallStats(range) {
  const items = getCheckinItems();
  const records = getCheckinRecords();
  if (items.length === 0) return null;

  const periodDays = !!(range && range.dayBasis === 'period');
  const today = getToday();
  const allDates = Object.keys(records).sort();

  // 统计起点：最早项目的创建日；缺失时回退到最早有记录的日期
  const earliestCreated = items.reduce(
    (m, i) => (i.createdAt && String(i.createdAt).slice(0, 10) < m
      ? String(i.createdAt).slice(0, 10)
      : m),
    allDates[0] || today,
  );
  const start = periodDays && range.start
    ? range.start
    : (range && range.start && range.start > earliestCreated
      ? range.start
      : earliestCreated || today);
  const end = range && range.end ? range.end : today;

  return statsFromRange(
    start,
    end,
    (dateStr) => {
      const active = items.filter((i) => isItemActiveOn(i, dateStr));
      if (active.length === 0) return periodDays ? 'miss' : 'skip';
      const day = records[dateStr] || {};
      const doneCnt = active.reduce((n, i) => n + (isRecordDone(day[i.id]) ? 1 : 0), 0);
      return doneCnt === active.length ? 'done' : 'miss';
    },
    { itemId: null, name: '全部项目', createdAt: earliestCreated || '' },
  );
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

/** 界面上可见的待办（未归档）：列表、四象限、计数与提醒都从这里取 */
export function getActiveTodos() {
  return getTodos().filter((t) => !isArchived(t));
}

/** 已归档的待办：最近归档的排前面，只在「数据管理 → 归档」里出现 */
export function getArchivedTodos() {
  return getTodos()
    .filter(isArchived)
    .sort(
      (a, b) =>
        String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')) ||
        (a.order || 0) - (b.order || 0),
    );
}

/** 归档一条待办： STAR 描述、行动清单与复盘全部原样保留，只是不再出现在界面上 */
export function archiveTodo(id) {
  const todos = getTodos();
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) {
    todos[idx] = { ...todos[idx], archived: true, archivedAt: getToday() };
    safeWrite(STORAGE_KEYS.TODOS, todos);
  }
  return todos;
}

/** 取消归档：整体删掉归档字段，恢复后与从未归档过完全等价 */
export function unarchiveTodo(id) {
  const todos = getTodos();
  const idx = todos.findIndex((t) => t.id === id);
  if (idx !== -1) {
    const next = { ...todos[idx] };
    delete next.archived;
    delete next.archivedAt;
    todos[idx] = next;
    safeWrite(STORAGE_KEYS.TODOS, todos);
  }
  return todos;
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
      completedAt: p.completedAt || '',
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
            completedAt: p.completedAt || '',
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
 *
 * 与 reorderCheckinItems 同一条护栏：界面传入的只是「当前可见」的 id（归档项不在其中），
 * 直接把这份 id 列表当成整组待办写回，一次拖拽就会把没点到的条目从存储里抹掉。
 * 返回值是完整数组（含归档项）。
 * @param {Array<string>} reorderedIds 按新顺序排列的 ID 数组
 */
export function reorderTodos(reorderedIds) {
  const all = getTodos();
  const map = {};
  all.forEach((t) => { map[t.id] = t; });
  const seen = {};
  const ordered = [];
  reorderedIds.forEach((id) => {
    if (!map[id] || seen[id]) return;
    seen[id] = true;
    ordered.push(map[id]);
  });
  all.forEach((t) => { if (!seen[t.id]) ordered.push(t); });
  ordered.forEach((t, idx) => { t.order = idx; });
  safeWrite(STORAGE_KEYS.TODOS, ordered);
  return ordered;
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
  // 提醒要分得清「按时完成」与「逾期后补做」，光有 HH:mm 不够，必须记下勾掉的那一天。
  // 取消完成一律归零（不是 delete）：这个字段本来就总写，留空即「不知道完成于哪天」。
  phase.completedAt = phase.completed ? getToday() : '';
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
          // 1.1.4 起行动项记「完成于哪天」，用于区分按时完成与逾期补做；
          // 老数据与旧备份没有这个字段 → 归一为 ''，由调用方按「不知道」处理
          completedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(p.completedAt || '').slice(0, 10))
            ? String(p.completedAt).slice(0, 10)
            : '',
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
  // 归档状态必须一起归一化：白名单重建对象的后果是「没列出的字段会被静默丢弃」，
  // 少这一句就从备份里恢复的归档项会变成未归档，直接冒出来污染界面。
  const archivedAt = normalizeArchivedAt(t.archivedAt);
  if (t.archived === true || archivedAt) {
    normalized.archived = true;
    normalized.archivedAt = archivedAt;
  }
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
    const srcArchivedAt = normalizeArchivedAt(src && src.archivedAt);
    const nextItem = {
      id,
      name,
      createdAt: src.createdAt || getToday(),
      order: items.length,
    };
    // 归档标记要跟着备份走：漏掉的话「导出 → 恢复」会把已归档的项目放回界面
    if (src.archived === true || srcArchivedAt) {
      nextItem.archived = true;
      nextItem.archivedAt = srcArchivedAt;
    }
    items.push(nextItem);
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
