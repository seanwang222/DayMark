import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Checkbox,
  Chip,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import EventIcon from '@mui/icons-material/Event';
import {
  getCheckinItems,
  getCheckinRecords,
  getTodos,
  getToday,
  toggleCheckin,
  toggleTodo,
  toggleTodoPhase,
  TODO_PRIORITIES,
} from '../utils/storage';

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (n) => String(n).padStart(2, '0');

/** 把 YYYY-MM-DD 显示为 MM-DD */
const fmtMd = (s) => {
  if (!s) return '';
  const p = String(s).split('-');
  return p.length === 3 ? `${p[1]}-${p[2]}` : s;
};

/**
 * 日程视图：月历形式展示每日的「打卡 / 待办 / 行动」清单。
 * - 左侧月历：每天仅展示「打卡」项（含历史完成状态），单元格内部可滚动。
 * - 右侧清单：展示选中日的打卡 / 待办 / 行动。
 */

/** 紧凑条目（日历格内）——仅展示打卡项 */
const MiniEntry = ({ e, todayStr }) => {
  const done = !!(e.rec && e.rec.completed);
  const color = done ? '#3fb950' : '#484f58';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, minWidth: 0 }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography
        variant="caption"
        sx={{ color: '#c9d1d9', fontSize: '0.68rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {e.item.name}
      </Typography>
    </Box>
  );
};

const DetailRow = ({ e, todayStr, selectedDate, onToggleCheckin, onToggleTodo, onTogglePhase }) => {
  if (e.kind === 'checkin') {
    const done = !!(e.rec && e.rec.completed);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
        <Checkbox
          checked={done}
          onChange={() => onToggleCheckin(selectedDate, e.item.id, !done)}
          size="small"
          sx={{ color: '#484f58', '&.Mui-checked': { color: '#3fb950' }, p: 0.3 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: done ? '#6e7681' : '#c9d1d9', textDecoration: done ? 'line-through' : 'none', fontSize: '0.85rem' }}>
            {e.item.name}
          </Typography>
          {e.rec && e.rec.time && (
            <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.65rem' }}>完成于 {e.rec.time}</Typography>
          )}
        </Box>
        <Chip label="打卡" size="small" sx={{ color: '#8b949e', bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.65rem', height: 20 }} />
      </Box>
    );
  }
  if (e.kind === 'todo') {
    const t = e.todo;
    const cfg = TODO_PRIORITIES[t.priority] || TODO_PRIORITIES.not_urgent_important;
    const overdue = !t.completed && t.dueDate < todayStr;
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
        <Checkbox
          checked={t.completed}
          onChange={() => onToggleTodo(t.id)}
          size="small"
          sx={{ color: '#484f58', '&.Mui-checked': { color: '#3fb950' }, p: 0.3 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: t.completed ? '#6e7681' : '#c9d1d9', textDecoration: t.completed ? 'line-through' : 'none', fontSize: '0.85rem' }}>
            {t.title}
          </Typography>
          {overdue && (
            <Typography variant="caption" sx={{ color: '#f85149', fontSize: '0.65rem' }}>已过期</Typography>
          )}
        </Box>
        <Chip label={cfg.label} size="small" sx={{ color: cfg.color, bgcolor: cfg.bg, fontSize: '0.65rem', height: 20 }} />
      </Box>
    );
  }
  // phase
  const p = e.phase;
  const pcfg = TODO_PRIORITIES[e.todo.priority] || TODO_PRIORITIES.not_urgent_important;
  const overdue = !p.completed && p.dueDate < todayStr;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Checkbox
        checked={p.completed}
        onChange={() => onTogglePhase(e.todo.id, p.id)}
        size="small"
        sx={{ color: '#484f58', '&.Mui-checked': { color: '#3fb950' }, p: 0.3 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: p.completed ? '#6e7681' : '#c9d1d9', textDecoration: p.completed ? 'line-through' : 'none', fontSize: '0.82rem' }}>
          {e.todo.title} <span style={{ color: '#6e7681' }}>›</span> {p.name}
        </Typography>
        {p.dueDate && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2, mt: 0.1 }}>
            <EventIcon sx={{ fontSize: 12, color: overdue ? '#f85149' : '#58a6ff' }} />
            <Typography variant="caption" sx={{ color: overdue ? '#f85149' : '#58a6ff', fontSize: '0.65rem' }}>截止 {fmtMd(p.dueDate)}</Typography>
          </Box>
        )}
      </Box>
      <Chip label={pcfg.label} size="small" sx={{ color: pcfg.color, bgcolor: pcfg.bg, fontSize: '0.65rem', height: 20 }} />
    </Box>
  );
};

const DetailGroup = ({ title, color, entries, todayStr, selectedDate, onToggleCheckin, onToggleTodo, onTogglePhase }) => (
  <Box sx={{ mb: 1.5 }}>
    <Typography variant="caption" sx={{ color, fontWeight: 700, fontSize: '0.8rem', display: 'block', mb: 0.3 }}>
      {title}（{entries.length}）
    </Typography>
    {entries.length === 0 ? (
      <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.75rem' }}>无</Typography>
    ) : (
      entries.map((e, i) => (
        <DetailRow
          key={i}
          e={e}
          todayStr={todayStr}
          selectedDate={selectedDate}
          onToggleCheckin={onToggleCheckin}
          onToggleTodo={onToggleTodo}
          onTogglePhase={onTogglePhase}
        />
      ))
    )}
  </Box>
);

function SchedulePage() {
  const todayStr = getToday();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [version, setVersion] = useState(0); // 数据变更后递增以触发重读

  const refresh = () => setVersion((v) => v + 1);

  const items = useMemo(() => getCheckinItems(), [version]);
  const records = useMemo(() => getCheckinRecords(), [version]);
  const todos = useMemo(() => getTodos(), [version]);

  // 计算某天的全部条目
  const getEntries = (dateStr) => {
    const dayRec = records[dateStr] || {};
    const checkins = items.map((item) => ({
      kind: 'checkin',
      item,
      rec: dayRec[item.id] || null,
    }));
    const todoDue = todos
      .filter((t) => t.dueDate === dateStr)
      .map((t) => ({ kind: 'todo', todo: t }));
    const phaseDue = todos.flatMap((t) =>
      (t.phases || [])
        .filter((p) => p.dueDate === dateStr)
        .map((p) => ({ kind: 'phase', todo: t, phase: p }))
    );
    return [...checkins, ...todoDue, ...phaseDue];
  };

  // 月历网格
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const leadingBlanks = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 周一为首列
  const dayCells = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const goPrev = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const goNext = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };
  const goToday = () => {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth() + 1);
    setSelectedDate(todayStr);
  };

  const onToggleCheckin = (date, itemId, completed) => {
    toggleCheckin(date, itemId, completed);
    refresh();
  };
  const onToggleTodo = (id) => { toggleTodo(id); refresh(); };
  const onTogglePhase = (todoId, phaseId) => { toggleTodoPhase(todoId, phaseId); refresh(); };

  const selectedEntries = getEntries(selectedDate);
  const selectedCheckins = selectedEntries.filter((e) => e.kind === 'checkin');
  const selectedTodos = selectedEntries.filter((e) => e.kind === 'todo');
  const selectedPhases = selectedEntries.filter((e) => e.kind === 'phase');

  return (
    <Box sx={{ px: 1.5, pt: 2, pb: 2, width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h4" sx={{ mb: 1, color: '#c9d1d9' }}>
        日程
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, flex: 1, minHeight: 0 }}>
        {/* 月历（仅展示打卡项） */}
        <Box sx={{ flex: 2, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', scrollbarGutter: 'stable' }}>
          {/* 月份导航 + 今天（圆角矩形容器，样式与汇总统计的月份选择一致） */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: '#161b22', borderRadius: '16px', px: 0.5, border: '1px solid #30363d', height: 44 }}>
              <IconButton size="small" onClick={goPrev} sx={{ color: '#8b949e', '&:hover': { color: '#fff' } }}>
                <ChevronLeftIcon />
              </IconButton>
              <Typography variant="h6" sx={{ color: '#c9d1d9', fontWeight: 700, minWidth: 120, textAlign: 'center' }}>
                {viewYear}年{viewMonth}月
              </Typography>
              <IconButton size="small" onClick={goNext} sx={{ color: '#8b949e', '&:hover': { color: '#fff' } }}>
                <ChevronRightIcon />
              </IconButton>
            </Box>
            <Button
              size="small"
              startIcon={<TodayIcon />}
              onClick={goToday}
              sx={{
                color: '#58a6ff',
                textTransform: 'none',
                border: '1px solid #30363d',
                borderRadius: '16px',
                bgcolor: '#161b22',
                height: 44,
                px: 1.5,
                whiteSpace: 'nowrap',
              }}
            >
              今天
            </Button>
          </Box>

          {/* 星期表头 */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}>
            {WEEK_HEADERS.map((w) => (
              <Typography key={w} variant="caption" sx={{ textAlign: 'center', color: '#6e7681', fontSize: '0.72rem', fontWeight: 600 }}>
                {w}
              </Typography>
            ))}
          </Box>

          {/* 日期格 */}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gridAutoRows: '1fr',
              gap: 0.5,
              bgcolor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '16px',
              p: 0.5,
            }}
          >
            {dayCells.map((d, idx) => {
              if (d === null) return <Box key={`b${idx}`} />;
              const dateStr = `${viewYear}-${pad(viewMonth)}-${pad(d)}`;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const entries = getEntries(dateStr);
              const checkinEntries = entries.filter((e) => e.kind === 'checkin');
              return (
                <Box
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  sx={{
                    minHeight: 104,
                    p: 0.5,
                    borderRadius: '16px',
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isSelected ? '#1f6feb' : '#21262d',
                    bgcolor: isSelected ? 'rgba(31,111,235,0.08)' : 'transparent',
                    transition: 'background 0.15s, border 0.15s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.2,
                    '&:hover': { borderColor: '#388bfd', bgcolor: 'rgba(177,186,196,0.06)' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: isToday ? 700 : 500,
                        color: isToday ? '#1f6feb' : '#8b949e',
                        fontSize: '0.78rem',
                      }}
                    >
                      {d}
                    </Typography>
                  </Box>
                  {/* 内部可滚动，展示全部打卡项状态 */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15, overflow: 'auto', flex: 1, minHeight: 0 }}>
                    {checkinEntries.map((e, i) => (
                      <MiniEntry key={i} e={e} todayStr={todayStr} />
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* 图例 */}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 1, flexWrap: 'wrap' }}>
            {[
              { c: '#3fb950', t: '打卡已完成' },
              { c: '#484f58', t: '未打卡' },
            ].map((l) => (
              <Box key={l.t} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: l.c }} />
                <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.7rem' }}>{l.t}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* 当日清单详情（打卡 / 待办 / 行动，可在此直接勾选完成） */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            bgcolor: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '16px',
            p: 1.5,
            overflow: 'auto',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ color: '#c9d1d9', fontWeight: 700 }}>
              {selectedDate}
            </Typography>
            {selectedDate === todayStr && (
              <Chip label="今天" size="small" sx={{ color: '#1f6feb', bgcolor: 'rgba(31,111,235,0.12)', fontSize: '0.65rem', height: 20 }} />
            )}
          </Box>
          <DetailGroup title="打卡" color="#3fb950" entries={selectedCheckins} todayStr={todayStr} selectedDate={selectedDate} onToggleCheckin={onToggleCheckin} onToggleTodo={onToggleTodo} onTogglePhase={onTogglePhase} />
          <DetailGroup title="待办" color="#d29922" entries={selectedTodos} todayStr={todayStr} selectedDate={selectedDate} onToggleCheckin={onToggleCheckin} onToggleTodo={onToggleTodo} onTogglePhase={onTogglePhase} />
          <DetailGroup title="行动" color="#58a6ff" entries={selectedPhases} todayStr={todayStr} selectedDate={selectedDate} onToggleCheckin={onToggleCheckin} onToggleTodo={onToggleTodo} onTogglePhase={onTogglePhase} />
        </Box>
      </Box>
    </Box>
  );
}

export default SchedulePage;
