import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import BottomNav from './components/BottomNav';
import CheckinPage from './pages/CheckinPage';
import TodoPage from './pages/TodoPage';
import SchedulePage from './pages/SchedulePage';
import AlmanacPage from './pages/AlmanacPage';

/**
 * 应用根组件
 * 包含底部导航栏和三个主要页面的路由（打卡 / 待办 / 日程）
 * 顶部不再有独立的「汇总」入口，已整合到「打卡」页面右侧
 */
function App() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        bgcolor: 'background.default',
      }}
    >
      {/* 主内容区 */}
      <Box sx={{ flex: 1, overflow: 'auto', pb: 0 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/schedule" replace />} />
          <Route path="/checkin" element={<CheckinPage />} />
          <Route path="/todos" element={<TodoPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/almanac" element={<AlmanacPage />} />
          <Route path="/summary" element={<Navigate to="/schedule" replace />} />
        </Routes>
      </Box>

      {/* 底部导航栏 */}
      <BottomNav />
    </Box>
  );
}

export default App;
