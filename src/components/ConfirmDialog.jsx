import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

/**
 * 通用确认弹窗（用于删除等危险操作，替代无确认的直接删除）
 *
 * @param {boolean} open
 * @param {string} title
 * @param {string} message
 * @param {string} confirmText 确认按钮文案（默认「删除」）
 * @param {Function} onConfirm
 * @param {Function} onClose
 */
function ConfirmDialog({ open, title = '确认操作', message, confirmText = '删除', onConfirm, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, color: 'text.primary' }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'text.secondary' }}>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={() => { onConfirm(); onClose(); }}
          sx={{ bgcolor: 'github.red', '&:hover': { bgcolor: 'error.main' }, fontWeight: 600 }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
