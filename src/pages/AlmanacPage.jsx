import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Card,
  Tooltip,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import {
  getAlmanac,
  shiftAlmanacDate,
  isValidAlmanacDate,
} from '../utils/almanac';
import {
  explainTerm,
  explainGanZhi,
  explainChongSha,
  explainXiu,
  explainTianShen,
  explainTaiShen,
  explainHour,
} from '../utils/almanacGlossary';
import { getToday } from '../utils/storage';

const GOLD = '#d29922';
const GOLD_LIGHT = '#e3b341';
const GREEN = '#3fb950';
const GREEN_TEXT = '#7ee787';
const RED = '#f85149';
const TEXT = '#c9d1d9';
const MUTED = '#8b949e';
const DATE_NAV_WIDTH = 188;
const DATE_NAV_HEIGHT = 44;

const TONES = {
  green: { color: GREEN_TEXT, bg: 'rgba(63,185,80,0.1)', border: 'rgba(63,185,80,0.28)' },
  red: { color: '#ff7b72', bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.28)' },
  gold: { color: GOLD_LIGHT, bg: 'rgba(210,153,34,0.1)', border: 'rgba(210,153,34,0.3)' },
  neutral: { color: TEXT, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.09)' },
};

const fmtMd = (s) => {
  const p = String(s || '').split('-');
  return p.length === 3 ? `${p[1]}-${p[2]}` : s || '';
};

const TIP_BG = '#1c2128';
const TIP_BORDER = 'rgba(210,153,34,0.4)';

/** 有解释才给 help 光标，作为「这里可以悬停」的视觉暗示；不占任何布局空间 */
const hintSx = (explain) => (explain ? { cursor: 'help' } : null);

const TipBody = ({ explain }) => (
  <Box>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5 }}>
      <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: GOLD_LIGHT, lineHeight: 1.35 }}>
        {explain.title}
      </Typography>
      <Typography sx={{ fontSize: '0.62rem', color: MUTED, whiteSpace: 'nowrap' }}>
        {explain.tag}
      </Typography>
    </Box>
    {explain.lines.map((line, index) => (
      <Typography
        key={index}
        sx={{ fontSize: '0.74rem', color: TEXT, lineHeight: 1.7, mt: index ? 0.4 : 0 }}
      >
        {line}
      </Typography>
    ))}
  </Box>
);

/**
 * 名词悬浮解释。查不到词条时原样返回子元素，不挂 Tooltip，
 * 因此不会出现空弹窗，也不给任何元素额外包一层 DOM——行高与行数保持不变。
 */
const TermTip = ({ explain, children }) => {
  if (!explain) return children;
  return (
    <Tooltip
      arrow
      placement="top"
      enterDelay={150}
      leaveDelay={80}
      title={<TipBody explain={explain} />}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: TIP_BG,
            border: `1px solid ${TIP_BORDER}`,
            borderRadius: '10px',
            maxWidth: 340,
            px: 1.25,
            py: 1,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          },
        },
        arrow: { sx: { color: TIP_BG } },
      }}
    >
      {children}
    </Tooltip>
  );
};

const SectionTitle = ({ children, accent = GOLD, extra, explain }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
    <Box sx={{ width: 3, height: 16, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
    <TermTip explain={explain}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: TEXT, ...hintSx(explain) }}>
        {children}
      </Typography>
    </TermTip>
    {extra}
  </Box>
);

const TagList = ({ items, tone = 'neutral', empty = '—', category }) => {
  const palette = TONES[tone] || TONES.neutral;
  if (!items || items.length === 0) {
    return <Typography variant="body2" sx={{ color: MUTED }}>{empty}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {items.map((item, index) => {
        const explain = category ? explainTerm(item, category) : null;
        return (
          <TermTip key={`${item}-${index}`} explain={explain}>
            <Chip
              label={item}
              size="small"
              tabIndex={explain ? 0 : undefined}
              sx={{
                color: palette.color,
                bgcolor: palette.bg,
                border: '1px solid',
                borderColor: palette.border,
                fontSize: '0.78rem',
                ...hintSx(explain),
              }}
            />
          </TermTip>
        );
      })}
    </Box>
  );
};

/**
 * 黄历页：按天浏览农历、干支、节气、宜忌、冲煞与时辰吉凶。
 * 全部数据由 utils/almanac 在本机推算，不请求任何外部接口。
 */
function AlmanacPage() {
  const [date, setDate] = useState(() => getToday());
  const today = getToday();
  const data = useMemo(() => getAlmanac(date), [date]);
  const isToday = date === today;
  const dateInputRef = useRef(null);

  const moveDay = (delta) => {
    setDate((current) => shiftAlmanacDate(current, delta) || current);
  };

  const jumpDate = (event) => {
    const next = event.target.value;
    if (isValidAlmanacDate(next)) setDate(next);
  };

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch (e) {
        // 少数环境会阻止 showPicker，退回原生点击
      }
    }
    input.click();
  };

  if (!data) {
    return (
      <Box sx={{ maxWidth: 1180, mx: 'auto', px: 2, pt: 2 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>黄历</Typography>
        <Typography variant="body2" sx={{ color: MUTED }}>
          无法读取这一天的黄历，请换一个日期。
        </Typography>
      </Box>
    );
  }

  const dateLabel = `${data.year}年${data.month}月${data.day}日`;
  const facts = [
    { label: '冲煞', value: `冲${data.chong} · 煞${data.sha}`, explain: explainChongSha(data.chong, data.sha) },
    {
      label: '值神',
      value: `${data.tianShen} · ${data.tianShenType}${data.tianShenLuck ? `（${data.tianShenLuck}）` : ''}`,
      explain: explainTianShen(data.tianShen, data.tianShenType, data.tianShenLuck),
    },
    { label: '建除十二神', value: `${data.zhiXing}日`, explain: explainTerm(data.zhiXing, 'zhiXing') },
    { label: '纳音', value: data.naYin, explain: explainTerm(data.naYin, 'naYin') },
    {
      label: '星宿',
      value: `${data.xiu}宿 · ${data.xiuZheng}${data.xiuAnimal}（${data.xiuLuck}）`,
      explain: explainXiu(data.xiu, data.xiuZheng, data.xiuAnimal, data.xiuLuck),
    },
    { label: '胎神', value: data.taiShen, explain: explainTaiShen(data.taiShen) },
    { label: '物候', value: data.wuHou, explain: explainTerm(data.wuHou, 'wuHou') },
    { label: '月相', value: data.yueXiang, explain: explainTerm(data.yueXiang, 'yueXiang') },
  ];
  const directions = [
    { label: '喜神', value: data.directions.xi },
    { label: '福神', value: data.directions.fu },
    { label: '财神', value: data.directions.cai },
    { label: '阳贵神', value: data.directions.yangGui },
    { label: '阴贵神', value: data.directions.yinGui },
  ];
  const luckyHours = data.times.filter((t) => t.type === '黄道').length;
  const lunarLabelExplain = explainTerm('农历', 'label');
  const jieQiExplain = data.jieQi ? explainTerm(data.jieQi, 'jieQi') : null;
  const prevJieQiExplain = data.prevJieQi ? explainTerm(data.prevJieQi.name, 'jieQi') : null;
  const nextJieQiExplain = data.nextJieQi ? explainTerm(data.nextJieQi.name, 'jieQi') : null;

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', px: 2, pt: 2, pb: 3 }}>
      {/* 标题与日期导航 */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 'auto' }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: '12px',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(210,153,34,0.14)',
              border: '1px solid rgba(210,153,34,0.35)',
            }}
          >
            <MenuBookIcon sx={{ color: GOLD_LIGHT, fontSize: 20 }} />
          </Box>
          <Box>
            <Typography variant="h4" sx={{ color: TEXT, lineHeight: 1.2 }}>黄历</Typography>
            <Typography variant="caption" sx={{ color: MUTED }}>农历 · 干支 · 宜忌 · 时辰</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1.25, width: { xs: '100%', sm: 'auto' } }}>
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              height: DATE_NAV_HEIGHT,
              width: { xs: 'auto', sm: DATE_NAV_WIDTH },
              flex: { xs: 1, sm: '0 0 auto' },
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              borderRadius: '14px',
              px: 0.5,
            }}
          >
            <IconButton size="small" onClick={() => moveDay(-1)} aria-label="前一天" sx={{ color: MUTED }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Box
              component="button"
              type="button"
              onClick={openDatePicker}
              aria-label={`选择日期，当前 ${dateLabel}`}
              sx={{
                flex: 1,
                minWidth: 0,
                height: '100%',
                px: 0.5,
                border: 0,
                borderRadius: '10px',
                bgcolor: 'transparent',
                color: TEXT,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                '&:hover': { bgcolor: 'rgba(210,153,34,0.08)', color: GOLD_LIGHT },
                '&:hover .date-sub': { color: GOLD_LIGHT },
                '&:focus-visible': { outline: '2px solid rgba(210,153,34,0.65)', outlineOffset: 1 },
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: { xs: '0.76rem', sm: '0.82rem' }, fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap' }}
              >
                {dateLabel}
              </Box>
              <Box
                component="span"
                className="date-sub"
                sx={{ fontSize: { xs: '0.64rem', sm: '0.68rem' }, color: MUTED, lineHeight: 1.15, whiteSpace: 'nowrap' }}
              >
                星期{data.weekday}{isToday ? ' · 今天' : ''}
              </Box>
            </Box>
            <IconButton size="small" onClick={() => moveDay(1)} aria-label="后一天" sx={{ color: MUTED }}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            <input
              ref={dateInputRef}
              type="date"
              value={date}
              onChange={jumpDate}
              aria-label="跳转日期"
              tabIndex={-1}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />
          </Box>

          <Button
            startIcon={<TodayIcon sx={{ fontSize: 18 }} />}
            onClick={() => setDate(today)}
            disabled={isToday}
            sx={{
              flex: { xs: 1, sm: '0 0 auto' },
              width: { sm: DATE_NAV_WIDTH },
              height: DATE_NAV_HEIGHT,
              borderRadius: '14px',
              fontSize: { xs: '0.76rem', sm: '0.82rem' },
              fontWeight: 600,
              color: isToday ? MUTED : GOLD_LIGHT,
              border: '1px solid',
              borderColor: isToday ? 'divider' : 'rgba(210,153,34,0.35)',
              px: 1.25,
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: 'rgba(210,153,34,0.08)', borderColor: 'rgba(210,153,34,0.5)' },
              '&.Mui-disabled': { color: '#484f58', borderColor: 'divider' },
            }}
          >
            今天
          </Button>
        </Box>
      </Box>

      {/* 农历主卡 */}
      <Card
        sx={{
          mb: 2,
          p: { xs: 2, md: 2.5 },
          borderColor: 'rgba(210,153,34,0.38)',
          background: 'linear-gradient(135deg, rgba(210,153,34,0.13), rgba(22,27,34,0.25) 58%, rgba(22,27,34,0) 100%)',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ minWidth: 260 }}>
            <TermTip explain={lunarLabelExplain}>
              <Typography variant="caption" sx={{ color: GOLD_LIGHT, letterSpacing: '0.2em', ...hintSx(lunarLabelExplain) }}>农历</Typography>
            </TermTip>
            <Typography
              sx={{
                fontSize: { xs: '1.65rem', md: '2.15rem' },
                fontWeight: 700,
                color: TEXT,
                lineHeight: 1.3,
                mb: 1,
              }}
            >
              {data.lunarText}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {[
                { text: `${data.yearGanZhi}年`, explain: explainGanZhi(data.yearGanZhi), gold: false },
                { text: `${data.monthGanZhi}月`, explain: explainGanZhi(data.monthGanZhi), gold: false },
                { text: `${data.dayGanZhi}日`, explain: explainGanZhi(data.dayGanZhi), gold: false },
                { text: `生肖${data.zodiac}`, explain: explainTerm(data.zodiac, 'zodiac'), gold: true },
              ].map((chip) => (
                <TermTip key={chip.text} explain={chip.explain}>
                  <Chip
                    size="small"
                    label={chip.text}
                    tabIndex={chip.explain ? 0 : undefined}
                    sx={{
                      color: chip.gold ? GOLD_LIGHT : TEXT,
                      bgcolor: chip.gold ? 'rgba(210,153,34,0.1)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid',
                      borderColor: chip.gold ? 'rgba(210,153,34,0.3)' : 'rgba(255,255,255,0.09)',
                      ...hintSx(chip.explain),
                    }}
                  />
                </TermTip>
              ))}
            </Box>
          </Box>

          <Box sx={{ textAlign: { xs: 'left', md: 'right' }, minWidth: 230 }}>
            <Typography variant="h5" sx={{ color: TEXT }}>{dateLabel}</Typography>
            <Typography variant="body2" sx={{ color: MUTED, mb: 1 }}>
              星期{data.weekday}{isToday ? ' · 今天' : ''}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
              {data.jieQi && (
                <TermTip explain={jieQiExplain}>
                  <Chip size="small" label={`今日节气 · ${data.jieQi}`} tabIndex={jieQiExplain ? 0 : undefined} sx={{ color: GOLD_LIGHT, bgcolor: 'rgba(210,153,34,0.14)', border: '1px solid rgba(210,153,34,0.4)', ...hintSx(jieQiExplain) }} />
                </TermTip>
              )}
              {!data.jieQi && data.prevJieQi && (
                <TermTip explain={prevJieQiExplain}>
                  <Chip size="small" label={`上一节气 ${data.prevJieQi.name} ${fmtMd(data.prevJieQi.date)}`} tabIndex={prevJieQiExplain ? 0 : undefined} sx={{ color: MUTED, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', ...hintSx(prevJieQiExplain) }} />
                </TermTip>
              )}
              {data.nextJieQi && (
                <TermTip explain={nextJieQiExplain}>
                  <Chip size="small" label={`下一节气 ${data.nextJieQi.name} ${fmtMd(data.nextJieQi.date)} · ${data.nextJieQi.daysLeft} 天后`} tabIndex={nextJieQiExplain ? 0 : undefined} sx={{ color: MUTED, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', ...hintSx(nextJieQiExplain) }} />
                </TermTip>
              )}
              {data.festivals.map((f) => {
                const explain = explainTerm(f, 'festival');
                return (
                  <TermTip key={f} explain={explain}>
                    <Chip size="small" label={f} tabIndex={explain ? 0 : undefined} sx={{ color: '#ff7b72', bgcolor: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', ...hintSx(explain) }} />
                  </TermTip>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Card>

      {/* 宜 / 忌 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2, borderColor: 'rgba(63,185,80,0.3)' }}>
          <SectionTitle accent={GREEN} explain={explainTerm('今日宜', 'label')} extra={<Typography variant="caption" sx={{ color: MUTED }}>{data.yi.length} 项</Typography>}>
            今日宜
          </SectionTitle>
          <TagList items={data.yi} tone="green" empty="诸事不宜" category="yi" />
        </Card>
        <Card sx={{ p: 2, borderColor: 'rgba(248,81,73,0.3)' }}>
          <SectionTitle accent={RED} explain={explainTerm('今日忌', 'label')} extra={<Typography variant="caption" sx={{ color: MUTED }}>{data.ji.length} 项</Typography>}>
            今日忌
          </SectionTitle>
          <TagList items={data.ji} tone="red" empty="百无禁忌" category="ji" />
        </Card>
      </Box>

      {/* 日辰详情 */}
      <Card sx={{ p: 2, mb: 2, borderColor: 'rgba(210,153,34,0.3)' }}>
        <SectionTitle>日辰详情</SectionTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1 }}>
          {facts.map(({ label, value, explain }) => {
            const labelExplain = explainTerm(label, 'label');
            return (
              <Box
                key={label}
                sx={{
                  p: 1.25,
                  borderRadius: '12px',
                  bgcolor: 'rgba(255,255,255,0.02)',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <TermTip explain={labelExplain}>
                  <Typography variant="caption" component="span" sx={{ color: MUTED, ...hintSx(labelExplain) }}>{label}</Typography>
                </TermTip>
                <TermTip explain={explain}>
                  <Typography variant="body2" sx={{ color: TEXT, mt: 0.25, ...hintSx(explain) }}>{value || '—'}</Typography>
                </TermTip>
              </Box>
            );
          })}
        </Box>
      </Card>

      {/* 吉神 / 凶煞 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2, borderColor: 'rgba(63,185,80,0.3)' }}>
          <SectionTitle accent={GREEN} explain={explainTerm('吉神宜趋', 'label')}>吉神宜趋</SectionTitle>
          <TagList items={data.jiShen} tone="green" empty="无" category="jiShen" />
        </Card>
        <Card sx={{ p: 2, borderColor: 'rgba(248,81,73,0.3)' }}>
          <SectionTitle accent={RED} explain={explainTerm('凶煞宜忌', 'label')}>凶煞宜忌</SectionTitle>
          <TagList items={data.xiongSha} tone="red" empty="无" category="xiongSha" />
        </Card>
      </Box>

      {/* 方位 / 彭祖百忌 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2, borderColor: 'rgba(210,153,34,0.3)' }}>
          <SectionTitle explain={explainTerm('吉神方位', 'label')}>吉神方位</SectionTitle>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 1 }}>
            {directions.map(({ label, value }) => {
              const explain = explainTerm(label, 'label');
              return (
                <Box
                  key={label}
                  sx={{
                    textAlign: 'center',
                    py: 1,
                    borderRadius: '12px',
                    bgcolor: 'rgba(210,153,34,0.06)',
                    border: '1px solid rgba(210,153,34,0.2)',
                  }}
                >
                  <TermTip explain={explain}>
                    <Typography variant="caption" sx={{ color: MUTED, display: 'block', ...hintSx(explain) }}>{label}</Typography>
                  </TermTip>
                  <Typography variant="body1" sx={{ color: GOLD_LIGHT, fontWeight: 600 }}>{value || '—'}</Typography>
                </Box>
              );
            })}
          </Box>
        </Card>

        <Card sx={{ p: 2, borderColor: 'rgba(210,153,34,0.3)' }}>
          <SectionTitle explain={explainTerm('彭祖百忌', 'label')}>彭祖百忌</SectionTitle>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {data.pengZu.map((line, index) => {
              const explain = explainTerm(line, 'pengZu');
              return (
                <TermTip key={index} explain={explain}>
                  <Typography variant="body2" sx={{ color: TEXT, lineHeight: 1.8, ...hintSx(explain) }}>
                    {line}
                  </Typography>
                </TermTip>
              );
            })}
          </Box>
        </Card>
      </Box>

      {/* 时辰吉凶 */}
      <Card sx={{ p: 2, borderColor: 'rgba(210,153,34,0.3)' }}>
        <SectionTitle
          explain={explainTerm('时辰吉凶', 'label')}
          extra={(
            <Typography variant="caption" sx={{ color: MUTED }}>
              黄道 {luckyHours} · 黑道 {data.times.length - luckyHours}
            </Typography>
          )}
        >
          时辰吉凶
        </SectionTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 1 }}>
          {data.times.map((time, index) => {
            const lucky = time.type === '黄道';
            const explain = explainHour(time);
            return (
              <TermTip key={`${time.ganZhi}-${index}`} explain={explain}>
                <Box
                  sx={{
                    p: 1,
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: lucky ? 'rgba(63,185,80,0.3)' : 'divider',
                    bgcolor: lucky ? 'rgba(63,185,80,0.06)' : 'rgba(255,255,255,0.02)',
                    ...hintSx(explain),
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: TEXT }}>{time.ganZhi}</Typography>
                    <Typography variant="caption" sx={{ color: lucky ? GREEN_TEXT : '#ff7b72' }}>{time.luck}</Typography>
                  </Box>
                  <Typography variant="caption" sx={{ display: 'block', color: MUTED }}>{time.start}–{time.end}</Typography>
                  <Typography variant="caption" sx={{ display: 'block', color: lucky ? GREEN_TEXT : '#6e7681' }}>{time.tianShen}</Typography>
                </Box>
              </TermTip>
            );
          })}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', color: '#6e7681', mt: 1.5 }}>
          子时跨 23:00–00:59，表中按自然日拆成两段。
        </Typography>
      </Card>

      <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: '#6e7681', mt: 2 }}>
        黄历内容依据传统历法在本机推算，仅供传统文化参考。
      </Typography>
    </Box>
  );
}

export default AlmanacPage;
