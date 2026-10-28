import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChecklistIcon from '@mui/icons-material/Checklist';
import EventIcon from '@mui/icons-material/Event';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import DataManagerDialog from './DataManagerDialog';

/**
 * 底部导航栏
 * 左侧：日程 / 打卡 / 待办（按此顺序）；右侧：数据管理（图标 + 文字）
 */
const NAV_ITEMS = [
  { key: 'schedule', label: '日程', icon: <EventIcon />, path: '/schedule' },
  { key: 'checkin', label: '打卡', icon: <CalendarMonthIcon />, path: '/checkin' },
  { key: 'todos', label: '待办', icon: <ChecklistIcon />, path: '/todos' },
  { key: 'almanac', label: '黄历', icon: <MenuBookIcon />, path: '/almanac' },
];

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dataOpen, setDataOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  return (
    <Paper
      sx={{
        position: 'sticky',
        bottom: 12,
        left: 0,
        right: 0,
        zIndex: 100,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '16px',
        mx: 1.5,
        mb: 0.5,
      }}
      elevation={0}
    >
      {/* 上下各 9px：原来是 6/12，整条导航的可见高度不变，但四个入口会明显偏上 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1.125, pb: 1.125 }}>
        {/* 左侧：导航项（日程 / 打卡 / 待办） */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            return (
              <Button
                key={item.key}
                onClick={() => navigate(item.path)}
                startIcon={item.icon}
                sx={{
                  color: active ? 'github.blue' : 'text.secondary',
                  fontWeight: active ? 700 : 500,
                  textTransform: 'none',
                  borderRadius: '16px',
                  px: 1.5,
                  py: 0.75,
                  bgcolor: active ? 'rgba(31, 111, 235, 0.12)' : 'transparent',
                  '&:hover': {
                    bgcolor: active ? 'rgba(31, 111, 235, 0.18)' : 'action.hover',
                    color: active ? 'github.blue' : 'text.primary',
                  },
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </Box>

        {/* 右侧：数据管理（图标 + 文字） */}
        <Button
          onClick={() => setDataOpen(true)}
          startIcon={<SettingsBackupRestoreIcon />}
          sx={{
            color: 'text.secondary',
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: '16px',
            px: 1.5,
            py: 0.75,
            whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'action.hover', color: 'github.blue' },
          }}
        >
          数据管理
        </Button>
      </Box>

      <DataManagerDialog open={dataOpen} onClose={() => setDataOpen(false)} />
    </Paper>
  );
}

export default BottomNav;
