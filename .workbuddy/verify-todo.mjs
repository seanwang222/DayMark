/**
 * 回归验证：待办「编辑完成记录」与「编辑待办」不得损坏数据
 * 用法: node .workbuddy/verify-todo.mjs（需经 esbuild 打包，见 package.json 的 verify:todo）
 *
 * 起因：编辑完成记录曾走 toggleTodo（翻转语义），会把已完成翻成未完成并清空复盘；
 * 编辑待办的 payload 曾写死 situation/result 为空串，一次编辑即抹掉历史 STAR 内容。
 * 这两条路径都不在原有用例覆盖范围内，故单独锁住。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* ---- mock 浏览器环境 ---- */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

const {
  addTodo, editTodo, getTodos, toggleTodo, toggleTodoPhase, isPastDue, getUpcomingPhases,
  getActiveTodos, getArchivedTodos, archiveTodo, unarchiveTodo, reorderTodos, setAllData,
} = await import('../src/utils/storage.js');

const KISM = { keep: '早起', improve: '排期', stop: '熬夜', start: '复盘' };

function makeCompletedTodo() {
  addTodo({
    title: '完成周报',
    description: { situation: '月底临近', target: '按时提交', action: '', result: '已提交' },
    priority: 'urgent_important',
    dueDate: '2026-08-30',
  });
  const t = getTodos()[0];
  toggleTodo(t.id, { completedTime: '18:00', review: { ...KISM } });
  return getTodos().find((x) => x.id === t.id);
}

/* ---- 1. 前置：toggleTodo 本身仍是「翻转」语义 ---- */
{
  const done = makeCompletedTodo();
  assert.equal(done.completed, true, 'toggleTodo 应把未完成翻成已完成');
  assert.equal(done.completedTime, '18:00');
  assert.deepEqual(done.review, KISM);

  const undone = toggleTodo(done.id).find((x) => x.id === done.id);
  assert.equal(undone.completed, false, 'toggleTodo 的翻转语义不应被改掉');
  assert.equal(undone.completedTime, '', '取消完成应清空完成时间');
  assert.deepEqual(undone.review, { keep: '', improve: '', stop: '', start: '' });

  // 复位成已完成，供后续用例
  toggleTodo(done.id, { completedTime: '18:00', review: { ...KISM } });
  console.log('OK: toggleTodo 仍是翻转语义（取消完成会清空记录）');
}

/* ---- 2. 编辑完成记录走 editTodo：不翻转、不丢复盘 ---- */
{
  const t = getTodos().find((x) => x.completed);
  // TodoPage.handleConfirmEditRecord 现在下发的就是这个结构
  editTodo(t.id, {
    completed: true,
    completedTime: '19:30',
    review: { keep: '早起', improve: '调整排期', stop: '熬夜', start: '复盘' },
  });

  const after = getTodos().find((x) => x.id === t.id);
  assert.equal(after.completed, true, '编辑完成记录不得把已完成翻成未完成');
  assert.equal(after.completedTime, '19:30', '完成时间应更新为新值');
  assert.equal(after.review.improve, '调整排期', '复盘内容应被保存而非清空');
  assert.equal(after.description.situation, '月底临近', '编辑完成记录不应触碰 description');
  assert.equal(after.description.result, '已提交');
  assert.equal(after.title, '完成周报');
  console.log('OK: 编辑完成记录保留完成状态与复盘');
}

/* ---- 3. 编辑待办：SITUATION / RESULT 原样带回即不丢 ---- */
{
  const t = getTodos().find((x) => x.completed);
  const prevDesc = t.description;
  // AddTodoDialog 已不收集 SITUATION/RESULT，保存时把旧值原样带回（见 prevDesc）
  editTodo(t.id, {
    title: '完成周报（改）',
    description: {
      situation: prevDesc.situation || '',
      target: '按时提交且留出评审时间',
      action: '收集数据\n撰写正文',
      result: prevDesc.result || '',
    },
    dueDate: '2026-08-31',
    priority: 'not_urgent_important',
    phases: undefined,
  });

  const after = getTodos().find((x) => x.id === t.id);
  assert.equal(after.description.situation, '月底临近', '编辑待办不得清空 SITUATION');
  assert.equal(after.description.result, '已提交', '编辑待办不得清空 RESULT');
  assert.equal(after.description.target, '按时提交且留出评审时间', 'TARGET 应更新');
  assert.equal(after.completed, true, '编辑待办不得影响完成状态');
  assert.equal(after.review.improve, '调整排期', '编辑待办不得影响复盘');
  console.log('OK: 编辑待办保留未被界面收集的 STAR 字段');
}

/* ---- 4. 界面若仍下发空串，则会丢数据：把该契约显式锁住 ---- */
{
  const t = getTodos().find((x) => x.completed);
  editTodo(t.id, { description: { situation: '', target: 'x', action: '', result: '' } });
  const wiped = getTodos().find((x) => x.id === t.id);
  // storage 层无法区分「用户清空」与「界面不收集」，因此保留旧值必须由调用方带回。
  assert.equal(wiped.description.situation, '', 'editTodo 对 description 是全量覆盖语义');
  // 复原，避免污染后面的用例
  editTodo(t.id, { description: { situation: '月底临近', target: '按时提交且留出评审时间', action: '', result: '已提交' } });
  console.log('OK: editTodo 的 description 为全量覆盖，旧值须由调用方带回');
}

/* ---- 5. 过期判定：没有截止日不等于已过期（日程页曾因此全线标红） ---- */
{
  const today = '2026-10-11';
  assert.equal(isPastDue(false, '', today), false, '无截止日的待办不该显示已过期');
  assert.equal(isPastDue(false, undefined, today), false, 'dueDate 缺失同样不该算过期');
  assert.equal(isPastDue(false, '2026-10-10', today), true, '截止日在过去应算过期');
  assert.equal(isPastDue(false, '2026-10-11', today), false, '当天到期不算过期');
  assert.equal(isPastDue(false, '2026-10-12', today), false, '未来截止不该过期');
  assert.equal(isPastDue(true, '2026-10-01', today), false, '已完成永不过期');
  console.log('OK: 过期判定要求截止日存在且早于今天');
}

/* ---- 6. 一周提醒：按时完成的留灰原位、逾期后补做的退出、今天到期归行动 ---- */
{
  localStorage.clear();
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const todayStr = shift(0);

  addTodo({ title: 'T1', description: {}, priority: 'urgent_important', phases: [
    { name: '逾期2天', dueDate: shift(-2) },
    { name: '今天到期', dueDate: shift(0) },
    { name: '明天到期', dueDate: shift(1) },
    { name: '3天后', dueDate: shift(3) },
    { name: '没有截止日', dueDate: '' },
    { name: '按时完成留灰', dueDate: shift(-6), completed: true, completedAt: shift(-6) },
    { name: '提前完成留灰', dueDate: shift(5), completed: true, completedAt: shift(0) },
    { name: '逾期后补做要退出', dueDate: shift(-4), completed: true, completedAt: shift(-1) },
    { name: '按时但超出回看窗', dueDate: shift(-20), completed: true, completedAt: shift(-20) },
    { name: '老数据无完成日期', dueDate: shift(-3), completed: true },
    { name: '老数据无日期且超窗', dueDate: shift(-15), completed: true },
  ] });
  addTodo({ title: 'T2', description: {}, priority: 'not_urgent_important', phases: [
    { name: '逾期20天仍未完成', dueDate: shift(-20) },
    { name: '正好第7天', dueDate: shift(7) },
    { name: '第8天', dueDate: shift(8) },
  ] });
  addTodo({ title: 'T3', description: {}, priority: 'not_urgent_important', phases: [
    { name: '待办已完成就不提醒', dueDate: shift(0) },
  ] });
  const [T1, T2, T3] = getTodos();
  toggleTodo(T3.id, { completedTime: '10:00', review: { keep: '', improve: '', stop: '', start: '' } });

  const list = getUpcomingPhases(7, todayStr);
  assert.deepEqual(
    list.map((x) => x.phase.name),
    ['逾期20天仍未完成', '按时完成留灰', '老数据无完成日期', '逾期2天', '明天到期', '3天后', '提前完成留灰', '正好第7天'],
    `应按剩余天数升序、按时完成的留在原位，实际: ${list.map((x) => `${x.phase.name}(${x.daysLeft})`).join(', ')}`,
  );
  assert.deepEqual(list.map((x) => x.daysLeft), [-20, -6, -3, -2, 1, 3, 5, 7], '剩余天数计算错误');
  assert.deepEqual(list.map((x) => x.phase.completed),
    [false, true, true, false, false, false, true, false],
    '完成状态应原样带出，由界面决定划掉变灰，而不是在取数里把它筛掉');
  assert.deepEqual(list.map((x) => x.overdue),
    [true, true, true, true, false, false, false, false],
    'overdue 只描述截止日与今天的关系（按时完成的那条曾经也是逾期日）');
  assert.ok(!list.some((x) => x.phase.name === '逾期后补做要退出'),
    '计划完成日之后才勾掉的（补做）不得出现在提醒里，本人要求不留灰痕');
  assert.ok(!list.some((x) => x.phase.name === '按时但超出回看窗'),
    '按时完成的也只回看 withinDays 天，更早的成功不一直占位');
  assert.ok(list.some((x) => x.phase.name === '老数据无完成日期'),
    '没有完成日期的旧数据判不出是否补做，应退回窗口规则而不是直接抹掉');
  assert.ok(!list.some((x) => x.phase.name === '老数据无日期且超窗'),
    '退回窗口规则的老数据同样受向前 withinDays 天的约束');
  assert.ok(!list.some((x) => x.phase.name === '今天到期'),
    '1.1.4 起今天到期归「行动」，不再进提醒（同屏重复占位）');
  assert.ok(list.some((x) => x.phase.name === '逾期20天仍未完成'),
    '未完成的逾期行动无论多久都仍要提醒（这条规则不得被"完成项会退场"带走）');
  assert.ok(!list.some((x) => x.phase.name === '第8天'), '超出 7 天窗口的行动项不应进提醒');
  assert.ok(!list.some((x) => x.phase.name === '没有截止日'), '无截止日无法判断紧急度，不应进提醒');
  assert.ok(!list.some((x) => x.phase.name === '待办已完成就不提醒'), '所属待办已完成时其行动不应进提醒');
  assert.ok(list.every((x) => x.todo && x.todo.title), '每条提醒都应带上所属待办');

  // 窗口收窄到 2 天：按时完成的（-6）与判不出日期的老数据（-3）一起落到窗口外
  assert.deepEqual(getUpcomingPhases(2, todayStr).map((x) => x.daysLeft), [-20, -2, 1],
    '窗口收窄后不应包含 2 天以外的行动项');
  // 提醒里的东西不该在「当天清单」的取数里消失：今天到期的行动仍由日程页右栏的行动分组呈现
  const todayPhaseCount = getActiveTodos().reduce(
    (n, t) => n + (t.phases || []).filter((p) => p.dueDate === todayStr && !p.completed).length, 0);
  assert.ok(todayPhaseCount > 0, '今天到期的行动项应仍然存在（只是归行动，不是被删掉）');

  // 截止日之前勾掉：记下完成日期，留在原位、条数与顺序都不变
  const target = getUpcomingPhases(7, todayStr).find((x) => x.phase.name === '3天后');
  toggleTodoPhase(T1.id, target.phase.id);
  const after = getUpcomingPhases(7, todayStr).map((x) => x.phase.name);
  assert.deepEqual(after, [
    '逾期20天仍未完成', '按时完成留灰', '老数据无完成日期', '逾期2天', '明天到期', '3天后', '提前完成留灰', '正好第7天',
  ], '按时（或提前）勾掉的行动应原样留在提醒里，位置与条数都不变');
  const storedOnTime = getTodos().find((t) => t.id === T1.id).phases.find((p) => p.name === '3天后');
  assert.equal(storedOnTime.completedAt, todayStr, '勾选完成必须记下「哪天勾的」，否则分不清补做');
  assert.match(storedOnTime.completedTime, /^\d{2}:\d{2}$/, '完成时刻仍应是 HH:mm');

  // 逾期之后补做：勾掉即退出提醒，且不影响其余条目的相对顺序
  const late = getUpcomingPhases(7, todayStr).find((x) => x.phase.name === '逾期2天');
  toggleTodoPhase(T1.id, late.phase.id);
  assert.deepEqual(getUpcomingPhases(7, todayStr).map((x) => x.phase.name), [
    '逾期20天仍未完成', '按时完成留灰', '老数据无完成日期', '明天到期', '3天后', '提前完成留灰', '正好第7天',
  ], '补做的那条应退出，其余条目顺序不变');

  // 取消完成：完成日期与时间一起归零，不能留着旧日期把下次勾选伪装成「按时」
  toggleTodoPhase(T1.id, late.phase.id);
  const undone = getTodos().find((t) => t.id === T1.id).phases.find((p) => p.name === '逾期2天');
  assert.equal(undone.completed, false);
  assert.equal(undone.completedAt, '', '取消完成应清空完成日期');
  assert.equal(undone.completedTime, '', '取消完成应清空完成时刻');
  assert.ok(getUpcomingPhases(7, todayStr).some((x) => x.phase.name === '逾期2天'),
    '取消完成后以未完成身份重新回到提醒');
  console.log('OK: 按时完成的留灰原位、逾期补做的退出、完成日期随勾选写入并随取消清零');
}

/* ---- 7. 归档待办：退出界面与提醒，但 STAR / 行动 / 复盘一条不少 ---- */
{
  localStorage.clear();
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const todayStr = shift(0);

  addTodo({
    title: '已完成的待办',
    description: { situation: '背景A', target: '目标A', result: '结果A' },
    priority: 'urgent_important',
    phases: [{ name: '行动A', dueDate: shift(2) }],
  });
  addTodo({
    title: '收尾的待办',
    description: { situation: '背景B' },
    priority: 'not_urgent_important',
    phases: [{ name: '行动B', dueDate: shift(1) }],
  });
  const [doneOne, toArchive] = getTodos();
  toggleTodo(doneOne.id, { completedTime: '18:00', review: { ...KISM } });

  // 归档前：未完成的 toArchive 那条行动要在提醒里（doneOne 已完成，其行动按口径不提醒）
  assert.deepEqual(
    getUpcomingPhases(7, todayStr).map((x) => x.phase.name),
    ['行动B'],
    '归档前应能提醒到 行动B',
  );

  archiveTodo(toArchive.id);
  assert.equal(getTodos().length, 2, '归档不是删除：底层数组仍要有两条');
  assert.equal(getActiveTodos().length, 1, '界面只该看得见未归档的那条');
  assert.equal(getActiveTodos()[0].id, doneOne.id);
  assert.deepEqual(getArchivedTodos().map((t) => t.title), ['收尾的待办']);

  // 提醒（日程页「提醒」的数据源）不得再吐出归档待办的行动
  assert.deepEqual(
    getUpcomingPhases(7, todayStr).map((x) => x.phase.name),
    [],
    '归档待办的行动不应再进提醒',
  );

  // 归档不得改动脉冲状态与任何内容字段
  const archivedRaw = getTodos().find((t) => t.id === toArchive.id);
  assert.equal(archivedRaw.archived, true);
  assert.match(archivedRaw.archivedAt, /^\d{4}-\d{2}-\d{2}$/, '归档日应为合法日期');
  assert.equal(archivedRaw.description.situation, '背景B', '归档不得丢 STAR 描述');
  assert.equal(archivedRaw.phases[0].name, '行动B', '归档不得丢行动清单');
  archiveTodo(doneOne.id);
  const archivedDone = getTodos().find((t) => t.id === doneOne.id);
  assert.equal(archivedDone.completed, true, '归档不得改动完成状态');
  assert.equal(archivedDone.completedTime, '18:00', '归档不得清空完成时间');
  assert.deepEqual(archivedDone.review, KISM, '归档不得清空复盘');

  // 界面拖拽只会传「可见项」的 id：归档项没被传到，也不该被顺手抹掉
  unarchiveTodo(doneOne.id); // 此刻 doneOne 可见、toArchive 仍是归档态
  assert.deepEqual(getActiveTodos().map((t) => t.id), [doneOne.id]);
  reorderTodos(getActiveTodos().map((t) => t.id));
  assert.equal(getTodos().length, 2, 'reorderTodos 不得把没传入的归档待办从存储里抹掉');
  assert.equal(getTodos().find((t) => t.id === toArchive.id).archived, true, '排序后归档状态应原样保留');
  assert.deepEqual(getTodos().map((t) => t.order).sort((a, b) => a - b), [0, 1], 'order 应保持连续');

  // 取消归档：字段整体消失，内容原样回到界面
  unarchiveTodo(toArchive.id);
  assert.equal(getActiveTodos().length, 2, '恢复后应重新可见');
  assert.equal(getArchivedTodos().length, 0);
  const restored = getTodos().find((t) => t.id === toArchive.id);
  assert.equal(restored.archived, undefined, '取消归档应删掉 archived 字段');
  assert.equal(restored.archivedAt, undefined, '取消归档应删掉 archivedAt 字段');
  assert.equal(restored.description.situation, '背景B');
  console.log('OK: 归档待办退出界面与提醒，内容与顺序不受损，恢复即原样回来');
}

/* ---- 9. 行动项的完成日期：新增、编辑、恢复、界面回传四条路径都不许丢 ---- */
{
  localStorage.clear();
  const pad = (n) => String(n).padStart(2, '0');
  const shift = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const day = shift(-2);

  addTodo({ title: '带完成日期的待办', description: {}, priority: 'urgent_important', phases: [
    { name: '按时做完的行动', dueDate: day, completed: true, completedTime: '09:00', completedAt: day },
    { name: '还没做的行动', dueDate: shift(1) },
  ] });
  const T = getTodos()[0];
  assert.equal(T.phases[0].completedAt, day, 'addTodo 应接受并完成日期的落库');

  // 编辑待办时界面把原字段整体带回，日期不得被洗掉
  editTodo(T.id, {
    title: '带完成日期的待办',
    description: { situation: '背景', target: '', action: '', result: '' },
    phases: T.phases.map((p) => ({ ...p })),
  });
  assert.equal(getTodos()[0].phases[0].completedAt, day, 'editTodo 重建 phases 时必须带上 completedAt');

  // 漏传该字段（退回旧版对话框的行为）时安全归零，表示确实不知道，而不是崩溃或伪造一个日期
  editTodo(T.id, {
    title: '带完成日期的待办',
    phases: getTodos()[0].phases.map((p) => ({
      id: p.id, name: p.name, completed: p.completed, completedTime: p.completedTime, dueDate: p.dueDate,
    })),
  });
  assert.equal(getTodos()[0].phases[0].completedAt, '', '缺字段应归一为空串（判不出补做就按窗口兜底）');

  // 备份恢复走 normalizeTodo 的白名单重建：合法值保住，非法值归零
  setAllData({ todos: [
    { id: 'x1', title: '从备份回来', description: {}, priority: 'urgent_important', phases: [
      { id: 'p1', name: '按时', completed: true, completedTime: '09:00', completedAt: day, dueDate: day },
      { id: 'p2', name: '脏日期', completed: true, completedAt: '昨天下午三点', dueDate: day },
    ] },
  ] }, 'replace');
  const back = getTodos()[0];
  assert.equal(back.phases[0].completedAt, day, '恢复备份应保住完成日期');
  assert.equal(back.phases[1].completedAt, '', '非法完成日期一律归零，别让脏值参与「是否补做」的字符串比较');

  // 这个字段对话框里根本不显示，全靠提交时把原值带回去；漏一处就把「补做」伪装成「按时」，
  // 所以按 verify:config 的做法用源码断言锁住这一层接线
  const dialog = fs.readFileSync(new URL('../src/components/AddTodoDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /completedAt:\s*a\.completedAt/, 'AddTodoDialog 提交行动列表时必须回传 completedAt');
  console.log('OK: 完成日期在新增、编辑、恢复与界面回传四条路径上都不丢');
}

console.log('\n全部验证通过 ✅');
