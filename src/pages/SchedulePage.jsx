import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Checkbox,
  Chip,
  TextField,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import EventIcon from '@mui/icons-material/Event';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  getActiveCheckinItems,
  getCheckinRecords,
  getActiveTodos,
  getToday,
  getUpcomingPhases,
  getQuickNotes,
  addQuickNote,
  toggleQuickNote,
  deleteQuickNote,
  isPastDue,
  toggleCheckin,
  toggleTodo,
  toggleTodoPhase,
  TODO_PRIORITIES,
} from '../utils/storage';

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
/** 提醒的向前观察窗口（天） */
const REMINDER_WINDOW = 7;
/**
 * 提醒用紫色系：本页绿=打卡、琥珀=待办、蓝=行动各占一个色相，红按既有约定只留给
 * 「已过期」这个状态语义，所以提醒必须另立一色，否则标题会跟待办撞成同一种颜色。
 */
const REMINDER_COLOR = '#bc8cff';
/** 明天到期：紫色里最亮的一档，在本就偏暗的紫色系里最抓眼 */
const REMINDER_COLOR_SOON = '#d2a8ff';
/** 还有几天：同一色相压暗，避免与「明天」抢注意力 */
const REMINDER_COLOR_LATER = '#a371f7';
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
          {/* 不显示「完成于 hh:mm」：这行字只在勾上之后出现，会把整行撑高，
              在月历里点完一个勾，右栏其余条目就跟着往下跳。 */}
        </Box>
        <Chip label="打卡" size="small" sx={{ color: '#8b949e', bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.65rem', height: 20 }} />
      </Box>
    );
  }
  if (e.kind === 'todo') {
    const t = e.todo;
    const cfg = TODO_PRIORITIES[t.priority] || TODO_PRIORITIES.not_urgent_important;
    const overdue = isPastDue(t.completed, t.dueDate, todayStr);
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
  const overdue = isPastDue(p.completed, p.dueDate, todayStr);
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

/**
 * 剩余天数 → 提醒文案与颜色。
 * 逾期最紧急，仍用状态语义的红；其余走紫色由亮到暗。今天到期不会走到这里——
 * 它属于「行动」，storage 的 getUpcomingPhases 已经把它排除出提醒。
 */
const reminderUrgency = (daysLeft) => {
  if (daysLeft < 0) return { text: `已逾期 ${-daysLeft} 天`, color: '#f85149' };
  if (daysLeft === 1) return { text: '明天到期', color: REMINDER_COLOR_SOON };
  return { text: `${daysLeft} 天后`, color: REMINDER_COLOR_LATER };
};

/**
 * 提醒里的一条行动项：可直接勾选完成。
 * 勾完不消失，改成与其他分区一致的「划掉 + 变灰」，行高与位置都不变；
 * 已完成不再标红「已逾期」——本页的红色只留给仍然活着的逾期状态。
 */
const ReminderRow = ({ item, onTogglePhase }) => {
  const { todo, phase, dueDate, daysLeft } = item;
  const done = !!phase.completed;
  const urgency = reminderUrgency(daysLeft);
  const tone = done ? '#6e7681' : urgency.color;
  const cfg = TODO_PRIORITIES[todo.priority] || TODO_PRIORITIES.not_urgent_important;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Checkbox
        checked={done}
        onChange={() => onTogglePhase(todo.id, phase.id)}
        size="small"
        sx={{ color: '#484f58', '&.Mui-checked': { color: '#3fb950' }, '&:hover': { color: '#3fb950' }, p: 0.3 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ color: done ? '#6e7681' : '#c9d1d9', textDecoration: done ? 'line-through' : 'none', fontSize: '0.82rem' }}
        >
          {todo.title} <span style={{ color: '#6e7681' }}>›</span> {phase.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2, mt: 0.1 }}>
          <EventIcon sx={{ fontSize: 12, color: tone }} />
          <Typography variant="caption" sx={{ color: tone, fontSize: '0.65rem' }}>
            截止 {fmtMd(dueDate)}
            {done ? '' : ` · ${urgency.text}`}
          </Typography>
        </Box>
      </Box>
      <Chip label={cfg.label} size="small" sx={{ color: cfg.color, bgcolor: cfg.bg, fontSize: '0.65rem', height: 20 }} />
    </Box>
  );
};

/** 某一天的临时任务：手动输入、勾选完成、删除前确认 */
const QuickNotes = ({ dateStr, notes, onAdd, onToggle, onDelete }) => {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(null); // 等待确认删除的那条

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <Box sx={{ borderTop: '1px solid #30363d', mt: 1, pt: 1.5 }}>
      <Typography variant="caption" sx={{ color: '#8b949e', fontWeight: 700, fontSize: '0.8rem', display: 'block', mb: 0.3 }}>
        临时（{notes.length}）
      </Typography>
      <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.7rem', display: 'block', mb: 0.8 }}>
        记下 {dateStr} 要顺手处理的临时事项
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.8, mb: 0.8 }}>
        <TextField
          size="small"
          fullWidth
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="输入临时任务，回车添加"
          inputProps={{ maxLength: 200 }}
          sx={{ '& .MuiOutlinedInput-input': { fontSize: '0.82rem', py: 0.9 } }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={submit}
          disabled={!draft.trim()}
          sx={{ color: '#8b949e', borderColor: '#30363d', fontSize: '0.78rem', px: 1.5 }}
        >
          添加
        </Button>
      </Box>

      {notes.length === 0 ? (
        <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.75rem' }}>还没有临时任务</Typography>
      ) : notes.map((n) => (
        <Box key={n.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3 }}>
          <Checkbox
            checked={n.done}
            onChange={() => onToggle(n.id)}
            size="small"
            sx={{ color: '#484f58', '&.Mui-checked': { color: '#3fb950' }, p: 0.3 }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: n.done ? '#6e7681' : '#c9d1d9', textDecoration: n.done ? 'line-through' : 'none', fontSize: '0.82rem' }}>
              {n.text}
            </Typography>
            {/* 同打卡行：勾选后不补「完成于」，避免列表在操作后整体位移 */}
          </Box>
          <IconButton size="small" onClick={() => setPending(n)} sx={{ color: '#484f58', '&:hover': { color: '#f85149' } }}>
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      ))}

      <ConfirmDialog
        open={!!pending}
        title="删除临时任务"
        message={pending ? `确定删除「${pending.text}」吗？删除后不可恢复。` : ''}
        onConfirm={() => { if (pending) onDelete(pending.id); }}
        onClose={() => setPending(null)}
      />
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

  const items = useMemo(() => getActiveCheckinItems(), [version]);
  const records = useMemo(() => getCheckinRecords(), [version]);
  const todos = useMemo(() => getActiveTodos(), [version]);

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
  const onAddNote = (text) => { addQuickNote(selectedDate, text); refresh(); };
  const onToggleNote = (id) => { toggleQuickNote(selectedDate, id); refresh(); };
  const onDeleteNote = (id) => { deleteQuickNote(selectedDate, id); refresh(); };

  const selectedEntries = getEntries(selectedDate);
  const selectedCheckins = selectedEntries.filter((e) => e.kind === 'checkin');
  const selectedTodos = selectedEntries.filter((e) => e.kind === 'todo');
  const selectedPhases = selectedEntries.filter((e) => e.kind === 'phase');

  // 提醒以「今天」为锚点滚动向前看一周，与左栏选中的日期无关
  const reminders = useMemo(() => getUpcomingPhases(REMINDER_WINDOW, todayStr), [todos, todayStr]);
  // 临时任务则跟着选中的日期走，可以给任意一天记事项
  const notes = useMemo(() => getQuickNotes(selectedDate), [selectedDate, version]);

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

          {/* 提醒：除「今天到期」之外的行动项（已逾期 + 未来一周），逾期置顶，完成的留在原地 */}
          <Box sx={{ borderTop: '1px solid #30363d', mt: 1, pt: 1.5 }}>
            {/* 紫色与打卡(绿)/待办(琥珀)/行动(蓝)分开；本页红色只留给「已过期」状态 */}
            <Typography variant="caption" sx={{ color: REMINDER_COLOR, fontWeight: 700, fontSize: '0.8rem', display: 'block', mb: 0.3 }}>
              提醒（{reminders.length}）
            </Typography>
            <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
              今天到期的见上方「行动」；这里列已逾期与未来 {REMINDER_WINDOW} 天内的行动项，按时勾掉的划掉变灰留在原地，逾期后才补做的不再显示
            </Typography>
            {reminders.length === 0 ? (
              <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.75rem' }}>近一周没有到期的行动项</Typography>
            ) : (
              reminders.map((item) => (
                <ReminderRow key={`${item.todo.id}-${item.phase.id}`} item={item} onTogglePhase={onTogglePhase} />
              ))
            )}
          </Box>

          {/* key 绑日期：切换选中日时清掉未提交的输入草稿 */}
          <QuickNotes
            key={selectedDate}
            dateStr={selectedDate}
            notes={notes}
            onAdd={onAddNote}
            onToggle={onToggleNote}
            onDelete={onDeleteNote}
          />
        </Box>
      </Box>
    </Box>
  );
}

export default SchedulePage;
