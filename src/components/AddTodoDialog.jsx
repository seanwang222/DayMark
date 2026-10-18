import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  IconButton,
  Popover,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EventIcon from '@mui/icons-material/Event';
import { TODO_PRIORITIES, generateId } from '../utils/storage';

/** 把 YYYY-MM-DD 显示为 MM-DD（用于行动截止时间的紧凑展示） */
const fmtMd = (s) => {
  if (!s) return '';
  const p = String(s).split('-');
  return p.length === 3 ? `${p[1]}-${p[2]}` : s;
};

/**
 * 添加/编辑待办事项对话框
 * 描述仅采用「目标 + 行动」两项：
 *   - TARGET（目标）：期望达成的目标
 *   - ACTION（行动）：可勾选的子任务列表
 * 不再收集完整 STAR 描述（SITUATION / RESULT 已移除）。
 * 优先级采用四象限（重要且紧急/紧急不重要/重要不紧急/不重要不紧急）
 *
 * ACTION - 行动：每条行动即一项可勾选的子任务，复用 phases 字段，
 * 保证与 TodoCard 现有进度显示兼容。
 *
 * @param {boolean} open
 * @param {Function} onClose
 * @param {Function} onSave (data: Object) => void
 * @param {Object|null} editTodo
 */
function AddTodoDialog({ open, onClose, onSave, editTodo }) {
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('not_urgent_important');
  const [error, setError] = useState('');
  // 行动列表：每项形如 { id, name, completed, completedTime, dueDate }
  const [actions, setActions] = useState([
    { id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' },
  ]);
  // 行动截止时间 Popover：记录当前打开的日历按钮元素
  const [deadlineAnchorEl, setDeadlineAnchorEl] = useState(null);
  const deadlineAnchorId = deadlineAnchorEl ? deadlineAnchorEl.getAttribute('data-action-id') : null;

  useEffect(() => {
    if (open) {
      if (editTodo) {
        setTitle(editTodo.title || '');
        const d = editTodo.description || {};
        setTarget(d.target || '');
        setDueDate(editTodo.dueDate || '');
        setPriority(editTodo.priority || 'not_urgent_important');
        // 优先使用 phases；若没有 phase 但旧版 description.action 有内容，按换行拆分
        let incoming = editTodo.phases ? editTodo.phases.map((p) => ({ ...p, dueDate: p.dueDate || '' })) : [];
        if (incoming.length === 0 && d.action) {
          incoming = d.action
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({
              id: generateId(),
              name,
              completed: false,
              completedTime: '',
              dueDate: '',
            }));
        }
        setActions(
          incoming.length > 0
            ? incoming
            : [{ id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' }]
        );
      } else {
        setTitle('');
        setTarget('');
        setDueDate('');
        setPriority('not_urgent_important');
        setActions([{ id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' }]);
      }
      setError('');
    }
  }, [open, editTodo]);

  const handleAddAction = () => {
    setActions((prev) => [
      ...prev,
      { id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' },
    ]);
  };

  const handleActionDueDateChange = (id, dueDate) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, dueDate } : a)));
  };

  const handleActionNameChange = (id, name) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)));
  };

  const handleDeleteAction = (id) => {
    setActions((prev) => {
      const next = prev.filter((a) => a.id !== id);
      return next.length > 0
        ? next
        : [{ id: generateId(), name: '', completed: false, completedTime: '' }];
    });
  };

  // 行动行回车：新建一行并自动聚焦；空行 + Backspace：移除当前行
  const handleActionKeyDown = (e, idx) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newRow = { id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' };
      setActions((prev) => {
        const next = [...prev];
        next.splice(idx + 1, 0, newRow);
        return next;
      });
      setTimeout(() => {
        const inputs = document.querySelectorAll('input[data-action-input="true"]');
        if (inputs[idx + 1]) inputs[idx + 1].focus();
      }, 0);
    } else if (e.key === 'Backspace' && !actions[idx].name && actions.length > 1) {
      e.preventDefault();
      const removedId = actions[idx].id;
      handleDeleteAction(removedId);
      setTimeout(() => {
        const inputs = document.querySelectorAll('input[data-action-input="true"]');
        const target = idx > 0 ? idx - 1 : 0;
        if (inputs[target]) inputs[target].focus();
      }, 0);
    }
  };

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('请输入待办标题');
      return;
    }
    if (trimmed.length > 50) {
      setError('标题不能超过50个字符');
      return;
    }

    // 过滤掉空行，并补齐字段
    const cleanedActions = actions
      .map((a) => ({
        id: a.id || generateId(),
        name: a.name.trim(),
        completed: !!a.completed,
        completedTime: a.completedTime || '',
        // 完成日期必须原样带回：本对话框不显示它，漏掉这一个字段，
        // 编辑一次就会把「逾期后补做」伪装成「按时完成」，提醒里的取舍随之翻转
        completedAt: a.completedAt || '',
        dueDate: a.dueDate || '',
      }))
      .filter((a) => a.name);

    // 把行动列表以换行拼回 description.action，保留旧字段兼容性（不依赖也不在 UI 收集）
    const actionText = cleanedActions.map((a) => a.name).join('\n');

    // 本对话框已不收集 SITUATION / RESULT，编辑时把旧值原样带回，
    // 否则 storage.editTodo 会用空串无条件覆盖掉历史记录
    const prevDesc = (editTodo && editTodo.description) || {};

    onSave({
      title: trimmed,
      description: {
        situation: prevDesc.situation || '',
        target: target.trim(),
        action: actionText,
        result: prevDesc.result || '',
      },
      dueDate,
      priority,
      phases: cleanedActions.length > 0 ? cleanedActions : undefined,
    });
    handleClose();
  };

  const handleClose = () => {
    setTitle('');
    setTarget('');
    setDueDate('');
    setPriority('not_urgent_important');
    setActions([{ id: generateId(), name: '', completed: false, completedTime: '', dueDate: '' }]);
    setDeadlineAnchorEl(null);
    setError('');
    onClose();
  };

  // 标题框按下 Enter（无 Shift）即提交（保持原交互）
  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>
        {editTodo ? '编辑待办事项' : '添加待办事项'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* 标题 */}
          <TextField
            autoFocus
            fullWidth
            label="标题"
            placeholder="待办事项标题"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleTitleKeyDown}
            error={!!error}
            helperText={error}
            inputProps={{ maxLength: 50 }}
          />

          {/* TARGET - 目标 */}
          <Typography variant="subtitle2" sx={{ color: '#1f6feb', fontWeight: 600, mt: 0.5 }}>
            TARGET - 目标
          </Typography>

          <TextField
            fullWidth
            label="TARGET - 目标"
            placeholder="期望达成的目标..."
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            multiline
            rows={2}
            inputProps={{ maxLength: 200 }}
          />

          {/* ACTION - 行动（原"子任务（可选）"已并入此处） */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#d29922', fontWeight: 600, fontSize: '0.85rem' }}>
                ACTION - 行动
              </Typography>
              <Typography variant="caption" sx={{ color: '#6e7681', fontSize: '0.7rem' }}>
                回车添加 · Backspace 删除空行
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {actions.map((a, idx) => (
                <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: '#6e7681',
                      minWidth: 22,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      userSelect: 'none',
                    }}
                  >
                    {idx + 1}.
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder={
                      idx === 0 ? '如：第一步 阅读官方文档' : '继续添加行动项...'
                    }
                    value={a.name}
                    onChange={(e) => handleActionNameChange(a.id, e.target.value)}
                    onKeyDown={(e) => handleActionKeyDown(e, idx)}
                    inputProps={{ 'data-action-input': 'true', maxLength: 200 }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <IconButton
                      size="small"
                      data-action-id={a.id}
                      onClick={(e) => setDeadlineAnchorEl(e.currentTarget)}
                      sx={{
                        color: a.dueDate ? '#58a6ff' : '#6e7681',
                        '&:hover': { color: '#1f6feb', bgcolor: 'rgba(88,166,255,0.08)' },
                      }}
                      title={a.dueDate ? `截止 ${a.dueDate}` : '设置本行动截止时间'}
                    >
                      <EventIcon fontSize="small" />
                    </IconButton>
                    {a.dueDate && (
                      <Typography
                        variant="caption"
                        sx={{ color: '#58a6ff', fontSize: '0.7rem', mr: 0.3, whiteSpace: 'nowrap', userSelect: 'none' }}
                      >
                        {fmtMd(a.dueDate)}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteAction(a.id)}
                    disabled={actions.length === 1 && !a.name}
                    sx={{
                      color: '#6e7681',
                      '&:hover': { color: '#f85149', bgcolor: 'rgba(248,81,73,0.08)' },
                      '&.Mui-disabled': { color: '#30363d' },
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
            <Popover
              open={Boolean(deadlineAnchorEl)}
              anchorEl={deadlineAnchorEl}
              onClose={() => setDeadlineAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
              <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <TextField
                  label="截止日期"
                  type="date"
                  size="small"
                  value={(actions.find((x) => x.id === deadlineAnchorId) || {}).dueDate || ''}
                  onChange={(e) => handleActionDueDateChange(deadlineAnchorId, e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: 190 }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => { handleActionDueDateChange(deadlineAnchorId, ''); setDeadlineAnchorEl(null); }}
                  >
                    清除
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setDeadlineAnchorEl(null)}
                    sx={{ bgcolor: '#1f6feb', '&:hover': { bgcolor: '#388bfd' } }}
                  >
                    完成
                  </Button>
                </Box>
              </Box>
            </Popover>
            <Button
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={handleAddAction}
              sx={{
                mt: 1,
                color: '#58a6ff',
                textTransform: 'none',
                '&:hover': { bgcolor: 'rgba(88,166,255,0.08)' },
              }}
            >
              添加行动项
            </Button>
          </Box>

          {/* 截止日期 */}
          <TextField
            fullWidth
            label="截止日期（可选）"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          {/* 四象限优先级 */}
          <FormControl fullWidth>
            <InputLabel>优先级</InputLabel>
            <Select
              value={priority}
              label="优先级"
              onChange={(e) => setPriority(e.target.value)}
              sx={{
                '& .MuiSelect-select': {
                  display: 'flex',
                  alignItems: 'center',
                },
              }}
            >
              {Object.entries(TODO_PRIORITIES).map(([key, cfg]) => (
                <MenuItem key={key} value={key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: cfg.color,
                        display: 'inline-block',
                      }}
                    />
                    {cfg.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} sx={{ color: '#8b949e' }}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          sx={{ bgcolor: '#1f6feb', '&:hover': { bgcolor: '#388bfd' } }}
        >
          {editTodo ? '保存' : '添加'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddTodoDialog;
