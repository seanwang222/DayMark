/**
 * 临时验证脚本：CSV / JSON 备份往返一致性
 * 用法: node .workbuddy/verify-backup.mjs
 */
import assert from 'node:assert/strict';

/* ---- mock 浏览器环境 ---- */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const storage = await import('../src/utils/storage.js');
const backup = await import('../src/utils/backup.js');

const {
  addCheckinItem, toggleCheckin, addTodo, toggleTodo, toggleTodoPhase,
  getCheckinItems, getCheckinRecords, getTodos, getAllData,
  addQuickNote, toggleQuickNote, getAllQuickNotes,
  archiveCheckinItem, unarchiveCheckinItem, archiveTodo, unarchiveTodo,
  getActiveCheckinItems, getArchivedCheckinItems, getActiveTodos, getArchivedTodos,
  getCheckinStats, getToday,
} = storage;

/* ---- 工具 ---- */
/** 临时任务的可比较形态：不带 id（CSV 里没有 id，恢复时会新生成） */
function notesComparable(map) {
  const out = {};
  Object.keys(map || {}).sort().forEach((date) => {
    out[date] = (map[date] || [])
      .slice()
      .sort((a, b) => a.text.localeCompare(b.text))
      .map((n) => ({ text: n.text, done: !!n.done, doneAt: n.done ? n.doneAt : '' }));
  });
  return out;
}
function recordsByName(records, items) {
  const nameOf = {};
  items.forEach((i) => { nameOf[i.id] = i.name; });
  const out = {};
  Object.keys(records).forEach((date) => {
    out[date] = {};
    Object.keys(records[date] || {}).forEach((id) => {
      const v = records[date][id];
      if (!v || v === false) return;
      if (v !== true && v.completed === false) return;
      out[date][nameOf[id] || id] = { time: v.time || '', note: v.note || '' };
    });
  });
  return out;
}

function todosComparable(todos) {
  return [...todos]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => ({
      title: t.title,
      description: t.description,
      priority: t.priority,
      completed: t.completed,
      completedTime: t.completedTime,
      dueDate: t.dueDate,
      review: t.review,
      phases: (t.phases || []).map((p) => ({
        name: p.name,
        completed: p.completed,
        completedTime: p.completed ? p.completedTime : '',
        // 完成日期决定「按时做完」还是「逾期补做」，导出→恢复丢了它，
        // 一条本该退出提醒的补做就会重新变成灰色的按时完成
        completedAt: p.completed ? (p.completedAt || '') : '',
      })),
    }));
}

/* ---- 1. 造数据 ---- */
addCheckinItem('晨跑');
addCheckinItem('读书');
addCheckinItem('喝水');
const items = getCheckinItems();
const [A, B, C] = items;

toggleCheckin('2026-08-01', A.id, true, { time: '07:30', note: '状态不错' });
toggleCheckin('2026-08-01', B.id, true, { time: '22:00', note: '含逗号, 引号" 与\n换行' });
toggleCheckin('2026-08-02', A.id, true, { time: '07:45', note: '' });
toggleCheckin('2026-08-02', C.id, false); // 未完成，不应出现在导出中

addTodo({
  title: '完成周报',
  description: { situation: '月底临近', target: '按时提交', action: '整理数据', result: '已提交' },
  priority: 'urgent_important',
  dueDate: '2026-08-30',
  phases: [{ name: '收集数据', completed: false }, { name: '撰写正文', completed: false }],
});
addTodo({
  title: '健身计划',
  description: { situation: '体能下降' },
  priority: 'not_urgent_not_important',
});

const todos = getTodos();
const weekly = todos.find((t) => t.title === '完成周报');
toggleTodo(weekly.id, {
  completedTime: '18:00',
  review: { keep: '早起', improve: '排期', stop: '熬夜', start: '复盘' },
});
// 勾选第一个阶段，验证「已完成阶段 + 完成时间」的往返
toggleTodoPhase(weekly.id, weekly.phases[0].id);
assert.equal(
  getTodos().find((t) => t.id === weekly.id).phases[0].completed,
  true,
  'toggleTodoPhase 未生效',
);

const snapshot = {
  items: getCheckinItems().map((i) => i.name).sort(),
  records: recordsByName(getCheckinRecords(), getCheckinItems()),
  todos: todosComparable(getTodos()),
};

const overviewBefore = backup.getDataOverview();
console.log('概览(导出前):', JSON.stringify(overviewBefore));

/* ---- 2. CSV 往返 ---- */
const csv = backup.buildAllCSV();
assert.ok(csv.includes('[打卡项目]'), 'CSV 缺少打卡项目区块');
assert.ok(csv.includes('[打卡记录]'), 'CSV 缺少打卡记录区块');
assert.ok(csv.includes('[待办事项]'), 'CSV 缺少待办事项区块');
console.log('\n--- 生成的 CSV ---\n' + csv + '\n------------------\n');

localStorage.clear();
assert.equal(getCheckinItems().length, 0, '清空失败');

const parsedCsv = backup.parseBackupCSV(csv);
const statsCsv = backup.restoreData(parsedCsv, 'replace');
console.log('CSV 恢复统计:', JSON.stringify(statsCsv));

assert.deepEqual(
  getCheckinItems().map((i) => i.name).sort(),
  snapshot.items,
  'CSV 恢复后打卡项目不一致',
);
assert.deepEqual(
  recordsByName(getCheckinRecords(), getCheckinItems()),
  snapshot.records,
  'CSV 恢复后打卡记录不一致',
);
assert.deepEqual(todosComparable(getTodos()), snapshot.todos, 'CSV 恢复后待办不一致');
console.log('OK: CSV 往返一致');

/* ---- 3. 合并模式应全部跳过 ---- */
const statsMerge = backup.restoreData(parsedCsv, 'merge');
assert.equal(statsMerge.items.added, 0, '合并模式不应新增打卡项目');
assert.equal(statsMerge.records.added, 0, '合并模式不应新增打卡记录');
assert.equal(statsMerge.todos.added, 0, '合并模式不应新增待办');
assert.ok(statsMerge.items.kept === snapshot.items.length, '合并模式 kept 计数不符');
console.log('OK: 合并模式正确跳过重复');

/* ---- 4. JSON 往返（应保留 id） ---- */
const jsonText = JSON.stringify(getAllData(), null, 2);
const idsBefore = {
  items: getCheckinItems().map((i) => i.id).sort(),
  todos: getTodos().map((t) => t.id).sort(),
};
localStorage.clear();
const parsedJson = backup.parseBackupJSON(jsonText);
backup.restoreData(parsedJson, 'replace');
assert.deepEqual(getCheckinItems().map((i) => i.id).sort(), idsBefore.items, 'JSON 恢复未保留项目 id');
assert.deepEqual(getTodos().map((t) => t.id).sort(), idsBefore.todos, 'JSON 恢复未保留待办 id');
assert.deepEqual(
  recordsByName(getCheckinRecords(), getCheckinItems()),
  snapshot.records,
  'JSON 恢复后打卡记录不一致',
);
assert.deepEqual(todosComparable(getTodos()), snapshot.todos, 'JSON 恢复后待办不一致');
console.log('OK: JSON 往返一致且保留 id');

/* ---- 5. 覆盖模式应清空旧数据 ---- */
const tinyCsv = [
  '[打卡项目]',
  '项目名称,创建日期,排序',
  '仅剩一项,2026-09-01,0',
  '',
  '[打卡记录]',
  '日期,项目名称,状态,完成时间,备注',
  '2026-09-01,仅剩一项,已完成,08:00,全新数据',
  '',
].join('\n');
const statsTiny = backup.restoreData(backup.parseBackupCSV(tinyCsv), 'replace');
assert.equal(statsTiny.items.added, 1, '覆盖模式项目数不符');
assert.equal(getCheckinItems().length, 1, '覆盖模式未清空旧项目');
assert.equal(getTodos().length, 0, '覆盖模式未清空旧待办');
assert.equal(getCheckinItems()[0].name, '仅剩一项', '覆盖模式项目名不符');
console.log('OK: 覆盖模式正确清空重建');

/* ---- 6. 概览统计 ---- */
const ov = backup.getDataOverview();
assert.equal(ov.itemCount, 1);
assert.equal(ov.recordCount, 1);
assert.equal(ov.dayCount, 1);
assert.equal(ov.firstDay, '2026-09-01');
console.log('OK: 概览统计正确 ->', JSON.stringify(ov));

/* ---- 7. 异常输入 ---- */
assert.throws(() => backup.parseBackupJSON('{bad json'), /解析失败/, '损坏 JSON 应报错');
const emptyParsed = backup.parseBackupCSV('随便一段文本\n没有任何区块');
assert.equal(emptyParsed.items.length, 0);
assert.ok(emptyParsed.warnings.length > 0, '无区块文件应给出警告');

// 旧版 high / medium / low 优先级应安全降级，而不是写入非法值
const legacy = backup.parseBackupCSV([
  '[待办事项]',
  '标题,背景,目标,行动,结果,阶段,优先级,状态,完成时间,创建时间,截止日期,保持,改进,停止,开始',
  '旧数据,,,,,,low,未完成,,2026-01-01T00:00:00.000Z,,,,,',
].join('\n'));
assert.equal(legacy.todos.length, 1, '旧版优先级行未解析');
assert.equal(legacy.todos[0].priority, 'not_urgent_important', '旧版 low 未降级为默认档');
console.log('OK: 异常输入处理正确');

/* ---- 8. 公式注入护栏：导出加护栏、导入脱护栏，往返仍无损 ---- */
localStorage.clear();
const evilName = "=cmd|' /C calc'!A0";
const evilTitle = '+SUM(A1:A9)';
const evilTarget = '-2+3';
const evilNote = '=HYPERLINK("http://x","y"),带逗号与引号';
addCheckinItem(evilName);
addCheckinItem('正常项目');
const [E1, E2] = getCheckinItems();
toggleCheckin('2026-09-05', E1.id, true, { time: '08:00', note: evilNote });
addTodo({ title: evilTitle, description: { target: evilTarget }, priority: 'not_urgent_important' });

const evilCsv = backup.buildAllCSV();
[evilName, evilTitle, evilTarget, evilNote].forEach((raw) => {
  // 含引号的单元格在 CSV 里会被双写转义，因此两种形态都算加了护栏
  const guarded = `'${raw}`;
  const guardedEscaped = `'${raw.replace(/"/g, '""')}`;
  assert.ok(
    evilCsv.includes(guarded) || evilCsv.includes(guardedEscaped),
    `导出应给以 = + - @ 开头的内容加单引号护栏，缺失: ${raw}`,
  );
  assert.ok(
    !evilCsv.split('\n').some((line) => line.startsWith(`${raw},`) || line === `"${raw}"`),
    `单元格不应以公式字符直接开头: ${raw}`,
  );
});

localStorage.clear();
const evilParsed = backup.parseBackupCSV(evilCsv);
backup.restoreData(evilParsed, 'replace');
assert.deepEqual(
  getCheckinItems().map((i) => i.name).sort(),
  [evilName, '正常项目'].sort(),
  '导入后项目名应还原为原文（不带护栏撇号）',
);
const evilTodo = getTodos().find((t) => t.description.target === evilTarget);
assert.ok(evilTodo, `导入后目标应还原为原文: ${evilTarget}`);
const names = Object.keys(getCheckinRecords()['2026-09-05'] || {});
assert.equal(names.length, 1, '护栏不应影响记录归属');
const rec = getCheckinRecords()['2026-09-05'][names[0]];
assert.equal(rec.note, evilNote, '备注应原样还原（含逗号与引号）');
console.log('OK: 公式注入护栏生效且导出→导入无损');

/* ---- 9. 临时任务：CSV / JSON 两条路径往返 + 合并去重 + 旧备份兼容 ---- */
localStorage.clear();
const D1 = '2026-10-11';
const D2 = '2026-10-12';
addQuickNote(D1, '顺路取快递');
addQuickNote(D1, '买牛奶, 面包, 鸡蛋');
const d2list = addQuickNote(D2, '给妈妈回电话');
toggleQuickNote(D2, d2list[d2list.length - 1].id);
assert.equal(addQuickNote('2026-10-1', '   ').length, 0, '空内容或非法日期不应写入');

const notesSnapshot = notesComparable(getAllQuickNotes());
assert.equal(notesSnapshot[D1].length, 2, '第一天应有 2 条');
assert.equal(notesSnapshot[D2][0].done, true, '勾选状态应已保存');
assert.ok(notesSnapshot[D2][0].doneAt, '完成时间应被记录');

const notesCsv = backup.buildAllCSV();
assert.ok(notesCsv.includes('[临时任务]'), 'CSV 应含临时任务区块');
localStorage.clear();
const parsedNotes = backup.parseBackupCSV(notesCsv);
assert.deepEqual(notesComparable(parsedNotes.quickNotes), notesSnapshot, 'CSV 解析结果应与导出一致');
backup.restoreData(parsedNotes, 'replace');
assert.deepEqual(notesComparable(getAllQuickNotes()), notesSnapshot, 'CSV 恢复后临时任务不一致');
const noteMerge = backup.restoreData(parsedNotes, 'merge');
assert.equal(noteMerge.quickNotes.added, 0, '合并模式不应重复新增临时任务');
assert.equal(noteMerge.quickNotes.skipped, 3, `合并模式应跳过已存在的 3 条，实际 ${noteMerge.quickNotes.skipped}`);

const notesJson = JSON.stringify(getAllData(), null, 2);
assert.ok(JSON.parse(notesJson).quickNotes, '快照 JSON 必须包含 quickNotes');
localStorage.clear();
backup.restoreData(backup.parseBackupJSON(notesJson), 'replace');
assert.deepEqual(notesComparable(getAllQuickNotes()), notesSnapshot, 'JSON 恢复后临时任务不一致');

const legacyNoNotes = backup.parseBackupJSON(JSON.stringify({ items: [], records: {}, todos: [] }));
assert.deepEqual(legacyNoNotes.quickNotes, {}, '缺 quickNotes 的旧备份应回落为空');
localStorage.clear();
addQuickNote(D1, '不该残留的条目');
backup.restoreData(legacyNoNotes, 'replace');
assert.deepEqual(getAllQuickNotes(), {}, '恢复旧备份应整份替换，不留旧条目');
console.log('OK: 临时任务在 CSV / JSON 往返无损，合并去重且兼容缺字段的旧备份');

/* ---- 10. 归档：CSV / JSON 两条路径都必须带着归档状态往返，缺列的旧备份安全降级 ---- */
localStorage.clear();
addCheckinItem('常态项目');
addCheckinItem('收尾项目');
const [GA, GB] = getCheckinItems();
toggleCheckin('2026-09-01', GB.id, true, { time: '07:00', note: '归档前留下的历史' });
addTodo({
  title: '归档待办',
  description: { situation: '背景G', target: '目标G' },
  priority: 'urgent_important',
  phases: [{ name: '阶段一', completed: true, completedTime: '10:00' }],
});
addTodo({ title: '普通待办', description: {} });
const archivedTodo = getTodos()[0];
archiveCheckinItem(GB.id);
archiveTodo(archivedTodo.id);
// 把归档日期改成固定值，才好断言往返（archive* 本身只会写今天）
const rawGItems = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawGItems.find((i) => i.id === GB.id).archivedAt = '2026-09-15';
localStorage.setItem('daily_checkin_items', JSON.stringify(rawGItems));
const rawGTodos = JSON.parse(localStorage.getItem('daily_todos'));
rawGTodos.find((t) => t.id === archivedTodo.id).archivedAt = '2026-09-20';
localStorage.setItem('daily_todos', JSON.stringify(rawGTodos));
assert.deepEqual(getActiveCheckinItems().map((i) => i.name), ['常态项目'], '归档后界面只剩未归档项');
assert.deepEqual(getActiveTodos().map((t) => t.title), ['普通待办'], '归档后待办列表只剩未归档项');

const gCsv = backup.buildAllCSV();
assert.ok(gCsv.includes('归档日期'), 'CSV 表头应含「归档日期」列');
assert.ok(gCsv.includes('2026-09-15'), 'CSV 应带上打卡项的归档日期');
assert.ok(gCsv.includes('2026-09-20'), 'CSV 应带上待办的归档日期');
assert.ok(gCsv.includes('收尾项目'), '归档项的历史记录仍要出现在打卡记录区块里');

const parsedG = backup.parseBackupCSV(gCsv);
assert.equal(parsedG.items.find((i) => i.name === '收尾项目').archived, true, 'CSV 解析应还原归档标记');
assert.equal(parsedG.items.find((i) => i.name === '收尾项目').archivedAt, '2026-09-15');
assert.equal(parsedG.items.find((i) => i.name === '常态项目').archived, false, '未归档项应解析为未归档');

localStorage.clear();
backup.restoreData(parsedG, 'replace');
assert.deepEqual(getActiveCheckinItems().map((i) => i.name), ['常态项目'], 'CSV 恢复后界面只该看见未归档项目');
assert.deepEqual(getArchivedCheckinItems().map((i) => i.name), ['收尾项目'], 'CSV 恢复应带回归档项');
assert.equal(getArchivedCheckinItems()[0].archivedAt, '2026-09-15', '归档日期要能往返');
assert.deepEqual(getActiveTodos().map((t) => t.title), ['普通待办'], 'CSV 恢复后归档待办不应出现在界面');
const csvTodo = getArchivedTodos()[0];
assert.equal(csvTodo.archivedAt, '2026-09-20', '待办归档日期要能往返');
assert.equal(csvTodo.description.situation, '背景G', '归档待办的 STAR 应原样回来');
assert.equal(csvTodo.phases.length, 1, '归档待办的行动清单应原样回来');

const gOv = backup.getDataOverview();
assert.equal(gOv.itemCount, 1, '概览的打卡项目数应只数未归档的');
assert.equal(gOv.archivedItemCount, 1);
assert.equal(gOv.todoCount, 1, '概览的待办数应只数未归档的');
assert.equal(gOv.archivedTodoCount, 1);
assert.equal(gOv.recordCount, 1, '归档项的历史记录不应因归档而消失');
assert.equal(gOv.archivedRecordCount, 1, '概览应算出多少条记录属于归档项');

const inv = backup.getArchiveInventory();
assert.equal(inv.items.length, 1);
assert.equal(inv.items[0].recordCount, 1, '归档清单应给出历史条数');
assert.equal(inv.items[0].lastRecordDate, '2026-09-01');
assert.equal(inv.items[0].archivedAt, '2026-09-15');
assert.equal(inv.todos[0].title, '归档待办');
assert.equal(inv.todos[0].phaseTotal, 1);

// JSON 无损往返
const gJson = JSON.stringify(getAllData(), null, 2);
assert.ok(JSON.parse(gJson).items.find((i) => i.name === '收尾项目').archived, '快照 JSON 必须带 archived');
localStorage.clear();
backup.restoreData(backup.parseBackupJSON(gJson), 'replace');
assert.deepEqual(getArchivedCheckinItems().map((i) => i.name), ['收尾项目'], 'JSON 恢复应保留归档状态');
assert.deepEqual(getArchivedTodos().map((t) => t.title), ['归档待办'], 'JSON 恢复应保留待办归档状态');
assert.equal(getArchivedCheckinItems()[0].archivedAt, '2026-09-15', 'JSON 归档日期也应原样');

// 恢复归档后界面重新看得见
unarchiveCheckinItem(getArchivedCheckinItems()[0].id);
unarchiveTodo(getArchivedTodos()[0].id);
assert.equal(getActiveCheckinItems().length, 2, '取消归档后应回到界面');
assert.equal(getActiveTodos().length, 2, '取消归档后待办应回到界面');
assert.equal(getCheckinStats(getToday()).total, 2, '取消归档后当日分母应恢复');

// 旧备份（没有归档列）应归一化成未归档，而不是报错或凭空多出归档项
const legacyG = backup.parseBackupCSV([
  '[打卡项目]', '项目名称,创建日期,排序', '旧项目,2026-08-01,0', '',
  '[待办事项]',
  '标题,背景,目标,行动,结果,阶段,优先级,状态,完成时间,创建时间,截止日期,保持,改进,停止,开始',
  '旧待办,,,,,,not_urgent_important,未完成,,2026-08-01,,,,,', '',
].join('\n'));
localStorage.clear();
backup.restoreData(legacyG, 'replace');
assert.deepEqual(getActiveCheckinItems().map((i) => i.name), ['旧项目'], '缺归档列的旧备份应视为未归档');
assert.deepEqual(getActiveTodos().map((t) => t.title), ['旧待办'], '缺归档列的旧备份待办应未归档');
assert.equal(getArchivedCheckinItems().length, 0, '旧备份不该造出归档项');
assert.equal(getArchivedTodos().length, 0);
console.log('OK: 归档状态在 CSV / JSON 两条路径往返无损，缺列的旧备份安全降级为未归档');

/* ---- 11. 归档子界面按月分组 ---- */
localStorage.clear();
localStorage.setItem('daily_checkin_items', JSON.stringify([
  { id: 'a1', name: '九月归档项', createdAt: '2026-09-01', archived: true, archivedAt: '2026-09-15', order: 0 },
  { id: 'a2', name: '十月归档项', createdAt: '2026-09-01', archived: true, archivedAt: '2026-10-03', order: 1 },
  { id: 'a3', name: '脏日期项', createdAt: '2026-09-01', archived: true, archivedAt: '', order: 2 },
]));
localStorage.setItem('daily_todos', JSON.stringify([
  { id: 't1', title: '九月归档待办', createdAt: '2026-09-02', archived: true, archivedAt: '2026-09-20', order: 0 },
  { id: 't2', title: '未归档待办', createdAt: '2026-09-02', order: 1 },
]));

const monthGroups = backup.groupArchiveByMonth(backup.getArchiveInventory());
assert.deepEqual(monthGroups.map((g) => g.month), ['2026-10', '2026-09', ''], '月份应倒序，缺归档日期的排最后');
assert.equal(monthGroups[0].label, '2026年10月');
assert.equal(monthGroups[2].label, '未记录归档日期');
assert.deepEqual(monthGroups[0].entries.map((e) => e.id), ['a2']);
assert.deepEqual(monthGroups[0].entries.map((e) => e.kind), ['item']);
assert.deepEqual(
  monthGroups[1].entries.map((e) => `${e.kind}:${e.id}`),
  ['todo:t1', 'item:a1'],
  '同月内打卡项与待办应合并，并按归档日倒序',
);
assert.equal(
  monthGroups.reduce((n, g) => n + g.entries.length, 0),
  4,
  '分组前后条数必须相等，脏日期只能让它落在最后，不能把条目分丢',
);
assert.ok(
  !monthGroups.some((g) => g.entries.some((e) => e.id === 't2')),
  '未归档的数据不该进归档子界面',
);
assert.deepEqual(backup.groupArchiveByMonth({ items: [], todos: [] }), [], '无归档时分组为空');
console.log('OK: 归档按月分组正确 —— 月份倒序、同月合并两类数据、缺归档日期的归到末尾且条目不丢');

/* ---- 12. 行动项的完成日期：CSV 带「哪天勾的」往返，旧格式只有 HH:mm 时归为不知道 ---- */
{
  localStorage.clear();
  addTodo({ title: '有补做的待办', description: {}, priority: 'urgent_important', phases: [
    { name: '按时做完', dueDate: '2026-09-10', completed: true, completedTime: '09:00', completedAt: '2026-09-10' },
    { name: '逾期补做', dueDate: '2026-09-12', completed: true, completedTime: '10:00', completedAt: '2026-09-20' },
    { name: '还没做', dueDate: '2026-09-25' },
  ] });

  const csv = backup.buildAllCSV();
  assert.ok(csv.includes('[已完成@2026-09-12]逾期补做 (2026-09-20 10:00)'),
    `阶段应带完成日期导出，实际: ${(csv.match(/\[[^\]]*\]逾期补做[^\n,]*/)||[''])[0]}`);

  localStorage.clear();
  backup.restoreData(backup.parseBackupCSV(csv), 'replace');
  const t = getTodos()[0];
  assert.equal(t.phases.find((p) => p.name === '按时做完').completedAt, '2026-09-10', 'CSV 往返必须保住完成日期');
  assert.equal(t.phases.find((p) => p.name === '按时做完').completedTime, '09:00', '完成时刻仍应是 HH:mm');
  assert.equal(t.phases.find((p) => p.name === '逾期补做').completedAt, '2026-09-20',
    '补做的完成日期同样要保住，丢了它这条就会在提醒里伪装成按时完成');
  assert.equal(t.phases.find((p) => p.name === '还没做').completedAt, '', '未完成的行动没有完成日期');

  // 1.1.4 之前的备份只有「(HH:mm)」：日期留空表示确实不知道，绝不拿导出当天或今天冒充
  const legacy = csv.replace('(2026-09-20 10:00)', '(10:00)');
  assert.ok(legacy !== csv, '本条用例需要真的构造出旧格式的阶段串');
  localStorage.clear();
  backup.restoreData(backup.parseBackupCSV(legacy), 'replace');
  const lt = getTodos()[0];
  assert.equal(lt.phases.find((p) => p.name === '逾期补做').completedAt, '', '旧备份读不出完成日期应留空');
  assert.equal(lt.phases.find((p) => p.name === '逾期补做').completedTime, '10:00', '旧格式的时刻仍要原样读回');
  assert.equal(lt.phases.find((p) => p.name === '逾期补做').completed, true, '旧格式不应影响完成状态本身');
  console.log('OK: 行动项完成日期随 CSV 往返，旧格式安全回落为「不知道哪天」');
}

console.log('\n全部验证通过 ✅');
