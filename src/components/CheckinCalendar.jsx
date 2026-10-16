import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { getRateColor } from '../utils/colors';
import { getMonthlyData } from '../utils/storage';

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * 打卡月历热力图（紧凑长条色块）
 * - 周一为首列；每天一格，用一条水平色块（蓝阶）表示当天整体完成率
 * - 不逐一列举打卡项；格子高度很小，整月无需上下滑动
 * - 点击某天 → 选中并回调
 *
 * 完成率一律取自 storage.getMonthlyData（全应用唯一的口径实现），组件内不再自己 filter。
 * 它标了 excluded 的那些天（项目还没创建、已经归档、日子还没到来）本来就不参与统计，
 * 过去这里把它们画成「完成率 0%」，于是热力图和汇总统计各算一套、还都长成同一个颜色。
 * 现在 excluded 的格子画成虚线空格，与真正的「一次都没打」区分开。
 *
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} [itemId] 传入则只画这一个项目（单项目模式）
 * @param {string} [selectedDate] 高亮选中日
 * @param {Function} [onSelectDate] 点击某天回调
 */
function CheckinCalendar({ year, month, itemId, selectedDate, onSelectDate }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (new Date(year, month - 1, 1).getDay() + 6) % 7; // 周一为首列
  const dayCells = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const rows = {};
  getMonthlyData(year, month, itemId).forEach((d) => { rows[d.date] = d; });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 星期表头 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}>
        {WEEK_HEADERS.map((w) => (
          <Typography
            key={w}
            variant="caption"
            sx={{ textAlign: 'center', color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600 }}
          >
            {w}
          </Typography>
        ))}
      </Box>

      {/* 日期网格：每天一条水平色块（蓝阶 = 完成率），不参与统计的日子留空 */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 0.5 }}>
        {dayCells.map((d, idx) => {
          if (d === null) return <Box key={`b${idx}`} />;
          const dateStr = `${year}-${pad(month)}-${pad(d)}`;
          const row = rows[dateStr];
          const excluded = !row || row.excluded;
          const rate = row ? row.rate : 0;
          const isSelected = dateStr === selectedDate;
          const tip = excluded
            ? `${d}日 · 不参与统计`
            : `${d}日 · ${row.completed}/${row.total} · 完成率 ${rate}%`;
          return (
            <Tooltip key={dateStr} title={tip} arrow placement="top">
              <Box
                onClick={() => onSelectDate && onSelectDate(dateStr)}
                sx={{
                  minHeight: 26,
                  borderRadius: '16px',
                  borderWidth: 1,
                  borderStyle: excluded ? 'dashed' : 'solid',
                  borderColor: isSelected
                    ? '#1f6feb'
                    : excluded || rate > 0 ? 'transparent' : '#30363d',
                  bgcolor: excluded ? 'transparent' : getRateColor(rate),
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'border 0.15s, background 0.15s',
                  '&:hover': { borderColor: '#1f6feb' },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.68rem',
                    fontWeight: isSelected ? 700 : 600,
                    lineHeight: 1,
                    color: excluded
                      ? '#484f58'
                      : rate > 0
                        ? rate >= 30
                          ? '#0a0e14' // 亮蓝底上使用深色数字保证可读
                          : '#dce3ef'
                        : isSelected
                          ? '#1f6feb'
                          : '#8b949e',
                  }}
                >
                  {d}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      {/* 图例：虚线空格 = 不参与统计；色阶 少 → 多 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
        <Box sx={{ width: 12, height: 8, borderRadius: '16px', border: '1px dashed #484f58' }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
          不参与统计
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>少</Typography>
        {[10, 30, 50, 70, 90].map((r) => (
          <Box key={r} sx={{ width: 12, height: 8, borderRadius: '16px', bgcolor: getRateColor(r) }} />
        ))}
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>多</Typography>
      </Box>
    </Box>
  );
}

export default CheckinCalendar;
