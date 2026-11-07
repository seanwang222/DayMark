/**
 * 临时验证脚本：老黄历数据层
 * 用法: node .workbuddy/verify-almanac.mjs（需经 esbuild 打包，见 package.json 的 verify:almanac）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import lunarPkg from 'lunar-javascript';
import * as TERMS from '../src/utils/almanacTerms.js';
import {
  explainTerm,
  explainGanZhi,
  explainChongSha,
  explainXiu,
  explainTianShen,
  explainTaiShen,
  explainHour,
} from '../src/utils/almanacGlossary.js';

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

/* ==================== 8. 词表与历库词表逐项对齐 ==================== */
/**
 * 抽样扫描查不出漏词：有些宜忌写法十几年才推出来一次。
 * 历库把自己的词表挂在 LunarUtil / SolarUtil 上，直接拿它当全集逐项比对，
 * 覆盖率才是完整的，而且不用扫几万天。
 */
{
  const { LunarUtil: U, SolarUtil: S } = lunarPkg;
  // 有的表是数组，有的是「索引 → 值」对象；值里还混着未解析的 {xx.bi} 模板与空串占位
  const words = (table) => {
    const raw = Array.isArray(table) ? table : Object.values(table || {});
    const out = [];
    raw.forEach((v) => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string'));
    });
    return Array.from(new Set(out)).filter((w) => w && w !== '无' && !w.startsWith('{'));
  };
  const covers = (dict, list, name) => {
    const missing = list.filter((w) => !dict[w]);
    assert.deepEqual(missing, [], `${name} 漏收词条: ${missing.join('、')}`);
  };

  covers(TERMS.YI_JI, words(U.YI_JI), '宜忌 YI_JI');
  covers(TERMS.JIE_QI, words(U.JIE_QI), '节气 JIE_QI');
  covers(TERMS.TIAN_SHEN, words(U.TIAN_SHEN), '值神 TIAN_SHEN');
  covers(TERMS.ZODIAC, words(U.SHENGXIAO), '生肖 ZODIAC');
  covers(TERMS.WU_HOU, words(U.WU_HOU), '物候 WU_HOU');
  covers(TERMS.YUE_XIANG, words(U.YUE_XIANG), '月相 YUE_XIANG');
  covers(TERMS.XIU, words(U.XIU), '二十八宿 XIU');
  covers(TERMS.PENG_ZU, [...words(U.PENGZU_GAN), ...words(U.PENGZU_ZHI)], '彭祖百忌 PENG_ZU');
  covers(TERMS.ZHI_XING, '建除满平定执破危成收开闭'.split(''), '建除十二神 ZHI_XING');

  // 吉神与凶煞共用历库的一张 SHEN_SHA 表，取词时才分到两个分区
  const shenSha = new Set([...Object.keys(TERMS.JI_SHEN), ...Object.keys(TERMS.XIONG_SHA)]);
  const shenMissing = words(U.SHEN_SHA).filter((w) => !shenSha.has(w));
  assert.deepEqual(shenMissing, [], `吉神 / 凶煞漏收: ${shenMissing.join('、')}`);

  // 页面只会收到这三份节日；SolarUtil.OTHER_FESTIVAL 与 WEEK_FESTIVAL 不在取数链上
  covers(
    TERMS.FESTIVAL,
    [...words(S.FESTIVAL), ...words(U.FESTIVAL), ...words(U.OTHER_FESTIVAL)],
    '节日 FESTIVAL',
  );

  assert.equal(Object.keys(TERMS.NA_YIN).length, 30, '纳音应为三十组');
  assert.equal(Object.keys(TERMS.XIU).length, 28, '二十八宿应为二十八条');
  assert.equal(Object.keys(TERMS.WU_HOU).length, 72, '物候应为七十二条');
  assert.equal(Object.keys(TERMS.PENG_ZU).length, 22, '彭祖百忌应为天干十句 + 地支十二句');
  console.log('OK: 词表与历库词表逐项对齐（宜忌 / 神煞 / 节气 / 值神 / 生肖 / 物候 / 月相 / 星宿 / 彭祖 / 节日）');
}

/* ==================== 9. 页面取词接线 ==================== */
{
  const src = fs.readFileSync(new URL('../src/pages/AlmanacPage.jsx', import.meta.url), 'utf8');
  const categories = new Set([
    'yi', 'ji', 'jiShen', 'xiongSha', 'zhiXing', 'tianShen', 'naYin',
    'wuHou', 'yueXiang', 'jieQi', 'festival', 'pengZu', 'zodiac', 'label',
  ]);

  const used = [...src.matchAll(/explainTerm\([^,]+,\s*'([a-zA-Z]+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, '页面应通过 explainTerm 取词');
  used.forEach((c) => assert.ok(categories.has(c), `页面用了未定义的分区「${c}」`));

  const tagLists = [...src.matchAll(/<TagList\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(tagLists.length >= 4, '宜 / 忌 / 吉神 / 凶煞四处都应是 TagList');
  tagLists.forEach((tag) => {
    const m = /category="([a-zA-Z]+)"/.exec(tag);
    assert.ok(m, `TagList 缺 category，chip 就不会有解释: ${tag}`);
    assert.ok(categories.has(m[1]), `TagList 分区「${m[1]}」未定义`);
  });

  // 分区标题与字段名走 label 表，写错一个字就静默没有弹窗
  const labels = [...src.matchAll(/explainTerm\('([^']+)',\s*'label'\)/g)].map((m) => m[1]);
  assert.ok(labels.length >= 8, '分区标题与主卡标签应挂 label 解释');
  labels.forEach((l) => assert.ok(TERMS.LABELS[l], `LABELS 缺少「${l}」`));

  // 日辰详情与吉神方位的字段名是变量取词，只能从数组字面量里核对
  const fieldLabels = [...src.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(fieldLabels.length, 13, '日辰详情八项 + 吉神方位五项都应带 label');
  fieldLabels.forEach((l) => assert.ok(TERMS.LABELS[l], `LABELS 缺少字段名「${l}」`));

  assert.match(src, /import \{[\s\S]*?explainHour[\s\S]*?\} from '\.\.\/utils\/almanacGlossary'/, '时辰卡应引入 explainHour');
  assert.match(src, /explainHour\(time\)/, '时辰卡应按整段取解释');
  console.log(`OK: 页面取词接线（${used.length} 处 explainTerm、${tagLists.length} 处 TagList、${labels.length} 处 label）`);
}

/* ==================== 10. 组合串解析 ==================== */
{
  const ok = (e, name) => {
    assert.ok(e, `${name} 应能解析`);
    assert.ok(e.title && e.tag, `${name} 应有标题与类别`);
    assert.ok(e.lines.length >= 2, `${name} 至少应有概念与当日取值两行`);
    e.lines.forEach((l) => {
      assert.ok(typeof l === 'string' && l.length > 0, `${name} 不应有空行`);
      assert.ok(!/undefined|null|\{[a-z]+\./i.test(l), `${name} 解释里混进了占位符: ${l}`);
    });
  };

  // 胎神：历库共 60 种占方写法，处所词必须全部被切出来，不能留下未收录的字
  const taiWords = Array.from(new Set(Object.values(lunarPkg.LunarUtil.POSITION_TAI_DAY)));
  assert.equal(taiWords.length, 60, '胎神占方应有 60 种');
  const partKeys = Object.keys(TERMS.TAI_SHEN_PARTS);
  taiWords.forEach((text) => {
    ok(explainTaiShen(text), `胎神「${text}」`);
    const place = text.split(/\s+/)[0];
    [...place].forEach((ch) => {
      assert.ok(partKeys.some((k) => k.includes(ch)), `胎神处所词「${place}」里的「${ch}」未收录`);
    });
  });
  const sample = explainTaiShen('碓磨床 外西南');
  assert.ok(sample.lines.some((l) => l.startsWith('碓磨：')), '「碓磨」应作一个词切出，不能拆成碓 + 磨');
  assert.ok(sample.lines.some((l) => l.startsWith('床：')));
  assert.ok(sample.lines.some((l) => l.startsWith('外：')));
  assert.ok(!sample.lines.some((l) => /西南$/.test(l) && l.startsWith('外西南：')), '方位不应被当成处所词重复解释');

  // 冲煞：chong 形如「(己巳)蛇」
  const chong = explainChongSha('(己巳)蛇', '西');
  ok(chong, '冲煞');
  assert.equal(chong.title, '冲(己巳)蛇 · 煞西');
  assert.ok(chong.lines.some((l) => l.includes('己巳')), '应解释括号里的天克地冲干支');
  assert.ok(chong.lines.some((l) => l.includes('生肖蛇')), '应带上被冲生肖的解释');
  assert.ok(chong.lines.some((l) => l.includes('煞方在「西」')));
  assert.ok(explainChongSha('(甲子)马', '').lines.length >= 2, '煞方为空时仍应解释冲');
  assert.equal(explainChongSha('', '西'), null);

  // 星宿与值神：全表逐个解析
  Object.entries(TERMS.XIU).forEach(([name, entry]) => {
    const e = explainXiu(name, entry.full.slice(1, 2), entry.full.slice(2), '吉');
    ok(e, `星宿「${name}」`);
    assert.ok(e.title.startsWith(`${name}宿 · `), `星宿标题应带宿名: ${e.title}`);
    assert.ok(e.lines.some((l) => l.includes(entry.full)), `星宿解释应含「${entry.full}」`);
  });
  assert.equal(explainXiu('不存在', '', '', '吉'), null);

  Object.keys(TERMS.TIAN_SHEN).forEach((name) => {
    const type = ['青龙', '明堂', '金匮', '天德', '玉堂', '司命'].includes(name) ? '黄道' : '黑道';
    const e = explainTianShen(name, type, type === '黄道' ? '吉' : '凶');
    ok(e, `值神「${name}」`);
    assert.ok(e.lines.some((l) => l.includes(TERMS.LABELS[type])), `值神解释应说明${type}`);
  });
  assert.equal(explainTianShen('不存在', '黄道', '吉'), null);

  // 干支：六十甲子逐个拆得开
  lunarPkg.LunarUtil.JIA_ZI.forEach((gz) => {
    const e = explainGanZhi(gz);
    ok(e, `干支「${gz}」`);
    assert.ok(e.lines.some((l) => l.startsWith(`天干「${gz[0]}」`)));
    assert.ok(e.lines.some((l) => l.startsWith(`地支「${gz[1]}」`)));
  });
  assert.equal(explainGanZhi('甲'), null, '单字不是干支');
  assert.equal(explainGanZhi('甲丑丑'), null);
  assert.equal(explainGanZhi(' XX '), null);

  // 时辰卡：13 段自然日时辰全部有解释
  const day = getAlmanac('2026-10-28');
  day.times.forEach((t) => {
    const e = explainHour(t);
    ok(e, `时辰「${t.ganZhi} ${t.start}」`);
    assert.equal(e.title, `${t.ganZhi}时 · ${t.start}–${t.end}`);
    assert.ok(e.lines.some((l) => l.includes(`值神「${t.tianShen}」`)), '时辰解释应带值神');
    assert.ok(e.lines.some((l) => l.includes(TERMS.LABELS[t.type])), '时辰解释应说明黄道 / 黑道');
  });
  assert.equal(explainHour(null), null);
  assert.equal(explainHour({ ganZhi: '' }), null);
  console.log('OK: 组合串解析（胎神 60 / 星宿 28 / 值神 12 / 干支 60 / 时辰 13 / 冲煞）');
}

/* ==================== 11. 跨类重名与空值 ==================== */
{
  // 「危」在建除里是危日，在二十八宿里是危月燕；合表查就会串台
  const zhi = explainTerm('危', 'zhiXing');
  assert.equal(zhi.title, '危日');
  assert.equal(zhi.tag, '建除十二神');
  const xiu = explainXiu('危', '月', '燕', '凶');
  assert.equal(xiu.tag, '二十八宿');
  assert.ok(xiu.lines.some((l) => l.includes('危月燕')));
  assert.notEqual(zhi.lines[0], xiu.lines[1], '同一个「危」在两个分区必须是不同解释');

  // 「天德」既是值神也是吉神，「白虎」既是值神也是凶煞
  assert.equal(explainTerm('天德', 'tianShen').tag, '值神');
  assert.equal(explainTerm('天德', 'jiShen').tag, '吉神');
  assert.notEqual(explainTerm('天德', 'tianShen').lines[0], explainTerm('天德', 'jiShen').lines[0]);
  assert.equal(explainTerm('白虎', 'tianShen').tag, '值神');
  assert.equal(explainTerm('白虎', 'xiongSha').tag, '凶煞');
  assert.notEqual(explainTerm('白虎', 'tianShen').lines[0], explainTerm('白虎', 'xiongSha').lines[0]);
  assert.equal(explainTerm('危', 'jiShen'), null, '分区不匹配时不应跨表命中');

  // 「无」是历库塞在空列表里的占位词，不是词条；查不到一律 null，页面据此不挂 Tooltip
  ['无', '—', '', null, undefined].forEach((v) => {
    assert.equal(explainTerm(v, 'yi'), null, `占位值「${v}」不应有解释`);
  });
  assert.equal(explainTerm('诸事不宜', 'yi').title, '诸事不宜');
  assert.equal(explainTerm('祭祀', 'yi').lines[0], explainTerm('祭祀', 'ji').lines[0], '宜与忌共用一张表');
  assert.equal(explainTerm('祭祀', 'not-a-category'), null);
  assert.equal(explainTerm('不存在的词', 'yi'), null);
  assert.equal(explainTerm('祭祀', undefined), null);
  console.log('OK: 跨类重名分区解释、占位词与未收录词返回 null');
}

/* ==================== 12. 两年逐日扫描：页面上每个词都有解释 ==================== */
{
  const seen = { naYin: new Set(), wuHou: new Set(), yueXiang: new Set(), xiu: new Set(), pengZu: new Set() };
  let cursor = '2025-01-01';
  for (let i = 0; i < 730; i += 1) {
    const d = getAlmanac(cursor);
    assert.ok(d, `${cursor} 应能取到黄历`);
    const check = (list, category) => {
      list.forEach((w) => {
        if (w === '无') return;
        const e = explainTerm(w, category);
        assert.ok(e && e.lines.length > 0, `${cursor} 的「${w}」（${category}）没有解释`);
      });
    };
    check(d.yi, 'yi');
    check(d.ji, 'ji');
    check(d.jiShen, 'jiShen');
    check(d.xiongSha, 'xiongSha');
    check(d.festivals, 'festival');
    check(d.pengZu, 'pengZu');
    check([d.zhiXing], 'zhiXing');
    check([d.naYin], 'naYin');
    check([d.wuHou], 'wuHou');
    check([d.yueXiang], 'yueXiang');
    check([d.zodiac], 'zodiac');
    if (d.jieQi) check([d.jieQi], 'jieQi');
    if (d.prevJieQi) check([d.prevJieQi.name], 'jieQi');
    if (d.nextJieQi) check([d.nextJieQi.name], 'jieQi');

    assert.ok(explainChongSha(d.chong, d.sha), `${cursor} 冲煞应有解释`);
    assert.ok(explainTianShen(d.tianShen, d.tianShenType, d.tianShenLuck), `${cursor} 值神应有解释`);
    assert.ok(explainXiu(d.xiu, d.xiuZheng, d.xiuAnimal, d.xiuLuck), `${cursor} 星宿应有解释`);
    assert.ok(explainTaiShen(d.taiShen), `${cursor} 胎神应有解释`);
    [d.yearGanZhi, d.monthGanZhi, d.dayGanZhi].forEach((gz) => {
      assert.ok(explainGanZhi(gz), `${cursor} 干支「${gz}」应有解释`);
    });
    d.times.forEach((t) => assert.ok(explainHour(t), `${cursor} 时辰「${t.ganZhi}」应有解释`));

    seen.naYin.add(d.naYin);
    seen.wuHou.add(d.wuHou);
    seen.yueXiang.add(d.yueXiang);
    seen.xiu.add(d.xiu);
    d.pengZu.forEach((p) => seen.pengZu.add(p));
    cursor = shiftAlmanacDate(cursor, 1);
  }
  assert.equal(cursor, '2027-01-01');
  // 两年足够走完纳音（60 日）、星宿（28 日）、物候（一年）、月相（一月）与彭祖（60 日）的全循环
  assert.equal(seen.naYin.size, 30, '两年应遍历三十纳音');
  assert.equal(seen.xiu.size, 28, '两年应遍历二十八宿');
  assert.equal(seen.wuHou.size, 72, '两年应遍历七十二物候');
  assert.equal(seen.pengZu.size, 22, '两年应遍历彭祖二十二句');
  assert.ok(seen.yueXiang.size >= 20, `两年应遍历绝大多数月相，实际 ${seen.yueXiang.size}`);
  console.log('OK: 2025–2026 共 730 天逐日扫描，页面所有词条均有解释');
}

console.log('\n全部验证通过 ✅');
