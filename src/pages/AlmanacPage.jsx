import React, { useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Card,
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

const SectionTitle = ({ children, accent = GOLD, extra }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
    <Box sx={{ width: 3, height: 16, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: TEXT }}>
      {children}
    </Typography>
    {extra}
  </Box>
);

const TagList = ({ items, tone = 'neutral', empty = '—' }) => {
  const palette = TONES[tone] || TONES.neutral;
  if (!items || items.length === 0) {
    return <Typography variant="body2" sx={{ color: MUTED }}>{empty}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {items.map((item, index) => (
        <Chip
          key={`${item}-${index}`}
          label={item}
          size="small"
          sx={{
            color: palette.color,
            bgcolor: palette.bg,
            border: '1px solid',
            borderColor: palette.border,
            fontSize: '0.78rem',
          }}
        />
      ))}
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
    ['冲煞', `冲${data.chong} · 煞${data.sha}`],
    ['值神', `${data.tianShen} · ${data.tianShenType}${data.tianShenLuck ? `（${data.tianShenLuck}）` : ''}`],
    ['建除十二神', `${data.zhiXing}日`],
    ['纳音', data.naYin],
    ['星宿', `${data.xiu}宿 · ${data.xiuZheng}${data.xiuAnimal}（${data.xiuLuck}）`],
    ['胎神', data.taiShen],
    ['物候', data.wuHou],
    ['月相', data.yueXiang],
  ];
  const directions = [
    ['喜神', data.directions.xi],
    ['福神', data.directions.fu],
    ['财神', data.directions.cai],
    ['阳贵神', data.directions.yangGui],
    ['阴贵神', data.directions.yinGui],
  ];
  const luckyHours = data.times.filter((t) => t.type === '黄道').length;

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
            <Typography variant="caption" sx={{ color: GOLD_LIGHT, letterSpacing: '0.2em' }}>农历</Typography>
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
              <Chip size="small" label={`${data.yearGanZhi}年`} sx={{ color: TEXT, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }} />
              <Chip size="small" label={`${data.monthGanZhi}月`} sx={{ color: TEXT, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }} />
              <Chip size="small" label={`${data.dayGanZhi}日`} sx={{ color: TEXT, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }} />
              <Chip size="small" label={`生肖${data.zodiac}`} sx={{ color: GOLD_LIGHT, bgcolor: 'rgba(210,153,34,0.1)', border: '1px solid rgba(210,153,34,0.3)' }} />
            </Box>
          </Box>

          <Box sx={{ textAlign: { xs: 'left', md: 'right' }, minWidth: 230 }}>
            <Typography variant="h5" sx={{ color: TEXT }}>{dateLabel}</Typography>
            <Typography variant="body2" sx={{ color: MUTED, mb: 1 }}>
              星期{data.weekday}{isToday ? ' · 今天' : ''}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
              {data.jieQi && (
                <Chip size="small" label={`今日节气 · ${data.jieQi}`} sx={{ color: GOLD_LIGHT, bgcolor: 'rgba(210,153,34,0.14)', border: '1px solid rgba(210,153,34,0.4)' }} />
              )}
              {!data.jieQi && data.prevJieQi && (
                <Chip size="small" label={`上一节气 ${data.prevJieQi.name} ${fmtMd(data.prevJieQi.date)}`} sx={{ color: MUTED, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }} />
              )}
              {data.nextJieQi && (
                <Chip size="small" label={`下一节气 ${data.nextJieQi.name} ${fmtMd(data.nextJieQi.date)} · ${data.nextJieQi.daysLeft} 天后`} sx={{ color: MUTED, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }} />
              )}
              {data.festivals.map((f) => (
                <Chip key={f} size="small" label={f} sx={{ color: '#ff7b72', bgcolor: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)' }} />
              ))}
            </Box>
          </Box>
        </Box>
      </Card>

      {/* 宜 / 忌 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2, borderColor: 'rgba(63,185,80,0.3)' }}>
          <SectionTitle accent={GREEN} extra={<Typography variant="caption" sx={{ color: MUTED }}>{data.yi.length} 项</Typography>}>
            今日宜
          </SectionTitle>
          <TagList items={data.yi} tone="green" empty="诸事不宜" />
        </Card>
        <Card sx={{ p: 2, borderColor: 'rgba(248,81,73,0.3)' }}>
          <SectionTitle accent={RED} extra={<Typography variant="caption" sx={{ color: MUTED }}>{data.ji.length} 项</Typography>}>
            今日忌
          </SectionTitle>
          <TagList items={data.ji} tone="red" empty="百无禁忌" />
        </Card>
      </Box>

      {/* 日辰详情 */}
      <Card sx={{ p: 2, mb: 2 }}>
        <SectionTitle>日辰详情</SectionTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1 }}>
          {facts.map(([label, value]) => (
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
              <Typography variant="caption" sx={{ color: MUTED }}>{label}</Typography>
              <Typography variant="body2" sx={{ color: TEXT, mt: 0.25 }}>{value || '—'}</Typography>
            </Box>
          ))}
        </Box>
      </Card>

      {/* 吉神 / 凶煞 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2 }}>
          <SectionTitle accent={GREEN}>吉神宜趋</SectionTitle>
          <TagList items={data.jiShen} tone="green" empty="无" />
        </Card>
        <Card sx={{ p: 2 }}>
          <SectionTitle accent={RED}>凶煞宜忌</SectionTitle>
          <TagList items={data.xiongSha} tone="red" empty="无" />
        </Card>
      </Box>

      {/* 方位 / 彭祖百忌 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 2 }}>
          <SectionTitle>吉神方位</SectionTitle>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 1 }}>
            {directions.map(([label, value]) => (
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
                <Typography variant="caption" sx={{ color: MUTED, display: 'block' }}>{label}</Typography>
                <Typography variant="body1" sx={{ color: GOLD_LIGHT, fontWeight: 600 }}>{value || '—'}</Typography>
              </Box>
            ))}
          </Box>
        </Card>

        <Card sx={{ p: 2 }}>
          <SectionTitle>彭祖百忌</SectionTitle>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {data.pengZu.map((line, index) => (
              <Typography key={index} variant="body2" sx={{ color: TEXT, lineHeight: 1.8 }}>
                {line}
              </Typography>
            ))}
          </Box>
        </Card>
      </Box>

      {/* 时辰吉凶 */}
      <Card sx={{ p: 2 }}>
        <SectionTitle
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
            return (
              <Box
                key={`${time.ganZhi}-${index}`}
                sx={{
                  p: 1,
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: lucky ? 'rgba(63,185,80,0.3)' : 'divider',
                  bgcolor: lucky ? 'rgba(63,185,80,0.06)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: TEXT }}>{time.ganZhi}</Typography>
                  <Typography variant="caption" sx={{ color: lucky ? GREEN_TEXT : '#ff7b72' }}>{time.luck}</Typography>
                </Box>
                <Typography variant="caption" sx={{ display: 'block', color: MUTED }}>{time.start}–{time.end}</Typography>
                <Typography variant="caption" sx={{ display: 'block', color: lucky ? GREEN_TEXT : '#6e7681' }}>{time.tianShen}</Typography>
              </Box>
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
