import React from 'react';
import { Box, Typography } from '@mui/material';
import { getRateColor } from '../utils/colors';

/**
 * 年度统计图表组件
 * 显示全年各月的完成率条形图
 *
 * @param {Object} data { monthData, avgRate }
 */
function YearlyChart({ data }) {
  if (!data || !data.monthData || data.monthData.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#6e7681', textAlign: 'center', py: 4 }}>
        暂无数据
      </Typography>
    );
  }

  const maxRate = 100;

  return (
    <Box>
      {/* 年度平均 */}
      <Box
        sx={{
          textAlign: 'center',
          mb: 3,
          p: 2,
          bgcolor: 'rgba(31, 99, 235, 0.1)',
          borderRadius: '16px',
          border: '1px solid rgba(31, 99, 235, 0.2)',
        }}
      >
        <Typography variant="h4" sx={{ color: '#1f6feb', fontWeight: 700 }}>
          {data.avgRate}%
        </Typography>
        <Typography variant="caption" sx={{ color: '#6e7681' }}>
          年度平均完成率
        </Typography>
      </Box>

      {/* 12个月条形图 */}
      <Box sx={{ display: 'flex', gap: 0.8, justifyContent: 'center', alignItems: 'flex-end', height: 140, px: 1 }}>
        {data.monthData.map((m) => (
          <Box
            key={m.month}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.3,
              flex: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: '#c9d1d9', fontWeight: 600, fontSize: '0.6rem' }}>
              {m.rate}%
            </Typography>
            <Box
              sx={{
                width: '100%',
                height: `${(m.rate / maxRate) * 100}px`,
                minHeight: m.rate > 0 ? 4 : 0,
                bgcolor: getRateColor(m.rate),
                borderRadius: '3px 3px 0 0',
                transition: 'height 0.3s',
              }}
            />
            <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.55rem' }}>
              {m.month.slice(-2)}月
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default YearlyChart;
