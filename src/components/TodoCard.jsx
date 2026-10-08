import React, { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  IconButton,
  Box,
  Chip,
  Checkbox,
  Tooltip,
  Collapse,
  LinearProgress,
} from '@mui/material';
import ModeEditIcon from '@mui/icons-material/ModeEdit';
import EditNoteIcon from '@mui/icons-material/EditNote';
import DeleteIcon from '@mui/icons-material/Delete';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EventIcon from '@mui/icons-material/Event';
import FlagIcon from '@mui/icons-material/Flag';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { TODO_PRIORITIES } from '../utils/storage';

/**
 * 拖拽手柄 SVG 图标（三道杠）
 */
function DragHandleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="2" y="7" width="12" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="2" y="11" width="12" height="1.5" rx="0.75" fill="currentColor" />
    </svg>
  );
}

/**
 * 把 YYYY-MM-DD 显示为 MM-DD（行动截止时间紧凑展示）
 */
const fmtMd = (s) => {
  if (!s) return '';
  const p = String(s).split('-');
  return p.length === 3 ? `${p[1]}-${p[2]}` : s;
};

/**
 * 待办事项卡片组件
 * 展示STAR描述、四象限优先级、KISS复盘
 * 左侧拖拽手柄可拖动排序
 *
 * @param {Object} todo
 * @param {Function} onRequestComplete
 * @param {Function} onCancelComplete
 * @param {Function} onEdit
 * @param {Function} onDelete
 * @param {boolean} sidebarSelected
 * @param {number} index
 * @param {Function} onDragStart
 * @param {Function} onDragOver
 * @param {Function} onDrop
 * @param {Function} onTogglePhase - 切换阶段完成状态
 */
function TodoCard({ todo, onRequestComplete, onCancelComplete, onEdit, onDelete, onEditRecord, sidebarSelected, index, onDragStart, onDragOver, onDrop, onTogglePhase }) {
  const [phasesExpanded, setPhasesExpanded] = useState(false);
  const priority = TODO_PRIORITIES[todo.priority] || TODO_PRIORITIES.not_urgent_important;
  const desc = todo.description || {};
  const review = todo.review || {};
  const hasPhases = todo.phases && todo.phases.length > 0;
  const phasesTotal = hasPhases ? todo.phases.length : 0;
  const phasesCompleted = hasPhases ? todo.phases.filter((p) => p.completed).length : 0;
  const phasesProgress = phasesTotal > 0 ? Math.round((phasesCompleted / phasesTotal) * 100) : 0;

  const formatDateStr = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return dateStr;
    }
  };

  const isOverdue = () => {
    if (!todo.dueDate || todo.completed) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(todo.dueDate);
    return due < today;
  };

  const handleCheck = () => {
    if (todo.completed) {
      onCancelComplete(todo.id);
    } else {
      onRequestComplete(todo);
    }
  };

  const handlePhaseCheck = (phaseId) => {
    if (onTogglePhase) {
      onTogglePhase(todo.id, phaseId);
    }
  };

  const hasSTAR = desc.situation || desc.target || desc.action || desc.result;
  const hasKISS = review.keep || review.improve || review.stop || review.start;

  return (
    <Card
      className="hover-card"
      data-todo-id={todo.id}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); onDragStart && onDragStart(index); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver && onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); onDrop && onDrop(index); }}
      onDragEnd={(e) => { e.preventDefault(); }}
      sx={{
        bgcolor: '#161b22',
        border: '1px solid',
        borderColor: sidebarSelected
          ? priority.color
          : todo.completed
          ? 'rgba(0, 230, 118, 0.2)'
          : isOverdue()
          ? 'rgba(255, 82, 82, 0.2)'
          : '#30363d',
        mb: 1.5,
        opacity: todo.completed ? 0.75 : 1,
        transition: 'all 0.2s',
        '&:active': { opacity: 0.7, cursor: 'grabbing' },
      }}
    >
      <CardContent
        sx={{
          py: 1.5,
          px: 2,
          '&:last-child': { pb: 1.5 },
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.5,
        }}
      >
        {/* 拖拽手柄 */}
        <Box
          className="drag-handle"
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'grab',
            color: '#484f58',
            flexShrink: 0,
            pt: 0.8,
            pr: 0.5,
            '&:hover': { color: '#8b949e' },
            '&:active': { cursor: 'grabbing' },
            userSelect: 'none',
          }}
        >
          <DragHandleIcon />
        </Box>

        {/* 内容区 */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* 第一行：复选框 + 标题 + 操作 */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flex: 1 }}>
              <Checkbox
                checked={todo.completed}
                onChange={handleCheck}
                sx={{
                  color: '#484f58',
                  '&.Mui-checked': { color: '#3fb950' },
                  p: 0.5,
                  mt: 0.3,
                }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 600,
                    color: todo.completed ? '#8b949e' : '#c9d1d9',
                    textDecoration: todo.completed ? 'line-through' : 'none',
                    wordBreak: 'break-word',
                  }}
                >
                  {todo.title}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5, ml: 1, flexShrink: 0 }}>
              {/* 编辑记录（仅已完成时显示，便签+铅笔图标，与编辑图标大小一致） */}
              {todo.completed && onEditRecord && (
                <Tooltip title="编辑记录">
                  <IconButton
                    size="small"
                    onClick={() => onEditRecord(todo)}
                    sx={{ color: '#8b949e', '&:hover': { color: '#1f6feb' } }}
                  >
                    <EditNoteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {/* 编辑（铅笔图标） */}
              <Tooltip title="编辑">
                <IconButton
                  size="small"
                  onClick={() => onEdit(todo)}
                  sx={{ color: '#8b949e', '&:hover': { color: '#1f6feb' } }}
                >
                  <ModeEditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton
                  size="small"
                  onClick={() => onDelete(todo.id)}
                  sx={{ color: '#8b949e', '&:hover': { color: '#f85149' } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* STAR 描述（ACTION 文本不再单独渲染：已并入下方的 phases 行动列表） */}
          {hasSTAR && (
            <Box sx={{ ml: 5, mt: 0.8, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {desc.situation && (
                <Typography variant="caption" sx={{ color: '#8b949e', lineHeight: 1.3 }}>
                  <span style={{ color: '#1f6feb', fontWeight: 600 }}>SITUATION</span> {desc.situation}
                </Typography>
              )}
              {desc.target && (
                <Typography variant="caption" sx={{ color: '#8b949e', lineHeight: 1.3 }}>
                  <span style={{ color: '#58a6ff', fontWeight: 600 }}>TARGET</span> {desc.target}
                </Typography>
              )}
              {/* 若历史数据没有 phases，但 desc.action 有内容（纯文本），仍兜底渲染一次 */}
              {!hasPhases && desc.action && (
                <Typography variant="caption" sx={{ color: '#8b949e', lineHeight: 1.3, whiteSpace: 'pre-wrap' }}>
                  <span style={{ color: '#d29922', fontWeight: 600 }}>ACTION</span> {desc.action}
                </Typography>
              )}
              {desc.result && (
                <Typography variant="caption" sx={{ color: '#8b949e', lineHeight: 1.3 }}>
                  <span style={{ color: '#3fb950', fontWeight: 600 }}>RESULT</span> {desc.result}
                </Typography>
              )}
            </Box>
          )}

          {/* 📋 子任务/阶段进度 */}
          {hasPhases && (
            <Box sx={{ ml: 5, mt: 1 }}>
              {/* 进度条 */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Box sx={{ flex: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={phasesProgress}
                    sx={{
                      height: 6,
                      borderRadius: 3,
                      bgcolor: '#30363d',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: phasesProgress === 100 ? '#3fb950' : '#1f6feb',
                        borderRadius: 3,
                      },
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: '#8b949e', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {phasesCompleted}/{phasesTotal}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => setPhasesExpanded(!phasesExpanded)}
                  sx={{ color: '#6e7681', p: 0.3 }}
                >
                  {phasesExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
              </Box>

              {/* 阶段列表 */}
              <Collapse in={phasesExpanded}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, ml: 0.5 }}>
                  {todo.phases.map((phase) => (
                    <Box
                      key={phase.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 0.2,
                      }}
                    >
                      <Checkbox
                        checked={phase.completed}
                        onChange={() => handlePhaseCheck(phase.id)}
                        size="small"
                        sx={{
                          color: '#484f58',
                          '&.Mui-checked': { color: '#3fb950' },
                          p: 0.3,
                        }}
                      />
                        <Typography
                          variant="caption"
                          sx={{
                            flex: 1,
                            color: phase.completed ? '#6e7681' : '#c9d1d9',
                            textDecoration: phase.completed ? 'line-through' : 'none',
                            fontSize: '0.75rem',
                          }}
                        >
                          {phase.name}
                        </Typography>
                        {phase.dueDate && (() => {
                          const overdue = !phase.completed && new Date(phase.dueDate) < new Date(new Date().toDateString());
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2, mr: 0.3, flexShrink: 0 }}>
                              <EventIcon sx={{ fontSize: 12, color: overdue ? '#f85149' : '#6e7681' }} />
                              <Typography variant="caption" sx={{ color: overdue ? '#f85149' : '#6e7681', fontSize: '0.65rem' }}>
                                {fmtMd(phase.dueDate)}
                              </Typography>
                            </Box>
                          );
                        })()}
                        {phase.completedTime && (
                        <Typography variant="caption" sx={{ color: '#484f58', fontSize: '0.65rem', mr: 0.5 }}>
                          {phase.completedTime}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </Box>
          )}

          {/* KISS 复盘 */}
          {todo.completed && hasKISS && (
            <Box sx={{ ml: 5, mt: 0.8, p: 1, bgcolor: 'rgba(0, 230, 118, 0.05)', borderRadius: '16px', border: '1px solid rgba(0, 230, 118, 0.1)' }}>
              <Typography variant="caption" sx={{ color: '#3fb950', fontWeight: 600, display: 'block', mb: 0.3 }}>
                KISS 复盘
              </Typography>
              {review.keep && <Typography variant="caption" sx={{ color: '#8b949e', display: 'block', lineHeight: 1.3 }}><span style={{ color: '#3fb950' }}>KEEP</span> {review.keep}</Typography>}
              {review.improve && <Typography variant="caption" sx={{ color: '#8b949e', display: 'block', lineHeight: 1.3 }}><span style={{ color: '#58a6ff' }}>IMPROVE</span> {review.improve}</Typography>}
              {review.stop && <Typography variant="caption" sx={{ color: '#8b949e', display: 'block', lineHeight: 1.3 }}><span style={{ color: '#f85149' }}>STOP</span> {review.stop}</Typography>}
              {review.start && <Typography variant="caption" sx={{ color: '#8b949e', display: 'block', lineHeight: 1.3 }}><span style={{ color: '#d29922' }}>START</span> {review.start}</Typography>}
            </Box>
          )}

          {/* 标签区 */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1, ml: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip
              icon={<FlagIcon sx={{ fontSize: 14, color: `${priority.color} !important` }} />}
              label={priority.label}
              size="small"
              sx={{ color: priority.color, bgcolor: priority.bg, fontWeight: 600, fontSize: '0.7rem', height: 22 }}
            />
            {todo.completed && todo.completedTime && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                <AccessTimeIcon sx={{ fontSize: 13, color: '#3fb950' }} />
                <Typography variant="caption" sx={{ color: '#3fb950', fontWeight: 500 }}>{todo.completedTime}</Typography>
              </Box>
            )}
            {todo.dueDate && (
              <Typography variant="caption" sx={{ color: isOverdue() ? '#f85149' : '#6e7681', fontWeight: isOverdue() ? 600 : 400 }}>
                截止: {formatDateStr(todo.dueDate)}{isOverdue() && ' (已过期)'}
              </Typography>
            )}
            <Typography variant="caption" sx={{ color: '#484f58' }}>
              创建: {formatDateStr(todo.createdAt)}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default TodoCard;
