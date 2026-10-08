import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  IconButton,
  Box,
  Tooltip,
} from '@mui/material';
import ModeEditIcon from '@mui/icons-material/ModeEdit';
import EditNoteIcon from '@mui/icons-material/EditNote';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import AccessTimeIcon from '@mui/icons-material/AccessTime';

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
 * 单个打卡项组件
 * 已完成的打卡项展示打卡时间和备注信息
 * 左侧拖拽手柄可拖动排序
 *
 * @param {Object} item 打卡项目 { id, name }
 * @param {Object|null} record 打卡记录 { completed, time, note }
 * @param {Function} onRequestComplete 请求完成回调 (item) => void
 * @param {Function} onCancelComplete 取消完成回调 (itemId) => void
 * @param {Function} onEdit 编辑回调
 * @param {Function} onDelete 删除回调
 * @param {Function} onEditRecord 编辑打卡记录回调 (item, record) => void
 * @param {number} index 在列表中的索引
 * @param {Function} onDragStart
 * @param {Function} onDragOver
 * @param {Function} onDrop
 */
function CheckinItem({ item, record, onRequestComplete, onCancelComplete, onEdit, onDelete, onEditRecord, index, onDragStart, onDragOver, onDrop }) {
  const completed = record && record.completed;
  const time = record && record.time;
  const note = record && record.note;

  const handleToggle = () => {
    if (completed) {
      onCancelComplete(item.id);
    } else {
      onRequestComplete(item);
    }
  };

  return (
    <Card
      className="hover-card"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); onDragStart && onDragStart(index); }}
      onDragOver={(e) => { e.preventDefault(); onDragOver && onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); onDrop && onDrop(index); }}
      onDragEnd={(e) => { e.preventDefault(); }}
      sx={{
        bgcolor: '#161b22',
        border: '1px solid',
        borderColor: completed ? 'rgba(0, 230, 118, 0.3)' : '#30363d',
        transition: 'all 0.2s ease',
        mb: 1.5,
        '&:active': { opacity: 0.7, cursor: 'grabbing' },
      }}
    >
      <CardContent
        sx={{
          py: 1.5,
          px: 2,
          '&:last-child': { pb: 1.5 },
          display: 'flex',
          alignItems: 'center',
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
            pr: 0.5,
            '&:hover': { color: '#8b949e' },
            '&:active': { cursor: 'grabbing' },
            userSelect: 'none',
          }}
          onMouseDown={(e) => {
            // 让卡片本身不拦截拖拽
            const card = e.currentTarget.closest('[draggable]');
            if (card) {
              card.draggable = true;
            }
          }}
        >
          <DragHandleIcon />
        </Box>

        {/* 内容区（占满剩余空间） */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* 第一行：切换按钮 + 名称 + 操作 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Tooltip title={completed ? '标记为未完成' : '标记为已完成'}>
                <IconButton
                  onClick={handleToggle}
                  sx={{
                    p: 0.5,
                    color: completed ? '#3fb950' : '#484f58',
                    transition: 'color 0.2s',
                    '&:hover': {
                      color: completed ? '#56d364' : '#1f6feb',
                    },
                  }}
                >
                  {completed ? (
                    <CheckCircleIcon sx={{ fontSize: 28 }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 28 }} />
                  )}
                </IconButton>
              </Tooltip>
              <Typography
                variant="body1"
                sx={{
                  color: completed ? '#8b949e' : '#c9d1d9',
                  textDecoration: completed ? 'line-through' : 'none',
                  fontWeight: 500,
                  userSelect: 'none',
                }}
              >
                {item.name}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {/* 编辑记录（仅已完成时显示，便签+铅笔图标） */}
              {completed && onEditRecord && (
                <Tooltip title="编辑记录">
                  <IconButton
                    size="small"
                    onClick={() => onEditRecord(item, record)}
                    sx={{ color: '#8b949e', '&:hover': { color: '#1f6feb' } }}
                  >
                    <EditNoteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {/* 编辑项目（铅笔图标） */}
              <Tooltip title="编辑">
                <IconButton
                  size="small"
                  onClick={() => onEdit(item)}
                  sx={{ color: '#8b949e', '&:hover': { color: '#1f6feb' } }}
                >
                  <ModeEditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <IconButton
                  size="small"
                  onClick={() => onDelete(item.id)}
                  sx={{ color: '#8b949e', '&:hover': { color: '#f85149' } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* 已完成的打卡时间和备注 */}
          {completed && (time || note) && (
            <Box sx={{ ml: 5.5, mt: 0.5 }}>
              {time && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <AccessTimeIcon sx={{ fontSize: 13, color: '#6e7681' }} />
                  <Typography variant="caption" sx={{ color: '#6e7681' }}>
                    {time}
                  </Typography>
                </Box>
              )}
              {note && (
                <Typography
                  variant="caption"
                  sx={{
                    color: '#8b949e',
                    fontStyle: 'italic',
                    lineHeight: 1.3,
                    display: 'block',
                    mt: 0.3,
                  }}
                >
                  {note}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

export default CheckinItem;
