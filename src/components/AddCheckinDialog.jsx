import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
} from '@mui/material';

/**
 * 添加/编辑打卡项目对话框
 *
 * @param {boolean} open 是否打开
 * @param {Function} onClose 关闭回调
 * @param {Function} onSave 保存回调 (name: string) => void
 * @param {Object|null} editItem 编辑模式下的项目对象，null 为新增模式
 */
function AddCheckinDialog({ open, onClose, onSave, editItem }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // 打开时设置初始值
  useEffect(() => {
    if (open) {
      setName(editItem ? editItem.name : '');
      setError('');
    }
  }, [open, editItem]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入打卡项目名称');
      return;
    }
    if (trimmed.length > 20) {
      setError('名称不能超过20个字符');
      return;
    }
    onSave(trimmed);
    setName('');
    setError('');
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>
        {editItem ? '编辑打卡项目' : '添加打卡项目'}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="项目名称"
          placeholder="例如：早起、运动、阅读..."
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={handleKeyDown}
          error={!!error}
          helperText={error}
          sx={{ mt: 1 }}
          inputProps={{ maxLength: 20 }}
        />
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
          {editItem ? '保存' : '添加'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddCheckinDialog;
