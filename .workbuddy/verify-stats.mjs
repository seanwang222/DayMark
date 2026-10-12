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
  addCheckinItem, toggleCheckin, getCheckinItems,
  getMonthlyData, getQuarterlyData, getYearlyData,
  getItemStats, getOverallStats,
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

console.log('\n全部验证通过 ✅');
