import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { getRateColor, getRateGradient } from '../utils/colors';

/**
 * 月度打卡热力图组件
 * 展示每日完成率，用不同颜色表示完成度
 *
 * @param {Array} data 每日数据 [{ date, rate, completed, total }]
 * @param {number} year
 * @param {number} month
 */
function MonthlyChart({ data, year, month }) {
  if (!data || data.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#6e7681', textAlign: 'center', py: 4 }}>
        暂无数据
      </Typography>
    );
  }

  // 根据完成率获取颜色（连续色阶见 utils/colors，统一蓝→青→绿）
  const getColor = (rate) => getRateColor(rate);

  // 获取星期几（0=周日）
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  // 生成网格：7列（周日到周六）
  const grid = [];
  let dayCounter = 1;

  for (let row = 0; row < 6; row++) {
    const week = [];
    for (let col = 0; col < 7; col++) {
      if ((row === 0 && col < firstDay) || dayCounter > daysInMonth) {
        week.push(null);
      } else {
        week.push(dayCounter);
        dayCounter++;
      }
    }
    grid.push(week);
    if (dayCounter > daysInMonth) break;
  }

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <Box>
      {/* 图例：连续渐变条 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, justifyContent: 'flex-end' }}>
        <Typography variant="caption" sx={{ color: '#6e7681' }}>少</Typography>
        <Box
          sx={{
            width: 120,
            height: 12,
            borderRadius: '6px',
            background: getRateGradient(),
            border: '1px solid #30363d',
          }}
        />
        <Typography variant="caption" sx={{ color: '#6e7681' }}>多</Typography>
      </Box>

      {/* 周表头 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {weekDays.map((d) => (
          <Typography
            key={d}
            variant="caption"
            align="center"
            sx={{ color: '#484f58', fontWeight: 500, fontSize: '0.7rem' }}
          >
            {d}
          </Typography>
        ))}
      </Box>

      {/* 日期格子 */}
      {grid.map((week, wi) => (
        <Box
          key={wi}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 0.5,
            mb: 0.5,
          }}
        >
          {week.map((day, di) => {
            if (day === null) {
              return <Box key={di} />;
            }

            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayData = data.find((d) => d.date === dateStr);
            const rate = dayData ? dayData.rate : 0;
            const completed = dayData ? dayData.completed : 0;
            const total = dayData ? dayData.total : 0;
            const excluded = !!(dayData && dayData.excluded);

            // 单项目模式下 total 恒为 1，用「已完成 / 未完成」比「1/1 (100%)」更直观
            let tip = `${dateStr} - ${completed}/${total} (${rate}%)`;
            if (excluded) {
              tip = `${dateStr} - 项目创建前`;
            } else if (total === 1) {
              tip = `${dateStr} - ${completed === 1 ? '已完成' : '未完成'}`;
            }

            return (
              <Tooltip
                key={di}
                title={tip}
                arrow
              >
                <Box
                  sx={{
                    aspectRatio: '1',
                    borderRadius: '4px',
                    bgcolor: getColor(rate),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    '&:hover': {
                      transform: 'scale(1.15)',
                      border: '1px solid #1f6feb',
                    },
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      color: rate > 30 ? '#c9d1d9' : '#6e7681',
                      fontSize: '0.65rem',
                      fontWeight: 500,
                    }}
                  >
                    {day}
                  </Typography>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

export default MonthlyChart;
