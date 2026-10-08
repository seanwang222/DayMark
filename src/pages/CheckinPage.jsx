import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  LinearProgress,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  Select,
  MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import CheckinItem from '../components/CheckinItem';
import AddCheckinDialog from '../components/AddCheckinDialog';
import CheckinCompleteDialog from '../components/CheckinCompleteDialog';
import QuarterlyChart from '../components/QuarterlyChart';
import YearlyChart from '../components/YearlyChart';
import ConfirmDialog from '../components/ConfirmDialog';
import CheckinCalendar from '../components/CheckinCalendar';
import { getRateColor } from '../utils/colors';
import {
  getCheckinItems,
  addCheckinItem,
  editCheckinItem,
  deleteCheckinItem,
  getCheckinRecordByDate,
  toggleCheckin,
  getCheckinStats,
  getToday,
  formatDate,
  getQuarterlyData,
  getYearlyData,
  getCheckinRecords,
  getItemStats,
  getOverallStats,
  reorderCheckinItems,
} from '../utils/storage';

/**
 * 单项目统计小卡片
 */
function StatCell({ label, value, highlight }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 78,
        bgcolor: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: '16px',
        p: 1,
        textAlign: 'center',
      }}
    >
      <Typography
        sx={{
          color: highlight ? '#3fb950' : '#c9d1d9',
          fontSize: '1.05rem',
          fontWeight: 700,
          lineHeight: 1.3,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.65rem' }}>
        {label}
      </Typography>
    </Box>
  );
}

/**
 * 打卡页面（左右布局）
 * 左侧：每日打卡 | 右侧：汇总统计
 */
function CheckinPage() {
  const [items, setItems] = useState(() => getCheckinItems());
  const [currentDate, setCurrentDate] = useState(() => getToday());
  const [records, setRecords] = useState(() => ({}));
  const [stats, setStats] = useState(() => ({ completed: 0, total: 0, rate: 0 }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completingItem, setCompletingItem] = useState(null);
  const [recordEditOpen, setRecordEditOpen] = useState(false);
  const [recordEditItem, setRecordEditItem] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  // 汇总统计的项目筛选：null 表示「全部项目」
  const [filterItemId, setFilterItemId] = useState(null);

  // —— 右侧汇总状态 ——
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
  const [view, setView] = useState('monthly');
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [quarter, setQuarter] = useState(currentQuarter);

  // 传入 filterItemId 即切换为单项目统计，数据结构不变，图表组件可直接复用
  const quarterlyData = useMemo(
    () => getQuarterlyData(year, quarter, filterItemId),
    [year, quarter, filterItemId, items, records],
  );
  const yearlyData = useMemo(
    () => getYearlyData(year, filterItemId),
    [year, filterItemId, items, records],
  );

  // 统计卡数据：单项目 = 该项目全生命周期统计；全部项目 = 全勤日口径聚合统计
  // （月度 / 季度 / 年度三个视图下均一致展示，与其它项目保持一致）
  const itemStats = useMemo(
    () => (filterItemId ? getItemStats(filterItemId) : getOverallStats()),
    [filterItemId, items, records],
  );

  // 单项目模式下，明细列表要展示打卡时间与备注
  const allRecords = useMemo(() => getCheckinRecords(), [records, items]);

  // 被筛选的项目若已被删除，自动回到「全部项目」
  useEffect(() => {
    if (filterItemId && !items.some((i) => i.id === filterItemId)) {
      setFilterItemId(null);
    }
  }, [items, filterItemId]);

  const viewLabel = useMemo(() => {
    if (view === 'monthly') return `${year}年${month}月`;
    if (view === 'quarterly') return `${year}年第${quarter}季度`;
    return `${year}年`;
  }, [view, year, month, quarter]);

  // 刷新数据
  const refreshData = useCallback((date) => {
    const d = date || currentDate;
    setItems([...getCheckinItems()]);
    setRecords({ ...getCheckinRecordByDate(d) });
    setStats({ ...getCheckinStats(d) });
  }, [currentDate]);

  useEffect(() => {
    refreshData(currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 日期切换
  const navigateDate = (direction) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + direction);
    const newDate = formatDate(d);
    setCurrentDate(newDate);
    refreshData(newDate);
  };

  const goToToday = () => {
    const today = getToday();
    setCurrentDate(today);
    refreshData(today);
  };

  const isToday = currentDate === getToday();

  // 点击「完成」→ 弹出对话框
  const handleRequestComplete = (item) => {
    setCompletingItem(item);
    setCompleteDialogOpen(true);
  };

  // 打卡完成确认（带时间和备注）
  const handleConfirmComplete = (time, note) => {
    if (completingItem) {
      toggleCheckin(currentDate, completingItem.id, true, { time, note });
      setCompleteDialogOpen(false);
      setCompletingItem(null);
      refreshData(currentDate);
    }
  };

  // 取消完成（标记为未完成）
  const handleCancelComplete = (itemId) => {
    toggleCheckin(currentDate, itemId, false);
    refreshData(currentDate);
  };

  // 点击已完成记录旁的「编辑记录」→ 弹出编辑对话框（预填已有 time/note）
  const handleEditRecord = (item, record) => {
    setRecordEditItem({ item, record });
    setRecordEditOpen(true);
  };

  // 保存编辑后的打卡记录（保持 completed: true）
  const handleConfirmEditRecord = (time, note) => {
    if (recordEditItem) {
      toggleCheckin(currentDate, recordEditItem.item.id, true, { time, note });
      setRecordEditOpen(false);
      setRecordEditItem(null);
      refreshData(currentDate);
    }
  };

  // 添加/编辑
  const handleOpenAdd = () => {
    setEditItem(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (item) => {
    setEditItem(item);
    setDialogOpen(true);
  };

  const handleSaveItem = (name) => {
    if (editItem) {
      editCheckinItem(editItem.id, name);
    } else {
      addCheckinItem(name);
    }
    setDialogOpen(false);
    setEditItem(null);
    refreshData(currentDate);
  };

  const [deleteItem, setDeleteItem] = useState(null);
  const handleDeleteItem = (id) => {
    setDeleteItem(id);
  };
  const confirmDeleteItem = () => {
    if (deleteItem) {
      deleteCheckinItem(deleteItem);
      refreshData(currentDate);
    }
    setDeleteItem(null);
  };

  const hasItems = items.length > 0;

  // —— 拖拽排序 ——
  const sortedItems = items.sort((a, b) => a.order - b.order);
  const handleDragStart = (idx) => { setDragIndex(idx); };
  const handleDragOver = (idx) => { setOverIndex(idx); };
  const handleDrop = (idx) => {
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const newOrder = [...sortedItems];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(idx, 0, moved);
    const reordered = reorderCheckinItems(newOrder.map((i) => i.id));
    setItems(reordered);
    setDragIndex(null);
    setOverIndex(null);
  };

  // —— 右侧汇总导航 ——
  const navigatePrev = () => {
    if (view === 'monthly') {
      if (month === 1) { setYear((y) => y - 1); setMonth(12); }
      else { setMonth((m) => m - 1); }
    } else if (view === 'quarterly') {
      if (quarter === 1) { setYear((y) => y - 1); setQuarter(4); }
      else { setQuarter((q) => q - 1); }
    } else { setYear((y) => y - 1); }
  };

  const navigateNext = () => {
    if (view === 'monthly') {
      if (month === 12) { setYear((y) => y + 1); setMonth(1); }
      else { setMonth((m) => m + 1); }
    } else if (view === 'quarterly') {
      if (quarter === 4) { setYear((y) => y + 1); setQuarter(1); }
      else { setQuarter((q) => q + 1); }
    } else { setYear((y) => y + 1); }
  };

  const goToCurrent = () => {
    setYear(currentYear);
    setMonth(currentMonth);
    setQuarter(currentQuarter);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: 2,
        minHeight: '100%',
        px: 1.5,
        pt: 2,
        pb: 2,
        width: '100%',
      }}
    >
      {/* ============= 左侧：每日打卡（1份） ============= */}
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', px: 0.5, scrollbarGutter: 'stable' }}>
        <Typography variant="h4" sx={{ mb: 2, color: '#c9d1d9' }}>
          每日打卡
        </Typography>

        {/* 日期导航 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
            bgcolor: '#161b22',
            borderRadius: '16px',
            p: 1.5,
            border: '1px solid #30363d',
          }}
        >
          <IconButton onClick={() => navigateDate(-1)} sx={{ color: '#8b949e' }}>
            <ChevronLeftIcon />
          </IconButton>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#c9d1d9' }}>
              {currentDate}
            </Typography>
            {!isToday && (
              <IconButton size="small" onClick={goToToday} sx={{ color: '#1f6feb' }}>
                <TodayIcon fontSize="small" />
              </IconButton>
            )}
            {isToday && (
              <Typography
                variant="caption"
                sx={{
                  color: '#3fb950',
                  bgcolor: 'rgba(0, 230, 118, 0.1)',
                  px: 1,
                  py: 0.3,
                  borderRadius: '16px',
                  fontWeight: 600,
                }}
              >
                今天
              </Typography>
            )}
          </Box>
          <IconButton onClick={() => navigateDate(1)} sx={{ color: '#8b949e' }}>
            <ChevronRightIcon />
          </IconButton>
        </Box>

        {/* 进度统计 */}
        <Box
          sx={{
            mb: 2.5,
            p: 2,
            bgcolor: '#161b22',
            borderRadius: '16px',
            border: '1px solid #30363d',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="body2" sx={{ color: '#8b949e' }}>今日完成</Typography>
            <Typography variant="body2" sx={{ color: '#c9d1d9', fontWeight: 700 }}>
              {stats.completed}/{stats.total}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={stats.rate}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: '#30363d',
              '& .MuiLinearProgress-bar': {
                bgcolor: getRateColor(stats.rate),
                borderRadius: 3,
              },
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: '#6e7681', mt: 0.5, display: 'block', textAlign: 'right' }}
          >
            {stats.rate}%
          </Typography>
        </Box>

        {/* 打卡项目列表 */}
        {hasItems ? (
          <Box>
            {items
              .sort((a, b) => a.order - b.order)
              .map((item, idx) => (
                <CheckinItem
                  key={item.id}
                  item={item}
                  record={records[item.id] || null}
                  onRequestComplete={handleRequestComplete}
                  onCancelComplete={handleCancelComplete}
                  onEdit={handleOpenEdit}
                  onDelete={handleDeleteItem}
                  onEditRecord={handleEditRecord}
                  index={idx}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', py: 6, color: '#6e7681' }}>
            <Typography variant="body1" sx={{ mb: 1 }}>还没有打卡项目</Typography>
            <Typography variant="body2" sx={{ color: '#484f58' }}>
              点击下方按钮添加你的第一个打卡项目
            </Typography>
          </Box>
        )}

        <Divider sx={{ my: 2, borderColor: '#30363d' }} />

        <Button
          variant="contained"
          fullWidth
          startIcon={<AddIcon />}
          onClick={handleOpenAdd}
          sx={{
            bgcolor: '#1f6feb',
            '&:hover': { bgcolor: '#388bfd' },
            py: 1.2,
            fontWeight: 600,
          }}
        >
          添加打卡项目
        </Button>

        <AddCheckinDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditItem(null); }}
          onSave={handleSaveItem}
          editItem={editItem}
        />

        <CheckinCompleteDialog
          open={completeDialogOpen}
          onClose={() => { setCompleteDialogOpen(false); setCompletingItem(null); }}
          onConfirm={handleConfirmComplete}
          item={completingItem}
        />

        <CheckinCompleteDialog
          open={recordEditOpen}
          onClose={() => { setRecordEditOpen(false); setRecordEditItem(null); }}
          onConfirm={handleConfirmEditRecord}
          item={recordEditItem && recordEditItem.item}
          existingRecord={recordEditItem && recordEditItem.record}
        />
      </Box>

      {/* ============= 右侧：汇总统计（2份） ============= */}
      <Box
        sx={{
          flex: 2,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          px: 0.5,
          borderLeft: { md: '1px solid' },
          borderColor: { md: 'divider' },
          pl: { md: 2 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="h4" sx={{ color: 'text.primary' }}>
            汇总统计
          </Typography>
        </Box>

        {/* 视图切换（带边框独立选项卡，样式与待办页筛选一致：选中蓝边+浅蓝底+蓝字） */}
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_e, newVal) => newVal && setView(newVal)}
          size="small"
          fullWidth
          sx={{
            mb: 2,
            display: 'flex',
            '& .MuiToggleButtonGroup-grouped': {
              flex: 1,
              minHeight: 40,
              borderRadius: '16px !important',
              border: '1px solid !important',
              borderColor: 'divider !important',
              ml: '0 !important',
            },
            '& .MuiToggleButtonGroup-grouped + .MuiToggleButtonGroup-grouped': {
              ml: '8px !important',
            },
            '& .MuiToggleButton-root': {
              bgcolor: '#161b22',
              color: '#8b949e',
              fontWeight: 500,
              py: 1.25,
              '&.Mui-selected': {
                bgcolor: 'rgba(77, 159, 255, 0.15) !important',
                borderColor: 'primary.main !important',
                color: 'primary.main',
                fontWeight: 700,
                '&:hover': {
                  bgcolor: 'rgba(31, 111, 235, 0.2) !important',
                  borderColor: 'primary.main !important',
                },
              },
              '&:hover': {
                bgcolor: '#21262d',
                color: '#c9d1d9',
              },
            },
          }}
        >
          <ToggleButton value="monthly">月度</ToggleButton>
          <ToggleButton value="quarterly">季度</ToggleButton>
          <ToggleButton value="yearly">年度</ToggleButton>
        </ToggleButtonGroup>

        {/* 月份导航 + 项目筛选（同一行并列，行高一致） */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, minHeight: 44 }}>
          {/* 月份导航 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              bgcolor: '#161b22',
              borderRadius: '16px',
              px: 0.5,
              border: '1px solid #30363d',
              height: 44,
              flexShrink: 0,
            }}
          >
            <IconButton size="small" onClick={navigatePrev} sx={{ color: '#8b949e' }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography sx={{ color: '#c9d1d9', fontWeight: 600, fontSize: '0.95rem', minWidth: 90, textAlign: 'center' }}>
              {viewLabel}
            </Typography>
            <IconButton size="small" onClick={navigateNext} sx={{ color: '#8b949e' }}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            {(year !== currentYear ||
              (view === 'monthly' && month !== currentMonth) ||
              (view === 'quarterly' && quarter !== currentQuarter)) && (
              <Button
                size="small"
                onClick={goToCurrent}
                sx={{ color: '#1f6feb', fontSize: '0.7rem', minWidth: 'auto', p: 0.5 }}
              >
                本月
              </Button>
            )}
          </Box>

          {/* 项目筛选：下拉框（全部项目 + 各项目） */}
          {items.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 160, ml: 'auto', height: 44 }}>
              <Select
                value={filterItemId || ''}
                onChange={(e) => setFilterItemId(e.target.value || null)}
                displayEmpty
                sx={{
                  height: 44,
                  color: 'text.primary',
                  '& .MuiSelect-icon': { color: 'text.secondary' },
                  '& fieldset': { borderColor: 'divider' },
                }}
              >
                <MenuItem value="">全部项目</MenuItem>
                {[...items]
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {/* 选中单个项目时，展示该项目的独立汇总统计 */}
        {itemStats && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <StatCell
                label="完成天数"
                value={`${itemStats.doneDays}/${itemStats.totalDays}`}
              />
              <StatCell
                label="完成率"
                value={`${itemStats.rate}%`}
                highlight={itemStats.rate >= 80}
              />
              <StatCell
                label="当前连续"
                value={`${itemStats.currentStreak} 天`}
                highlight={itemStats.currentStreak >= 7}
              />
              <StatCell label="最长连续" value={`${itemStats.longestStreak} 天`} />
            </Box>
            <Typography variant="caption" sx={{ color: '#6e7681', display: 'block', mt: 1 }}>
              {itemStats.createdAt ? `统计区间：${itemStats.createdAt} 至今` : '统计区间：全部有记录日期'}
              {itemStats.firstDone ? ` · 首次完成 ${itemStats.firstDone}` : ''}
              {itemStats.lastDone ? ` · 最近完成 ${itemStats.lastDone}` : ''}
            </Typography>
          </Box>
        )}

        {/* 汇总内容区：整体不滚动，仅此区域内部滚动；flex column 让月历可拉伸填满 */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', mt: 1, display: 'flex', flexDirection: 'column' }}>
          {view === 'monthly' && filterItemId === null && (
            <CheckinCalendar
              items={items}
              records={allRecords}
              year={year}
              month={month}
              onSelectDate={(ds) => { setCurrentDate(ds); refreshData(ds); }}
            />
          )}
          {view === 'monthly' && filterItemId !== null && (
            <CheckinCalendar
              items={items.filter((i) => i.id === filterItemId)}
              records={allRecords}
              year={year}
              month={month}
              onSelectDate={(ds) => { setCurrentDate(ds); refreshData(ds); }}
            />
          )}
          {view === 'quarterly' && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: '16px', border: '1px solid', borderColor: 'divider', p: 2 }}>
              <QuarterlyChart data={quarterlyData} />
            </Box>
          )}
          {view === 'yearly' && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: '16px', border: '1px solid', borderColor: 'divider', p: 2 }}>
              <YearlyChart data={yearlyData} />
            </Box>
          )}
        </Box>

        <ConfirmDialog
          open={!!deleteItem}
          title="删除打卡项目"
          message="确定要删除这个打卡项目吗？该项目的所有打卡记录也将一并删除，且无法恢复。"
          onConfirm={confirmDeleteItem}
          onClose={() => setDeleteItem(null)}
        />
      </Box>
    </Box>
  );
}

export default CheckinPage;
