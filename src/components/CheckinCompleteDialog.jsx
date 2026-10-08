import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
} from '@mui/material';
import { getNowTime } from '../utils/storage';

/**
 * 打卡完成/编辑对话框
 * - 新增模式（existingRecord 为 null）：点击「标记为完成」时弹出，预填当前时间
 * - 编辑模式（existingRecord 非 null）：点击已完成记录的编辑按钮时弹出，预填已有 time/note
 *
 * @param {boolean} open
 * @param {Function} onClose
 * @param {Function} onConfirm (time, note) => void
 * @param {Object|null} item 当前打卡项目
 * @param {Object|null} existingRecord 已有打卡记录 { completed, time, note }，编辑模式时传入，为 null 表示新打卡
 */
function CheckinCompleteDialog({ open, onClose, onConfirm, item, existingRecord }) {
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const isEditMode = Boolean(existingRecord);

  useEffect(() => {
    if (open) {
      if (existingRecord) {
        // 编辑模式：预填已有记录的时间与备注
        setTime(existingRecord.time || '');
        setNote(existingRecord.note || '');
      } else {
        // 新增模式：重置为当前时间 + 空备注
        setTime(getNowTime());
        setNote('');
      }
    }
  }, [open, existingRecord]);

  const handleConfirm = () => {
    onConfirm(time, note);
    setTime('');
    setNote('');
  };

  const handleClose = () => {
    setTime('');
    setNote('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>
        {isEditMode ? '编辑打卡记录' : '打卡完成'}
        {item && (
          <span style={{ color: '#1f6feb', marginLeft: 8 }}>{item.name}</span>
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            label="打卡时间"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            fullWidth
            label="打卡备注（可选）"
            placeholder="记录一下此刻的感受或备注..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            rows={3}
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
          sx={{ bgcolor: '#1f6feb', '&:hover': { bgcolor: '#388bfd' } }}
        >
          {isEditMode ? '保存修改' : '确认完成'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CheckinCompleteDialog;
