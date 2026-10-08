import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { getRateColor } from '../utils/colors';

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (n) => String(n).padStart(2, '0');

/**
 * 打卡「全部项目」月历（紧凑长条色块，旧版样式）
 * - 周一为首列；每天一格，用一条水平色块（蓝阶）表示当天整体完成率
 * - 不逐一列举打卡项；格子高度很小，整月无需上下滑动
 * - 点击某天 → 选中并回调
 *
 * @param {Array} items 打卡项目 [{id,name,createdAt,...}]
 * @param {Object} records 全量打卡记录 { 'YYYY-MM-DD': { itemId: {completed,...} | null } }
 * @param {number} year
 * @param {number} month 1-12
 * @param {string} [selectedDate] 高亮选中日
 * @param {Function} [onSelectDate] 点击某天回调
 */
function CheckinCalendar({ items, records, year, month, selectedDate, onSelectDate }) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingBlanks = (new Date(year, month - 1, 1).getDay() + 6) % 7; // 周一为首列
  const dayCells = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // 计算每天整体完成率（排除项目创建前的日期）
  const dayRates = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    const dayRec = records[dateStr] || {};
    let total = 0;
    let done = 0;
    items.forEach((item) => {
      if (item.createdAt && dateStr < item.createdAt.slice(0, 10)) return;
      total += 1;
      const rec = dayRec[item.id];
      if (rec && (rec === true || rec.completed)) done += 1;
    });
    dayRates[dateStr] = total > 0 ? Math.round((done / total) * 100) : 0;
  }

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

      {/* 日期网格：每天一条水平色块（蓝阶 = 完成率） */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 0.5 }}>
        {dayCells.map((d, idx) => {
          if (d === null) return <Box key={`b${idx}`} />;
          const dateStr = `${year}-${pad(month)}-${pad(d)}`;
          const rate = dayRates[dateStr] || 0;
          const isSelected = dateStr === selectedDate;
          return (
            <Tooltip key={dateStr} title={`${d}日 · 完成率 ${rate}%`} arrow placement="top">
              <Box
                onClick={() => onSelectDate && onSelectDate(dateStr)}
                sx={{
                  minHeight: 26,
                  borderRadius: '16px',
                  border: '1px solid',
                  borderColor: isSelected ? '#1f6feb' : rate > 0 ? 'transparent' : '#30363d',
                  bgcolor: rate > 0 ? getRateColor(rate) : '#161b22',
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
                    color:
                      rate > 0
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

      {/* 颜色图例：少 → 多 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, justifyContent: 'flex-end' }}>
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
