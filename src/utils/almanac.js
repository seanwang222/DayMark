/**
 * 老黄历数据层：把 lunar-javascript 的历法对象转成页面可直接渲染的纯数据。
 *
 * 日期一律按本地日历日（YYYY-MM-DD）进出，位移用 UTC 毫秒计算，
 * 避免夏令时或时区把「前一天 / 后一天」算偏。所有内容都在本机推算，不联网。
 */
import lunarPkg from 'lunar-javascript';

const { Solar } = lunarPkg;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n) => String(n).padStart(2, '0');
const asArray = (v) => (Array.isArray(v) ? v : []);
const unique = (list) => Array.from(new Set(list.filter(Boolean)));

/** 解析并校验 YYYY-MM-DD；2 月 30 日这类会被 Date 自动进位的日期视为非法 */
function parseDate(dateStr) {
  const m = DATE_RE.exec(String(dateStr == null ? '' : dateStr));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(2000, mo - 1, d));
  probe.setUTCFullYear(y);
  if (
    probe.getUTCFullYear() !== y
    || probe.getUTCMonth() !== mo - 1
    || probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m: mo, d };
}

/** YYYY-MM-DD 是否为真实存在的日历日 */
export function isValidAlmanacDate(dateStr) {
  return !!parseDate(dateStr);
}

/** 日期前后位移（delta 可为负）；非法日期返回空串 */
export function shiftAlmanacDate(dateStr, delta) {
  const p = parseDate(dateStr);
  if (!p) return '';
  const dt = new Date(Date.UTC(2000, p.m - 1, p.d));
  dt.setUTCFullYear(p.y);
  dt.setUTCDate(dt.getUTCDate() + Math.trunc(Number(delta) || 0));
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function daysBetween(a, b) {
  const pa = parseDate(a);
  const pb = parseDate(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86400000);
}

function jieQiOf(jq) {
  if (!jq) return null;
  return { name: jq.getName(), date: jq.getSolar().toYmd() };
}

/**
 * 某一天的黄历数据；非法日期或历法推算失败返回 null。
 * 返回对象只含字符串 / 数字 / 数组，组件不再直接接触历法库的类实例。
 */
export function getAlmanac(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return null;
  try {
    const solar = Solar.fromYmd(p.y, p.m, p.d);
    const lunar = solar.getLunar();
    const prev = jieQiOf(lunar.getPrevJieQi(true));
    const next = jieQiOf(lunar.getNextJieQi(true));

    return {
      date: dateStr,
      year: p.y,
      month: p.m,
      day: p.d,
      weekday: solar.getWeekInChinese(),
      lunarText: lunar.toString(),
      yearGanZhi: lunar.getYearInGanZhi(),
      monthGanZhi: lunar.getMonthInGanZhi(),
      dayGanZhi: lunar.getDayInGanZhi(),
      zodiac: lunar.getYearShengXiao(),
      jieQi: lunar.getJieQi() || '',
      prevJieQi: prev,
      nextJieQi: next ? { ...next, daysLeft: daysBetween(dateStr, next.date) } : null,
      festivals: unique([
        ...asArray(solar.getFestivals()),
        ...asArray(lunar.getFestivals()),
        ...asArray(lunar.getOtherFestivals()),
      ]),
      yi: asArray(lunar.getDayYi()),
      ji: asArray(lunar.getDayJi()),
      chong: lunar.getDayChongDesc(),
      sha: lunar.getDaySha(),
      zhiXing: lunar.getZhiXing(),
      tianShen: lunar.getDayTianShen(),
      tianShenType: lunar.getDayTianShenType(),
      tianShenLuck: lunar.getDayTianShenLuck(),
      naYin: lunar.getDayNaYin(),
      xiu: lunar.getXiu(),
      xiuLuck: lunar.getXiuLuck(),
      xiuZheng: lunar.getZheng(),
      xiuAnimal: lunar.getAnimal(),
      taiShen: lunar.getDayPositionTai(),
      wuHou: lunar.getWuHou(),
      yueXiang: lunar.getYueXiang(),
      pengZu: [lunar.getPengZuGan(), lunar.getPengZuZhi()].filter(Boolean),
      jiShen: asArray(lunar.getDayJiShen()),
      xiongSha: asArray(lunar.getDayXiongSha()),
      directions: {
        xi: lunar.getDayPositionXiDesc(),
        fu: lunar.getDayPositionFuDesc(),
        cai: lunar.getDayPositionCaiDesc(),
        yangGui: lunar.getDayPositionYangGuiDesc(),
        yinGui: lunar.getDayPositionYinGuiDesc(),
      },
      times: asArray(lunar.getTimes()).map((t) => ({
        ganZhi: t.getGanZhi(),
        start: t.getMinHm(),
        end: t.getMaxHm(),
        tianShen: t.getTianShen(),
        type: t.getTianShenType(),
        luck: t.getTianShenLuck(),
      })),
    };
  } catch (e) {
    console.error('getAlmanac failed:', e);
    return null;
  }
}
