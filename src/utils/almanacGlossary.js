/**
 * 黄历名词解释层：把页面上的词条与组合串解析成 { title, tag, lines }。
 * 查不到就返回 null，页面据此决定是否挂 Tooltip，避免出现空弹窗。
 *
 * 取词必须带分区（category），因为同一个字在不同分区含义不同：
 * 「危」在建除十二神里是「危日」，在二十八宿里是「危月燕」；
 * 「天德 / 青龙」既是值神也是吉神。合表查会让解释串台。
 */
import {
  YI_JI,
  PENG_ZU,
  JI_SHEN,
  XIONG_SHA,
  ZHI_XING,
  TIAN_SHEN,
  XIU,
  NA_YIN,
  WU_HOU,
  YUE_XIANG,
  JIE_QI,
  FESTIVAL,
  TIAN_GAN,
  DI_ZHI,
  ZODIAC,
  TAI_SHEN_PARTS,
  LABELS,
  CONCEPTS,
} from './almanacTerms.js';

/** 分区 → 词表与弹窗里显示的类别名 */
const TABLES = {
  yi: { dict: YI_JI, tag: '宜忌事项' },
  ji: { dict: YI_JI, tag: '宜忌事项' },
  jiShen: { dict: JI_SHEN, tag: '吉神' },
  xiongSha: { dict: XIONG_SHA, tag: '凶煞' },
  zhiXing: { dict: ZHI_XING, tag: '建除十二神' },
  tianShen: { dict: TIAN_SHEN, tag: '值神' },
  naYin: { dict: NA_YIN, tag: '纳音五行' },
  wuHou: { dict: WU_HOU, tag: '物候' },
  yueXiang: { dict: YUE_XIANG, tag: '月相' },
  jieQi: { dict: JIE_QI, tag: '节气' },
  festival: { dict: FESTIVAL, tag: '节日' },
  pengZu: { dict: PENG_ZU, tag: '彭祖百忌' },
  zodiac: { dict: ZODIAC, tag: '生肖' },
  label: { dict: LABELS, tag: '名词' },
};

/** 「无」是历法库在空列表里塞的占位词，不是真词条 */
const isBlank = (text) => !text || text === '无' || text === '—';

const result = (title, tag, lines) => ({
  title,
  tag,
  lines: lines.filter(Boolean),
});

/**
 * 单词条解释。category 取自 TABLES 的键。
 * 返回 { title, tag, lines } 或 null。
 */
export function explainTerm(text, category) {
  if (isBlank(text)) return null;
  const table = TABLES[category];
  if (!table) return null;
  const hit = table.dict[text];
  if (!hit) return null;
  const title = category === 'zhiXing' ? `${text}日` : text;
  return result(title, table.tag, [hit]);
}

/** 干支（年 / 月 / 日 / 时通用）：拆成天干与地支分别解释 */
export function explainGanZhi(ganZhi) {
  if (isBlank(ganZhi) || ganZhi.length !== 2) return null;
  const [gan, zhi] = ganZhi;
  if (!TIAN_GAN[gan] || !DI_ZHI[zhi]) return null;
  return result(`${ganZhi}`, '干支', [
    LABELS.干支,
    `天干「${gan}」：${TIAN_GAN[gan]}`,
    `地支「${zhi}」：${DI_ZHI[zhi]}`,
  ]);
}

/** 冲煞：chong 形如「(己巳)蛇」，sha 形如「西」 */
export function explainChongSha(chong, sha) {
  if (isBlank(chong)) return null;
  const pair = /\(([^)]+)\)/.exec(chong);
  const animal = /\)([^)]*)$/.exec(chong);
  const zodiac = animal ? animal[1].trim() : '';
  const lines = [CONCEPTS.冲];
  if (zodiac) {
    lines.push(
      `本日冲「${zodiac}」${pair ? `，括号里的「${pair[1]}」是与当日天克地冲的干支` : ''}。属${zodiac}者传统上不宜在今天办大事。`,
    );
    if (ZODIAC[zodiac]) lines.push(`生肖${zodiac}：${ZODIAC[zodiac]}`);
  }
  if (!isBlank(sha)) {
    lines.push(CONCEPTS.煞, `本日煞方在「${sha}」，朝该方向动土、出行、办事传统上认为不利。`);
  }
  return result(`冲${chong}${isBlank(sha) ? '' : ` · 煞${sha}`}`, '冲煞', lines);
}

/** 星宿：xiu 宿名，zheng 七政，animal 禽兽，luck 吉 / 凶 */
export function explainXiu(xiu, zheng, animal, luck) {
  const entry = XIU[xiu];
  if (!entry) return null;
  const full = `${zheng || ''}${animal || ''}` || entry.full;
  return result(`${xiu}宿 · ${full}`, '二十八宿', [
    CONCEPTS.星宿,
    `${entry.full}：${entry.group}七宿之一。${entry.desc}`,
    isBlank(luck) ? '' : `本日值宿吉凶为「${luck}」。`,
  ]);
}

/** 值神：tianShen 神名，type 黄道 / 黑道，luck 吉 / 凶 */
export function explainTianShen(tianShen, type, luck) {
  const hit = TIAN_SHEN[tianShen];
  if (!hit) return null;
  return result(`${tianShen}${isBlank(type) ? '' : ` · ${type}`}`, '值神', [
    LABELS.值神,
    hit,
    LABELS[type] || '',
    isBlank(luck) ? '' : `本日吉凶为「${luck}」。`,
  ]);
}

/**
 * 胎神占方形如「碓磨床 外西南」：前段是处所词的拼接，后段是内外 + 方位。
 * 处所词按最长优先切分，否则「碓磨」会被拆成「碓」与未收录的「磨」。
 */
export function explainTaiShen(text) {
  if (isBlank(text)) return null;
  const [place = '', position = ''] = String(text).split(/\s+/);
  const keys = Object.keys(TAI_SHEN_PARTS).sort((a, b) => b.length - a.length);
  const parts = [];
  let rest = place;
  while (rest) {
    const key = keys.find((k) => rest.startsWith(k));
    if (!key) break;
    parts.push(key);
    rest = rest.slice(key.length);
  }
  const locKey = keys.find((k) => position.startsWith(k));
  const direction = locKey ? position.slice(locKey.length) : position;
  const lines = [
    CONCEPTS.胎神,
    `本日胎神占「${place}」，方位在「${position}」。`,
    ...parts.map((k) => `${k}：${TAI_SHEN_PARTS[k]}`),
    locKey ? `${locKey}：${TAI_SHEN_PARTS[locKey]}` : '',
    direction === '中' ? '「中」指住宅中央，即中宫。' : '',
  ];
  return result(text, '胎神', lines);
}

/** 时辰卡：整段时间 + 值神 + 黄道黑道 */
export function explainHour(time) {
  if (!time || isBlank(time.ganZhi)) return null;
  const ganZhi = explainGanZhi(time.ganZhi);
  return result(`${time.ganZhi}时 · ${time.start}–${time.end}`, '时辰', [
    `这个时段的两小时称「${time.ganZhi}时」。${ganZhi ? ganZhi.lines.slice(1).join(' ') : ''}`,
    TIAN_SHEN[time.tianShen] ? `值神「${time.tianShen}」：${TIAN_SHEN[time.tianShen]}` : '',
    LABELS[time.type] || '',
  ]);
}