/**
 * 同步面板：仅桌面版（Electron）显示
 * - 本机文件持久化状态说明
 * - 坚果云 WebDAV 配置（账号 / 应用密码 / 远程目录）
 * - 手动上传 / 下载与自动同步开关
 */
import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import StorageIcon from '@mui/icons-material/Storage';
import {
  isElectron,
  getCloudConfig,
  saveCloudConfig,
  testCloudConnection,
  pushNow,
  pullNow,
  onSyncStatus,
} from '../utils/persistence';
import { applySnapshot } from '../utils/storage';

const CARD_BG = '#161b22';
const BORDER = '#30363d';
const TEXT = '#c9d1d9';
const MUTED = '#8b949e';
const FAINT = '#6e7681';
const BLUE = '#1f6feb';
const GREEN = '#3fb950';
const RED = '#f85149';
/** 跨刷新传递一次同步结果提示（下载后必须刷新界面，故先暂存此处） */
const PENDING_NOTICE_KEY = 'daymark_pending_sync_notice';

function SyncPanel() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [server, setServer] = useState('');
  const [dir, setDir] = useState('DayMark');
  const [autoSync, setAutoSync] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // {kind, text}
  const [conflict, setConflict] = useState(null); // {side:'pull'|'push', localAt, remoteAt}
  const [status, setStatus] = useState({ status: 'idle', message: '' });

  const showNotice = (kind, text) => setNotice({ kind, text });

  useEffect(() => {
    if (!isElectron()) return;
    // 下载后界面会整页刷新，提示改由这里在下次打开面板时补发一次
    try {
      const raw = localStorage.getItem(PENDING_NOTICE_KEY);
      if (raw) {
        localStorage.removeItem(PENDING_NOTICE_KEY);
        const p = JSON.parse(raw);
        if (p && p.text) setNotice({ kind: p.kind || 'success', text: p.text });
      }
    } catch {
      /* 忽略损坏的一次性提示 */
    }
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    getCloudConfig().then((cfg) => {
      if (cfg) {
        setAccount(cfg.account || '');
        setPasswordSet(!!cfg.passwordSet);
        setServer(cfg.server || '');
        setDir(cfg.dir || 'DayMark');
        setAutoSync(!!cfg.autoSync);
      }
    });
    const off = onSyncStatus((s) => setStatus(s));
    return off;
  }, []);

  const handleSave = async () => {
    if (!account.trim() || !password.trim() && !passwordSet) {
      showNotice('error', '请填写账号与用于授权第三方 WebDAV 应用访问的 16 位随机应用密码。');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await saveCloudConfig({
        account,
        password, // 留空且原密码存在时保持原密码
        server,
        dir,
        autoSync,
      });
      if (res && res.passwordSet) setPasswordSet(true);
      showNotice('success', '配置已保存' + (autoSync ? '，每次数据变更后会自动同步到云端。' : '。'));
    } catch (err) {
      showNotice('error', `保存失败：${err && err.message ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    // 用输入框里的当前内容去测，不必先保存；密码留空才沿用已保存的那份
    if (!account.trim() || (!password.trim() && !passwordSet)) {
      showNotice('error', '请填写账号与用于授权第三方 WebDAV 应用访问的 16 位随机应用密码，或先「保存配置」再测试。');
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await testCloudConnection({ account, password, server, dir });
    showNotice(res.ok ? 'success' : 'error', res.ok ? '连接成功，认证有效。' : (res.error || '连接失败。'));
    setBusy(false);
  };

  const doPush = async (force = false) => {
    setBusy(true);
    setNotice(null);
    setConflict(null);
    const res = await pushNow(force);
    if (res.conflict) setConflict({ side: 'push', localAt: res.localAt, remoteAt: res.remoteAt });
    if (!res.ok && res.error) showNotice(res.conflict ? 'warn' : 'error', res.error);
    if (res.ok && res.unchanged) showNotice('success', '本地与云端已是同一份数据，无需上传。');
    if (res.ok && res.cloudBackupFile) showNotice('warn', `上传完成。云端原有一份比本机更新的数据，已备份为同目录下的 ${res.cloudBackupFile}。`);
    setBusy(false);
  };

  const doPull = async (force = false) => {
    setBusy(true);
    setNotice(null);
    setConflict(null);
    const res = await pullNow(force);
    if (res.conflict) setConflict({ side: 'pull', localAt: res.localAt, remoteAt: res.remoteAt });
    if (!res.ok && res.error) showNotice(res.conflict ? 'warn' : 'error', res.error);
    if (res && res.empty) showNotice('success', '云端暂无数据文件。');
    if (res.ok && res.unchanged) showNotice('success', '本地与云端已是同一份数据，无需下载。');
    if (res.ok && res.snapshot) {
      // 先把云端数据写进 localStorage，再立即刷新界面：
      // 若停留在旧界面上继续编辑，旧内存数据会回写并抵掉刚下载的内容
      applySnapshot(res.snapshot);
      const text = res.backupPath
        ? `下载完成。本机原有一份较新的数据，已备份为 ${res.backupPath}，可在「从备份恢复」里取回。`
        : '下载完成，云端数据已写入本机。';
      try {
        localStorage.setItem(PENDING_NOTICE_KEY, JSON.stringify({ kind: res.backupPath ? 'warn' : 'success', text }));
      } catch {
        /* 提示写入失败不影响数据 */
      }
      window.location.reload();
      return;
    }
    setBusy(false);
  };

  const noticeColor = notice
    ? notice.kind === 'error' ? RED : notice.kind === 'success' ? GREEN : '#d29922'
    : null;

  return (
    <Box sx={{ mt: 2 }}>
      {/* ===== 本机持久化 ===== */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <StorageIcon fontSize="small" sx={{ color: GREEN, mt: 0.3 }} />
        <Box>
          <Typography sx={{ color: TEXT, fontWeight: 600, fontSize: '0.9rem' }}>
            本机文件保存
          </Typography>
          <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.3, lineHeight: 1.6 }}>
            桌面版数据自动保存为应用目录下的本地 JSON 文件，卸载应用时也可手动备份该文件。
          </Typography>
        </Box>
      </Box>

      {/* ===== WebDAV 云同步 ===== */}
      <Box sx={{ mt: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <CloudSyncIcon fontSize="small" sx={{ color: BLUE, mt: 0.3 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: TEXT, fontWeight: 600, fontSize: '0.9rem' }}>
            WebDAV 同步
          </Typography>
          <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.3, mb: 1.5, lineHeight: 1.6 }}>
            将数据同步到自己的 WebDAV 空间。
          </Typography>

          <TextField
            size="small"
            label="WebDAV 服务器（可选，默认坚果云）"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://dav.jianguoyun.com/dav/（坚果云）"
            fullWidth
            sx={{ mb: 1.5, input: { color: TEXT }, '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { borderColor: BORDER }, '& .MuiInputLabel-root': { color: FAINT } }}
          />
          <TextField
            size="small"
            label="WebDAV 账号"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            fullWidth
            sx={{ mb: 1.5, input: { color: TEXT }, '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { borderColor: BORDER }, '& .MuiInputLabel-root': { color: FAINT } }}
          />
          <TextField
            size="small"
            label="应用密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordSet
              ? '已保存（留空保持不变）'
              : '请输入用于授权第三方 WebDAV 应用访问的 16 位随机应用密码'}
            fullWidth
            sx={{ mb: 1.5, input: { color: TEXT }, '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { borderColor: BORDER }, '& .MuiInputLabel-root': { color: FAINT } }}
          />
          <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: -0.5, mb: 1.5, lineHeight: 1.6 }}>
            这里填的是用于授权第三方 WebDAV 应用访问的 16 位随机应用密码，不是坚果云登录密码。
            获取路径：坚果云网页 → 头像 → 账户信息 → 安全选项 → 添加应用（如 DayMark）→ 生成后整串粘贴。
          </Typography>
          <TextField
            size="small"
            label="远程目录（可选）"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            fullWidth
            sx={{ mb: 1.5, input: { color: TEXT }, '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { borderColor: BORDER }, '& .MuiInputLabel-root': { color: FAINT } }}
          />

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="contained"
              size="small"
              disabled={busy}
              onClick={handleSave}
              sx={{ bgcolor: BLUE, '&:hover': { bgcolor: '#388bfd' }, fontWeight: 600 }}
            >
              保存配置
            </Button>
            <Button
              variant="outlined"
              size="small"
              disabled={busy}
              onClick={handleTest}
              sx={{ color: TEXT, borderColor: BORDER, '&:hover': { borderColor: '#8b949e' }, fontWeight: 600 }}
            >
              测试连接
            </Button>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  sx={{
                    '& .MuiSwitch-switchBase.Mui-checked': { color: BLUE },
                    '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: BLUE },
                  }}
                />
              }
              label={<Typography variant="caption" sx={{ color: MUTED }}>自动同步</Typography>}
              sx={{ m: 0 }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 1, lineHeight: 1.6 }}>
            「测试连接」用的就是上面当前填写的内容，不必先保存；「立即上传 / 立即下载」与自动同步用的是已保存的配置，改完记得点「保存配置」。
          </Typography>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 2 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudUploadIcon />}
              disabled={busy}
              onClick={() => doPush(false)}
              sx={{ color: TEXT, borderColor: BORDER, '&:hover': { borderColor: '#8b949e' }, fontWeight: 600 }}
            >
              立即上传
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudDownloadIcon />}
              disabled={busy}
              onClick={() => doPull(false)}
              sx={{ color: TEXT, borderColor: BORDER, '&:hover': { borderColor: '#8b949e' }, fontWeight: 600 }}
            >
              立即下载
            </Button>
          </Box>

          {conflict && (
            <Box sx={{ mt: 1.5, p: 1.2, borderRadius: '16px', border: `1px solid #d2992255`, bgcolor: 'rgba(210, 153, 34, 0.08)' }}>
              <Typography variant="caption" sx={{ color: '#d29922', display: 'block', lineHeight: 1.6 }}>
                数据冲突：本机 {conflict.localAt || '未知时间'} ／ 云端 {conflict.remoteAt || '未知时间'}
              </Typography>
              <Button
                size="small"
                disabled={busy}
                onClick={() => (conflict.side === 'pull' ? doPull(true) : doPush(true))}
                sx={{ mt: 0.8, color: '#d29922', fontWeight: 600, textTransform: 'none' }}
              >
                {conflict.side === 'pull'
                  ? '仍然下载（以云端为准，本机这份会自动备份）'
                  : '仍然上传（以本机为准，云端那份会自动备份）'}
              </Button>
            </Box>
          )}

          {busy && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
              <CircularProgress size={14} sx={{ color: BLUE }} />
              <Typography variant="caption" sx={{ color: MUTED }}>处理中…</Typography>
            </Box>
          )}

          {status.status === 'ok' && !notice && (
            <Typography variant="caption" sx={{ color: GREEN, display: 'block', mt: 1.5 }}>
              同步状态：{status.message}
            </Typography>
          )}
          {status.status === 'error' && !notice && (
            <Typography variant="caption" sx={{ color: RED, display: 'block', mt: 1.5 }}>
              同步状态：{status.message}
            </Typography>
          )}

          {notice && (
            <Box
              sx={{
                mt: 1.5,
                p: 1.2,
                borderRadius: '16px',
                bgcolor: notice.kind === 'error'
                  ? 'rgba(248, 81, 73, 0.1)'
                  : notice.kind === 'success'
                    ? 'rgba(63, 185, 80, 0.1)'
                    : 'rgba(210, 153, 34, 0.1)',
                border: `1px solid ${noticeColor}55`,
                color: noticeColor,
                fontSize: '0.8rem',
                lineHeight: 1.6,
                wordBreak: 'break-word',
              }}
            >
              {notice.text}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default function SmartSyncPanel() {
  const [env] = useState(() => isElectron());
  if (!env) return null;
  return <SyncPanel />;
}