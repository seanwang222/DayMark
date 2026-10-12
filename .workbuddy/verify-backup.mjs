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
} = storage;

/* ---- 工具 ---- */
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

console.log('\n全部验证通过 ✅');
