import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Divider,
} from '@mui/material';
import { getNowTime } from '../utils/storage';

/**
 * 待办事项完成对话框
 * 点击「标记为完成」时弹出，填写完成时间和KISS复盘
 * KEEP - 保持 | IMPROVE - 改进 | STOP - 停止 | START - 开始
 * 编辑模式：传入 existingRecord 预填字段，标题改为「编辑完成记录」
 *
 * @param {boolean} open
 * @param {Function} onClose
 * @param {Function} onConfirm ({ completedTime, review }) => void
 * @param {Object|null} todo 当前待办事项
 * @param {Object|null} existingRecord 已有完成记录 { completedTime, review }，用于编辑模式
 */
function TodoCompleteDialog({ open, onClose, onConfirm, todo, existingRecord }) {
  const [completedTime, setCompletedTime] = useState('');
  const [keep, setKeep] = useState('');
  const [improve, setImprove] = useState('');
  const [stop, setStop] = useState('');
  const [start, setStart] = useState('');

  const isEditMode = !!existingRecord;

  useEffect(() => {
    if (open) {
      if (existingRecord) {
        // 编辑模式：预填已有数据
        setCompletedTime(existingRecord.completedTime || '');
        const r = existingRecord.review || {};
        setKeep(r.keep || '');
        setImprove(r.improve || '');
        setStop(r.stop || '');
        setStart(r.start || '');
      } else {
        // 新完成模式：用当前时间，字段留空
        setCompletedTime(getNowTime());
        setKeep('');
        setImprove('');
        setStop('');
        setStart('');
      }
    }
  }, [open, existingRecord]);

  const handleConfirm = () => {
    onConfirm({
      completedTime,
      review: { keep: keep.trim(), improve: improve.trim(), stop: stop.trim(), start: start.trim() },
    });
    resetState();
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const resetState = () => {
    setCompletedTime('');
    setKeep('');
    setImprove('');
    setStop('');
    setStart('');
  };

  const fieldSx = {
    '& .MuiOutlinedInput-root': {
      '& fieldset': { borderColor: '#30363d' },
      '&:hover fieldset': { borderColor: '#1f6feb' },
    },
    '& .MuiInputLabel-root': { color: '#6e7681' },
    '& .MuiInputBase-input': { color: '#c9d1d9' },
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>
        {isEditMode ? '编辑完成记录' : '标记完成'}
        {todo && (
          <span style={{ color: '#1f6feb', marginLeft: 8 }}>
            {todo.title}
          </span>
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* 完成时间 */}
          <TextField
            autoFocus
            fullWidth
            label="完成时间"
            type="time"
            value={completedTime}
            onChange={(e) => setCompletedTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={fieldSx}
          />

          <Divider sx={{ borderColor: '#30363d', my: 0.5 }} />

          {/* KISS 复盘 */}
          <Typography variant="subtitle2" sx={{ color: '#1f6feb', fontWeight: 600 }}>
            KISS 复盘
          </Typography>

          <TextField
            fullWidth
            label="KEEP - 保持"
            placeholder="哪些做法值得继续保持？"
            value={keep}
            onChange={(e) => setKeep(e.target.value)}
            multiline
            rows={2}
            sx={fieldSx}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            fullWidth
            label="IMPROVE - 改进"
            placeholder="哪些方面可以做得更好？"
            value={improve}
            onChange={(e) => setImprove(e.target.value)}
            multiline
            rows={2}
            sx={fieldSx}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            fullWidth
            label="STOP - 停止"
            placeholder="哪些做法需要停止？"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            multiline
            rows={2}
            sx={fieldSx}
            inputProps={{ maxLength: 200 }}
          />
          <TextField
            fullWidth
            label="START - 开始"
            placeholder="应该开始采取哪些新措施？"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            multiline
            rows={2}
            sx={fieldSx}
            inputProps={{ maxLength: 200 }}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} sx={{ color: '#8b949e' }}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          sx={{ bgcolor: '#3fb950', color: '#000', fontWeight: 600, '&:hover': { bgcolor: '#238636' } }}
        >
          {isEditMode ? '保存修改' : '确认完成'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default TodoCompleteDialog;
