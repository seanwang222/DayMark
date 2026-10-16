/**
 * 临时验证脚本：单项目汇总统计与筛选
 * 用法: node .workbuddy/verify-stats.mjs（需经 esbuild 打包，见 package.json 的 verify:stats）
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

const {
  addCheckinItem, toggleCheckin, getCheckinItems, getCheckinStats,
  getActiveCheckinItems, getArchivedCheckinItems, archiveCheckinItem, unarchiveCheckinItem,
  reorderCheckinItems,
  getMonthlyData, getQuarterlyData, getYearlyData,
  getItemStats, getOverallStats, getViewRange,
} = await import('../src/utils/storage.js');

function pad2(n) { return String(n).padStart(2, '0'); }

function fmt(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** n 天前的日期字符串（n=0 表示今天） */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt(d);
}

/**
 * 独立实现一遍「区间内在册天数」，用来交叉验证 storage 里的统计：
 * [start, end] ∩ [创建日, 归档日前一天] ∩ (−∞, 今天]
 * 测试自己也算一遍，才不会把被测实现的口径原样抄成期望值。
 */
function activeDaysIn(startStr, endStr, createdAt, archivedAt) {
  const today = fmt(new Date());
  const from = startStr > createdAt ? startStr : createdAt;
  const to = endStr > today ? today : endStr;
  let n = 0;
  const cur = new Date(`${from}T00:00:00`);
  const stop = new Date(`${to}T00:00:00`);
  while (cur <= stop) {
    const ds = fmt(cur);
    if (archivedAt && ds >= archivedAt) break;
    n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

function reset() {
  localStorage.clear();
}

/* ==================== 1. 不传 itemId 时行为完全不变 ==================== */
reset();
addCheckinItem('晨跑');
addCheckinItem('读书');
const [A, B] = getCheckinItems();

const now = new Date();
toggleCheckin(fmt(now), A.id, true, { time: '07:30', note: '' });

const allMonth = getMonthlyData(now.getFullYear(), now.getMonth() + 1);
const todayRow = allMonth.find((d) => d.date === fmt(now));
assert.equal(todayRow.total, 2, '未传 itemId 时 total 应等于项目总数');
assert.equal(todayRow.completed, 1, '未传 itemId 时 completed 统计错误');
assert.equal(todayRow.rate, 50, '未传 itemId 时完成率应为 50%');
console.log('OK: 不传 itemId 时原有行为不变');

/* ==================== 2. 单项目模式：排除项目创建前的日期 ==================== */
reset();
addCheckinItem('固定月项目');
const [C] = getCheckinItems();
// 手动把创建日期改为 2026-08-15
const rawItems = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawItems[0].createdAt = '2026-08-15';
localStorage.setItem('daily_checkin_items', JSON.stringify(rawItems));

toggleCheckin('2026-08-15', C.id, true, { time: '07:00', note: '第一天' });
toggleCheckin('2026-08-20', C.id, true, { time: '07:10', note: '' });

const aug = getMonthlyData(2026, 8, C.id);
assert.equal(aug.length, 31, '8 月应有 31 天');

const d1 = aug.find((d) => d.date === '2026-08-01');
const d14 = aug.find((d) => d.date === '2026-08-14');
const d15 = aug.find((d) => d.date === '2026-08-15');
const d16 = aug.find((d) => d.date === '2026-08-16');
const d20 = aug.find((d) => d.date === '2026-08-20');

assert.equal(d1.excluded, true, '创建日之前应标记 excluded');
assert.equal(d1.total, 0, 'excluded 日期不应计入 total');
assert.equal(d14.excluded, true, '8/14 仍应 excluded');
assert.equal(d15.excluded, undefined, '8/15（创建日）不应 excluded');
assert.equal(d15.total, 1, '单项目模式 total 应为 1');
assert.equal(d15.completed, 1, '8/15 应统计为已完成');
assert.equal(d15.rate, 100, '8/15 完成率应为 100%');
assert.equal(d16.completed, 0, '8/16 未完成');
assert.equal(d16.rate, 0, '8/16 完成率应为 0%');
assert.equal(d20.completed, 1, '8/20 应统计为已完成');
console.log('OK: 单项目模式正确排除项目创建前的日期');

/* ==================== 3. 季度 / 年度也应按项目过滤 ==================== */
const q3 = getQuarterlyData(2026, 3, C.id);
const augInQ = q3.monthData.find((m) => m.month === '2026-08');
assert.equal(augInQ.completed, 2, '季度统计中 8 月应完成 2 天');
assert.equal(augInQ.total, 17, '季度统计中 8 月应统计 8/15-8/31 共 17 天');
assert.equal(augInQ.rate, 12, '季度统计完成率应约为 12%');

const y2026 = getYearlyData(2026, C.id);
const augInY = y2026.monthData.find((m) => m.month === '2026-08');
assert.equal(augInY.completed, 2, '年度统计中 8 月应完成 2 天');
console.log('OK: 季度 / 年度统计按项目过滤正确');

/* ==================== 4. 项目全生命周期统计与连续天数 ==================== */

// 场景 A：最近连续段结束于 3 天前 → 当前连续应为 0
reset();
addCheckinItem('晨跑');
const [S] = getCheckinItems();
const rawS = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawS[0].createdAt = daysAgo(9);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawS));

// 连续 3 天（9、8、7 天前），断一天（6 天前），再连续 4 天（5、4、3、2 天前）
[9, 8, 7, 5, 4, 3, 2].forEach((n) => {
  toggleCheckin(daysAgo(n), S.id, true, { time: '07:00', note: '' });
});
toggleCheckin(daysAgo(6), S.id, false); // 明确中断

const statsA = getItemStats(S.id);
assert.equal(statsA.name, '晨跑');
assert.equal(statsA.totalDays, 10, `统计天数应为 10（创建日 ${daysAgo(9)} 至今），实际 ${statsA.totalDays}`);
assert.equal(statsA.doneDays, 7, `完成天数应为 7，实际 ${statsA.doneDays}`);
assert.equal(statsA.missedDays, 3, `未完成应为 3，实际 ${statsA.missedDays}`);
assert.equal(statsA.rate, 70, `完成率应为 70%，实际 ${statsA.rate}`);
assert.equal(statsA.longestStreak, 4, `最长连续应为 4，实际 ${statsA.longestStreak}`);
assert.equal(statsA.currentStreak, 0, `连续段已断在 2 天前，当前连续应为 0，实际 ${statsA.currentStreak}`);
assert.equal(statsA.firstDone, daysAgo(9));
assert.equal(statsA.lastDone, daysAgo(2));
console.log('OK: 场景A（连续段已中断）统计正确 →', JSON.stringify({
  total: statsA.totalDays, done: statsA.doneDays, rate: statsA.rate,
  current: statsA.currentStreak, longest: statsA.longestStreak,
}));

// 场景 B：今天也打卡 → 当前连续应接上
reset();
addCheckinItem('读书');
const [T] = getCheckinItems();
const rawT = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawT[0].createdAt = daysAgo(5);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawT));

[5, 4, 3, 2, 1, 0].forEach((n) => {
  toggleCheckin(daysAgo(n), T.id, true, { time: '22:00', note: '' });
});

const statsB = getItemStats(T.id);
assert.equal(statsB.doneDays, 6);
assert.equal(statsB.totalDays, 6);
assert.equal(statsB.rate, 100);
assert.equal(statsB.longestStreak, 6, `最长连续应为 6，实际 ${statsB.longestStreak}`);
assert.equal(statsB.currentStreak, 6, `今天已打卡，当前连续应为 6，实际 ${statsB.currentStreak}`);
console.log('OK: 场景B（全勤含今天）当前连续计算正确');

// 场景 C：今天还没打卡，但昨天打了 → 当前连续算到昨天，不视为中断
reset();
addCheckinItem('喝水');
const [U] = getCheckinItems();
const rawU = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawU[0].createdAt = daysAgo(4);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawU));

[4, 3, 2, 1].forEach((n) => {
  toggleCheckin(daysAgo(n), U.id, true, { time: '09:00', note: '' });
});
// 今天不操作

const statsC = getItemStats(U.id);
assert.equal(statsC.doneDays, 4);
assert.equal(statsC.totalDays, 5, `总天数应含今天共 5 天，实际 ${statsC.totalDays}`);
assert.equal(statsC.currentStreak, 4, `今天未打卡但昨天打了，当前连续应为 4，实际 ${statsC.currentStreak}`);
assert.equal(statsC.rate, 80, `完成率应为 80%，实际 ${statsC.rate}`);
console.log('OK: 场景C（今天未打卡，昨天连着）不中断当前连续');

// 场景 D：项目不存在时应返回 null
assert.equal(getItemStats('not-exist-id'), null, '不存在的 id 应返回 null');
console.log('OK: 不存在的 id 返回 null');

// 场景 E：只有今天打了，昨天没打 → 当前连续应重新开始计为 1
reset();
addCheckinItem('冥想');
const [V] = getCheckinItems();
toggleCheckin(daysAgo(0), V.id, true, { time: '06:00', note: '' });
const statsE = getItemStats(V.id);
assert.equal(statsE.doneDays, 1);
assert.equal(statsE.currentStreak, 1, `只有今天打卡，当前连续应为 1，实际 ${statsE.currentStreak}`);
assert.equal(statsE.longestStreak, 1);
console.log('OK: 场景E（仅今天打卡）当前连续重置为 1');

// 场景 F：从未打卡 → 不应崩溃，各项归零
reset();
addCheckinItem('从未打卡项目');
const [W] = getCheckinItems();
const statsF = getItemStats(W.id);
assert.equal(statsF.doneDays, 0);
assert.equal(statsF.rate, 0, `从未打卡完成率应为 0，实际 ${statsF.rate}`);
assert.equal(statsF.currentStreak, 0);
assert.equal(statsF.longestStreak, 0);
assert.equal(statsF.firstDone, '', '从未打卡时 firstDone 应为空');
assert.equal(statsF.lastDone, '', '从未打卡时 lastDone 应为空');
console.log('OK: 场景F（从未打卡）不崩溃且各项归零');

// ==================== 场景G：全部项目聚合统计（全勤日口径） ====================
reset();
addCheckinItem('晨跑');
addCheckinItem('读书');
const [P1, P2] = getCheckinItems();
const rawP = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawP[0].createdAt = daysAgo(9);
rawP[1].createdAt = daysAgo(9);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawP));
[9, 8, 6, 5].forEach((n) => {
  toggleCheckin(daysAgo(n), P1.id, true, { time: '07:00', note: '' });
  toggleCheckin(daysAgo(n), P2.id, true, { time: '07:00', note: '' });
});
toggleCheckin(daysAgo(7), P1.id, true, { time: '07:00', note: '' });
const overall = getOverallStats();
assert.equal(overall.totalDays, 10, `全部项目总天数应为 10，实际 ${overall.totalDays}`);
assert.equal(overall.doneDays, 4, `全部项目全勤日应为 4，实际 ${overall.doneDays}`);
assert.equal(overall.rate, 40, `全部项目全勤率应为 40%，实际 ${overall.rate}`);
assert.equal(overall.longestStreak, 2, `全部项目最长连续全勤应为 2，实际 ${overall.longestStreak}`);
assert.equal(overall.currentStreak, 0, `全部项目当前连续应为 0，实际 ${overall.currentStreak}`);
console.log('OK: 场景G（全部项目聚合统计-全勤日口径）正确');

// ==================== 场景H：无项目时聚合统计返回 null ====================
reset();
assert.equal(getOverallStats(), null, '无项目时 getOverallStats 应为 null');
console.log('OK: 场景H（无项目时 getOverallStats 返回 null）');

// ==================== 场景I：多项视图的分母口径与单项目 / 全局统计一致 ====================
// 起因：不传 itemId 时 total 恒等于「项目总数」，于是项目创建之前和还没到来的日子
// 都被当成未完成，多项视图的完成率被系统性拉低（跨年视图把整个未来月份算成 0%）。
reset();
addCheckinItem('早项目');
addCheckinItem('晚项目');
const [I1, I2] = getCheckinItems();
const rawI = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawI[0].createdAt = daysAgo(20);
rawI[1].createdAt = daysAgo(3);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawI));
[20, 10, 4, 1].forEach((n) => toggleCheckin(daysAgo(n), I1.id, true, { time: '07:00', note: '' }));
[3, 1].forEach((n) => toggleCheckin(daysAgo(n), I2.id, true, { time: '07:00', note: '' }));

const nowI = new Date();
const monthI = getMonthlyData(nowI.getFullYear(), nowI.getMonth() + 1);
monthI.forEach((d) => {
  const shouldCount = d.date <= fmt(nowI);
  const activeCount = [rawI[0], rawI[1]].filter((i) => i.createdAt <= d.date).length;
  if (shouldCount && activeCount > 0) {
    assert.equal(d.total, activeCount, `${d.date} 的分母应为当日已存在的项目数 ${activeCount}，实际 ${d.total}`);
    assert.equal(d.excluded, undefined, `${d.date} 已到来且有项目，不该标记 excluded`);
  } else {
    assert.equal(d.total, 0, `${d.date}（项目未创建或日子还没到）不该计入分母，实际 ${d.total}`);
    assert.equal(d.excluded, true, `${d.date} 应标记 excluded`);
  }
});

// 多项月度汇总 = 各单项目月度汇总之和（同口径才能对齐）
const sumOf = (rows) => rows.reduce((n, d) => n + d.total, 0);
const sumDone = (rows) => rows.reduce((n, d) => n + d.completed, 0);
const single = [I1.id, I2.id].map((id) => getMonthlyData(nowI.getFullYear(), nowI.getMonth() + 1, id));
assert.equal(sumOf(monthI), single.reduce((n, rows) => n + sumOf(rows), 0), '多项 total 应等于各单项目 total 之和');
assert.equal(sumDone(monthI), single.reduce((n, rows) => n + sumDone(rows), 0), '多项 completed 应等于各单项目 completed 之和');

// 完成率的分母只含「项目存在且日子已到」的 项目·天，不再是 天数 × 项目数
const monthPrefix = `${nowI.getFullYear()}-${pad2(nowI.getMonth() + 1)}`;
const donePairs = [
  ...[20, 10, 4, 1].map((n) => ({ date: daysAgo(n), item: I1.id })),
  ...[3, 1].map((n) => ({ date: daysAgo(n), item: I2.id })),
].filter((p) => p.date.startsWith(monthPrefix) && p.date <= fmt(nowI));
const expectedTotal = sumOf(monthI);
const doneI = sumDone(monthI);
assert.equal(doneI, donePairs.length, `本月应统计到 ${donePairs.length} 次完成，实际 ${doneI}`);
assert.ok(expectedTotal < monthI.length * 2, `分母不该是「天数 × 项目数」，实际 ${expectedTotal} / ${monthI.length * 2}`);
assert.ok(expectedTotal > doneI, '分母应大于分子（存在未打卡的日子）');

// 未来月份不再被算成一堆 0%：年度汇总只统计已经到来的日子
const yearI = getYearlyData(nowI.getFullYear());
const futureMonths = yearI.monthData.filter((m) => Number(m.month.slice(5, 7)) > nowI.getMonth() + 1);
futureMonths.forEach((m) => {
  assert.equal(m.total, 0, `${m.month} 还没到来，不应有分母 ${m.total}`);
});
assert.equal(yearI.avgRate, Math.round(
  yearI.monthData.reduce((n, m) => n + m.completed, 0) / yearI.monthData.reduce((n, m) => n + m.total, 0) * 100,
), '年度完成率应基于已到来的项目·天数');
console.log(`OK: 场景I（多项口径按当日已存在项目 + 不统计未来日）${doneI}/${expectedTotal} → ${Math.round(doneI / expectedTotal * 100)}%`);

// ==================== 场景J：汇总统计按所选区间算，不再拿全生命周期当基准 ====================
// 起因：统计卡上的「完成天数 / 完成率 / 当前连续 / 最长连续」曾经只有「创建日 → 今天」一套口径，
// 切到月度 / 季度 / 年度视图时数字纹丝不动，与视图标题自相矛盾。
reset();
{
  // 视图区间的边界先单独钉住（含闰年 2 月与季度末）
  assert.deepEqual(getViewRange('monthly', 2026, 2), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(getViewRange('monthly', 2024, 2), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(getViewRange('yearly', 2026), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(getViewRange('quarterly', 2026, null, 1), { start: '2026-01-01', end: '2026-03-31' });
  assert.deepEqual(getViewRange('quarterly', 2026, null, 4), { start: '2026-10-01', end: '2026-12-31' });
}

reset();
addCheckinItem('晨跑');
const [J] = getCheckinItems();
const rawJ = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawJ[0].createdAt = daysAgo(45);
localStorage.setItem('daily_checkin_items', JSON.stringify(rawJ));
// 从创建日到今天，一天不落
for (let n = 45; n >= 0; n -= 1) {
  toggleCheckin(daysAgo(n), J.id, true, { time: '07:00', note: '' });
}

const nowJ = new Date();
const lifeJ = getItemStats(J.id);
assert.equal(lifeJ.totalDays, 46, `全生命周期应为 46 天，实际 ${lifeJ.totalDays}`);
assert.equal(lifeJ.longestStreak, 46, '全生命周期的连续可以跨月');

const jMonthPrefix = `${nowJ.getFullYear()}-${pad2(nowJ.getMonth() + 1)}`;
const mRange = getViewRange('monthly', nowJ.getFullYear(), nowJ.getMonth() + 1);
const mJ = getItemStats(J.id, mRange);
assert.equal(mJ.rangeStart, `${jMonthPrefix}-01`, '月度区间起点应为当月 1 号');
assert.equal(mJ.rangeEnd, fmt(nowJ), `区间末必须裁剪到今天，实际 ${mJ.rangeEnd}`);
assert.equal(mJ.totalDays, nowJ.getDate(), `月度分母应为当月已到来的 ${nowJ.getDate()} 天，实际 ${mJ.totalDays}`);
assert.equal(mJ.doneDays, mJ.totalDays);
assert.equal(mJ.rate, 100);
assert.equal(mJ.longestStreak, mJ.totalDays, `月度视图的最长连续不得跨出当月（实际 ${mJ.longestStreak}）`);
assert.equal(mJ.currentStreak, mJ.totalDays);
assert.equal(mJ.firstDone, `${jMonthPrefix}-01`, '首次完成也应落在区间内');

// 季度 / 年度各自算自己那段，且与「在册区间」求交
const qIdx = Math.floor(nowJ.getMonth() / 3) + 1;
const qRange = getViewRange('quarterly', nowJ.getFullYear(), null, qIdx);
const qJ = getItemStats(J.id, qRange);
assert.equal(qJ.totalDays, activeDaysIn(qRange.start, qRange.end, daysAgo(45), ''),
  `季度分母应为区间内在册的 ${activeDaysIn(qRange.start, qRange.end, daysAgo(45), '')} 天，实际 ${qJ.totalDays}`);
assert.equal(qJ.longestStreak, qJ.totalDays, '季度区间内的连续不应跨出季度起点');

const yRange = getViewRange('yearly', nowJ.getFullYear());
const yJ = getItemStats(J.id, yRange);
assert.equal(yJ.rangeStart, daysAgo(45), `年度区间应与创建日求交，实际 ${yJ.rangeStart}`);
assert.equal(yJ.totalDays, activeDaysIn(yRange.start, yRange.end, daysAgo(45), ''));
assert.equal(yJ.totalDays, 46, '创建日落在本年度内，年度区间应等于全生命周期');

// 查看上个月：连续算到该月末，而不是把今天的实时值搬过来
const prevMonth = new Date(nowJ.getFullYear(), nowJ.getMonth() - 1, 1);
const pRange = getViewRange('monthly', prevMonth.getFullYear(), prevMonth.getMonth() + 1);
const pJ = getItemStats(J.id, pRange);
assert.equal(pJ.totalDays, activeDaysIn(pRange.start, pRange.end, daysAgo(45), ''));
assert.equal(pJ.rangeEnd, pRange.end, '历史月份的区间末就是该月最后一天，不该裁剪到今天');
assert.equal(pJ.currentStreak, pJ.totalDays, '历史月份显示的应是截至该月末的连续');
assert.equal(pJ.lastDone, pRange.end);

// 未来年度：整天没有一天在册，应报「无可统计」而不是 0% 完成率
const futureJ = getItemStats(J.id, getViewRange('yearly', nowJ.getFullYear() + 1));
assert.equal(futureJ.empty, true, '未来区间应整体不参与统计');
assert.equal(futureJ.totalDays, 0);
assert.equal(futureJ.rate, 0);
assert.equal(futureJ.currentStreak, 0);
console.log('OK: 场景J（完成天数/完成率/连续全部按月度·季度·年度区间计算）');

// ==================== 场景K：归档 = 退出界面，但不追溯改写历史 ====================
reset();
addCheckinItem('阶段性项目');
addCheckinItem('仍在册项目');
const [KA, KB] = getCheckinItems();
const rawK = JSON.parse(localStorage.getItem('daily_checkin_items'));
rawK.forEach((i) => { i.createdAt = daysAgo(20); });
localStorage.setItem('daily_checkin_items', JSON.stringify(rawK));
for (let n = 20; n >= 1; n -= 1) {
  [KA, KB].forEach((it) => toggleCheckin(daysAgo(n), it.id, true, { time: '07:00', note: '' }));
}
// 今天只打 KB，然后把 KA 归档（归档日 = 今天）
toggleCheckin(daysAgo(0), KB.id, true, { time: '07:00', note: '' });
archiveCheckinItem(KA.id);

assert.equal(getActiveCheckinItems().length, 1, '归档项不应再出现在可见列表里');
assert.equal(getActiveCheckinItems()[0].id, KB.id);
assert.equal(getArchivedCheckinItems().length, 1, '归档项应能在归档清单里查到');
assert.equal(getArchivedCheckinItems()[0].archivedAt, fmt(nowJ), '归档日应为今天');

// 今日完成 x/y：归档当天起不再计入分母，昨天两点都打了卡仍是全勤
assert.equal(getCheckinStats(daysAgo(0)).total, 1, `归档后今天的分母应为 1，实际 ${getCheckinStats(daysAgo(0)).total}`);
assert.equal(getCheckinStats(daysAgo(0)).completed, 1);
assert.equal(getCheckinStats(daysAgo(1)).total, 2, '归档不得改写昨天的分母');
assert.equal(getCheckinStats(daysAgo(1)).completed, 2, '昨天的完成记录必须照旧统计');

// 热力图口径：归档日及以后 excluded，之前一天不少
const kMonth = getMonthlyData(nowJ.getFullYear(), nowJ.getMonth() + 1, KA.id);
const kToday = kMonth.find((d) => d.date === fmt(nowJ));
assert.equal(kToday.excluded, true, '归档日及以后不该参与统计');
assert.equal(kToday.total, 0);
const kYesterday = kMonth.find((d) => d.date === daysAgo(1));
if (daysAgo(1).slice(0, 7) === jMonthPrefix) {
  assert.equal(kYesterday.excluded, undefined, '归档日之前仍应参与统计');
  assert.equal(kYesterday.total, 1);
  assert.equal(kYesterday.completed, 1);
}

// 不变式：归档后「各单项目 total 之和 == 聚合 total」仍然成立
const kAll = getMonthlyData(nowJ.getFullYear(), nowJ.getMonth() + 1);
const sumTotal = (rows) => rows.reduce((n, d) => n + d.total, 0);
const kSingleSum = [KA.id, KB.id]
  .reduce((n, id) => n + sumTotal(getMonthlyData(nowJ.getFullYear(), nowJ.getMonth() + 1, id)), 0);
assert.equal(sumTotal(kAll), kSingleSum, '归档后单项目与聚合的分母仍要能相加对齐');

// 聚合统计：归档当天只剩在册项目，全勤率不该被归档拉低
const overallK = getOverallStats(getViewRange('monthly', nowJ.getFullYear(), nowJ.getMonth() + 1));
assert.equal(overallK.doneDays, overallK.totalDays, '归档后当月全勤日应等于在册日');
assert.equal(overallK.rate, 100, `归档不应拉低完成率，实际 ${overallK.rate}%`);

// 归档项目的历史：区间求交后只算归档日之前
const archivedLifeK = getItemStats(KA.id);
assert.equal(archivedLifeK.totalDays, activeDaysIn(daysAgo(20), fmt(nowJ), daysAgo(20), fmt(nowJ)));
assert.equal(archivedLifeK.doneDays, archivedLifeK.totalDays, '归档项目的历史完成率应保持 100%');
assert.equal(archivedLifeK.empty, false);

// 取消归档：字段整体消失，历史重新完整参与
unarchiveCheckinItem(KA.id);
assert.equal(getActiveCheckinItems().length, 2, '恢复归档后应重新可见');
assert.equal(getArchivedCheckinItems().length, 0);
const rawK2 = JSON.parse(localStorage.getItem('daily_checkin_items')).find((i) => i.id === KA.id);
assert.equal(rawK2.archived, undefined, '取消归档应删掉归档字段');
assert.equal(rawK2.archivedAt, undefined, '取消归档应删掉归档日期');
assert.equal(getCheckinStats(daysAgo(0)).total, 2, '恢复后今天重新计入分母');

// 界面拖拽只传可见项的 id，归档项不得被顺手抹掉
archiveCheckinItem(KA.id);
reorderCheckinItems([KB.id]);
assert.equal(getCheckinItems().length, 2, 'reorder 不得把没传入的归档项从存储里抹掉');
assert.equal(getActiveCheckinItems().length, 1);
assert.equal(getCheckinItems().find((i) => i.id === KA.id).archived, true, '归档状态应原样保留');
console.log('OK: 场景K（归档退出界面与当日分母，历史与分母对齐不受损）');

console.log('\n全部验证通过 ✅');
