/**
 * 回归验证：待办「编辑完成记录」与「编辑待办」不得损坏数据
 * 用法: node .workbuddy/verify-todo.mjs（需经 esbuild 打包，见 package.json 的 verify:todo）
 *
 * 起因：编辑完成记录曾走 toggleTodo（翻转语义），会把已完成翻成未完成并清空复盘；
 * 编辑待办的 payload 曾写死 situation/result 为空串，一次编辑即抹掉历史 STAR 内容。
 * 这两条路径都不在原有用例覆盖范围内，故单独锁住。
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

const { addTodo, editTodo, getTodos, toggleTodo, toggleTodoPhase, isPastDue, getUpcomingPhases } = await import('../src/utils/storage.js');

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

/* ---- 6. 一周提醒：窗口边界、逾期置顶、无截止日与已完成都不进提醒 ---- */
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
    { name: '3天后', dueDate: shift(3) },
    { name: '没有截止日', dueDate: '' },
    { name: '已完成但有截止日', dueDate: shift(1), completed: true },
  ] });
  addTodo({ title: 'T2', description: {}, priority: 'not_urgent_important', phases: [
    { name: '逾期5天', dueDate: shift(-5) },
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
    ['逾期5天', '逾期2天', '今天到期', '3天后', '正好第7天'],
    `应按剩余天数升序（逾期自然置顶），实际: ${list.map((x) => `${x.phase.name}(${x.daysLeft})`).join(', ')}`,
  );
  assert.deepEqual(list.map((x) => x.daysLeft), [-5, -2, 0, 3, 7], '剩余天数计算错误');
  assert.deepEqual(list.map((x) => x.overdue), [true, true, false, false, false], '逾期标记错误');
  assert.ok(!list.some((x) => x.phase.name === '第8天'), '超出 7 天窗口的行动项不应进提醒');
  assert.ok(!list.some((x) => x.phase.name === '没有截止日'), '无截止日无法判断紧急度，不应进提醒');
  assert.ok(!list.some((x) => x.phase.name === '已完成但有截止日'), '已完成的行动项不应进提醒');
  assert.ok(!list.some((x) => x.phase.name === '待办已完成就不提醒'), '所属待办已完成时其行动不应进提醒');
  assert.ok(list.every((x) => x.todo && x.todo.title), '每条提醒都应带上所属待办');

  // 窗口收窄到 2 天：只剩逾期与今天
  assert.deepEqual(getUpcomingPhases(2, todayStr).map((x) => x.daysLeft), [-5, -2, 0], '窗口收窄后不应包含 2 天以外的行动项');
  console.log('OK: 一周提醒按紧急度升序、逾期置顶且正确排除窗口外/无截止日/已完成');
}

console.log('\n全部验证通过 ✅');
