import React from 'react';
import { Box, Typography } from '@mui/material';
import { getRateColor } from '../utils/colors';

/**
 * 季度统计图表组件
 * 显示季度内各月的完成率条形图
 *
 * @param {Object} data { monthData, avgRate }
 */
function QuarterlyChart({ data }) {
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
      {/* 平均完成率 */}
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
          季度平均完成率
        </Typography>
      </Box>

      {/* 各月条形图 */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', alignItems: 'flex-end', height: 160 }}>
        {data.monthData.map((m) => (
          <Box
            key={m.month}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
              flex: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: '#c9d1d9', fontWeight: 600 }}>
              {m.rate}%
            </Typography>
            <Box
              sx={{
                width: '100%',
                maxWidth: 60,
                height: `${(m.rate / maxRate) * 100}px`,
                minHeight: m.rate > 0 ? 4 : 0,
                bgcolor: getRateColor(m.rate),
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.3s',
                opacity: 0.85,
              }}
            />
            <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.65rem' }}>
              {m.month.slice(-2)}月
            </Typography>
            <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.6rem' }}>
              {m.completed}/{m.total}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default QuarterlyChart;
