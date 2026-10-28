/**
 * 临时验证脚本：老黄历数据层
 * 用法: node .workbuddy/verify-almanac.mjs（需经 esbuild 打包，见 package.json 的 verify:almanac）
 */
import assert from 'node:assert/strict';

const {
  getAlmanac,
  shiftAlmanacDate,
  isValidAlmanacDate,
} = await import('../src/utils/almanac.js');

/* ==================== 1. 已知日期（春节 / 农历年边界） ==================== */
{
  const spring = getAlmanac('2026-02-17');
  assert.ok(spring, '2026-02-17 应能取到黄历');
  assert.equal(spring.lunarText, '二〇二六年正月初一', '2026-02-17 应为正月初一');
  assert.equal(spring.yearGanZhi, '丙午');
  assert.equal(spring.zodiac, '马');
  assert.ok(spring.festivals.includes('春节'), '正月初一应带春节标记');

  const beforeSpring = getAlmanac('2026-01-01');
  assert.equal(beforeSpring.lunarText, '二〇二五年冬月十三', '公历年初仍属上一个农历年');
  assert.equal(beforeSpring.yearGanZhi, '乙巳', '农历年干支应按农历年，不按公历年');
  assert.equal(beforeSpring.zodiac, '蛇');
  assert.ok(beforeSpring.festivals.includes('元旦节'));

  const newYearEve = getAlmanac('2024-02-09');
  assert.equal(newYearEve.lunarText, '二〇二三年腊月三十');
  assert.ok(newYearEve.festivals.includes('除夕'));
  const newYearDay = getAlmanac('2024-02-10');
  assert.equal(newYearDay.lunarText, '二〇二四年正月初一');
  assert.equal(newYearDay.yearGanZhi, '甲辰');
  assert.equal(newYearDay.zodiac, '龙');
  assert.ok(newYearDay.festivals.includes('春节'));

  assert.equal(getAlmanac('2024-02-24').festivals.includes('元宵节'), true);
  assert.equal(getAlmanac('2024-06-10').festivals.includes('端午节'), true);
  assert.equal(getAlmanac('2024-09-17').festivals.includes('中秋节'), true);
  console.log('OK: 已知日期与农历年边界');
}

/* ==================== 2. 单日完整字段 ==================== */
{
  const day = getAlmanac('2026-10-28');
  assert.ok(day);
  assert.equal(day.lunarText, '二〇二六年九月十九');
  assert.equal(day.yearGanZhi, '丙午');
  assert.equal(day.monthGanZhi, '戊戌');
  assert.equal(day.dayGanZhi, '乙亥');
  assert.equal(day.zodiac, '马');
  assert.match(day.chong, /蛇/, '乙亥日应冲蛇');
  assert.equal(day.sha, '西');
  assert.equal(day.tianShen, '玉堂');
  assert.equal(day.tianShenType, '黄道');
  assert.equal(day.tianShenLuck, '吉');
  assert.equal(day.zhiXing, '除');
  assert.equal(day.naYin, '山头火');
  assert.equal(day.xiu, '壁');
  assert.equal(day.xiuLuck, '吉');
  assert.ok(day.taiShen);
  assert.ok(day.wuHou);
  assert.ok(day.yueXiang);
  assert.equal(day.pengZu.length, 2);
  assert.ok(day.jiShen.length > 0);
  assert.ok(day.xiongSha.length > 0);
  assert.ok(day.directions.xi && day.directions.fu && day.directions.cai);
  assert.ok(day.directions.yangGui && day.directions.yinGui);

  // 霜降 10-23，立冬 11-07，中间隔着 10 天
  assert.equal(day.jieQi, '');
  assert.equal(day.prevJieQi.name, '霜降');
  assert.equal(day.prevJieQi.date, '2026-10-23');
  assert.equal(day.nextJieQi.name, '立冬');
  assert.equal(day.nextJieQi.date, '2026-11-07');
  assert.equal(day.nextJieQi.daysLeft, 10);

  assert.equal(day.times.length, 13, '自然日里子时被拆成 00 点与 23 点两段');
  assert.equal(day.times[0].start, '00:00');
  assert.equal(day.times[0].end, '00:59');
  assert.equal(day.times[day.times.length - 1].start, '23:00');
  assert.equal(day.times[day.times.length - 1].end, '23:59');
  day.times.forEach((t) => {
    assert.ok(t.ganZhi && t.start && t.end && t.tianShen);
    assert.ok(t.type === '黄道' || t.type === '黑道');
    assert.ok(t.luck === '吉' || t.luck === '凶');
  });
  assert.ok(day.times.some((t) => t.type === '黄道'));
  console.log('OK: 单日完整字段');
}

/* ==================== 3. 节气边界 ==================== */
{
  const termDay = getAlmanac('2026-10-23');
  assert.equal(termDay.jieQi, '霜降');
  assert.equal(termDay.prevJieQi.name, '霜降', '节气当天上一个节气就是当天这个');
  assert.equal(termDay.nextJieQi.name, '立冬');
  assert.ok(termDay.nextJieQi.daysLeft > 0);

  const dayBefore = getAlmanac('2026-10-22');
  assert.equal(dayBefore.jieQi, '');
  assert.equal(dayBefore.prevJieQi.name, '寒露');
  assert.equal(dayBefore.nextJieQi.name, '霜降');
  assert.equal(dayBefore.nextJieQi.daysLeft, 1, '节气前一天应显示 1 天后');
  console.log('OK: 节气边界');
}

/* ==================== 4. 闰月与闰日 ==================== */
{
  assert.equal(getAlmanac('2023-02-20').lunarText, '二〇二三年二月初一');
  assert.equal(getAlmanac('2023-03-22').lunarText, '二〇二三年闰二月初一', '2023 年闰二月');
  assert.equal(getAlmanac('2024-02-29').lunarText, '二〇二四年正月二十', '闰日应正常推算');
  assert.equal(isValidAlmanacDate('2024-02-29'), true);
  assert.equal(isValidAlmanacDate('2025-02-29'), false);
  assert.equal(isValidAlmanacDate('2026-04-31'), false);
  console.log('OK: 闰月与闰日');
}

/* ==================== 5. 日期位移与非法输入 ==================== */
{
  assert.equal(shiftAlmanacDate('2026-10-28', 1), '2026-10-29');
  assert.equal(shiftAlmanacDate('2026-10-28', -1), '2026-10-27');
  assert.equal(shiftAlmanacDate('2026-10-28', 0), '2026-10-28');
  assert.equal(shiftAlmanacDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftAlmanacDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftAlmanacDate('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftAlmanacDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftAlmanacDate('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftAlmanacDate('2025-02-28', 1), '2025-03-01');
  assert.equal(shiftAlmanacDate('2024-03-01', -1), '2024-02-29');

  assert.equal(shiftAlmanacDate('not-a-date', 1), '');
  assert.equal(getAlmanac('2026-02-31'), null, '2 月 31 日不能进位成 3 月 3 日');
  assert.equal(getAlmanac('2026-13-01'), null);
  assert.equal(getAlmanac('2026-1-01'), null, '只接受 YYYY-MM-DD');
  assert.equal(getAlmanac(''), null);
  assert.equal(getAlmanac(null), null);
  console.log('OK: 日期位移与非法输入');
}

/* ==================== 6. 全年扫描（闰年 366 天） ==================== */
{
  let cursor = '2024-01-01';
  let termDays = 0;
  for (let i = 0; i < 366; i += 1) {
    const day = getAlmanac(cursor);
    assert.ok(day, `${cursor} 应能取到黄历`);
    assert.equal(day.date, cursor);
    assert.ok(day.lunarText);
    assert.ok(Array.isArray(day.yi) && Array.isArray(day.ji));
    assert.equal(day.times.length, 13, `${cursor} 应有 13 个时辰段`);
    assert.ok(day.nextJieQi, `${cursor} 应有下一个节气`);
    assert.ok(day.nextJieQi.daysLeft > 0 && day.nextJieQi.daysLeft <= 16, `${cursor} 距下一节气应在半个节气周期内`);
    if (day.jieQi) termDays += 1;
    cursor = shiftAlmanacDate(cursor, 1);
  }
  assert.equal(cursor, '2025-01-01', '366 天后应跨到下一年');
  assert.equal(termDays, 24, '一年应有 24 个节气日');
  console.log('OK: 2024 全年 366 天扫描（24 个节气）');
}

/* ==================== 7. 历法可用年份边界 ==================== */
{
  assert.ok(getAlmanac('1900-01-01'));
  assert.ok(getAlmanac('2100-12-31'));
  console.log('OK: 1900 / 2100 边界可推算');
}

console.log('\n全部验证通过 ✅');
