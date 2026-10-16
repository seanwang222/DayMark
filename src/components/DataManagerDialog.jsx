import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  Divider,
  IconButton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  LinearProgress,
  Collapse,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import {
  exportAllCSV,
  exportBackupJSON,
  readBackupFile,
  restoreData,
  getDataOverview,
  getArchiveInventory,
  groupArchiveByMonth,
} from '../utils/backup';
import {
  unarchiveCheckinItem,
  unarchiveTodo,
  deleteCheckinItem,
  deleteTodo,
} from '../utils/storage';
import ConfirmDialog from './ConfirmDialog';
import { flushNow } from '../utils/persistence';
import SmartSyncPanel from './SyncPanel';

/**
 * 数据管理弹窗
 * 提供全量导出（CSV / JSON）与数据恢复（合并 / 覆盖）
 */

const CARD_BG = '#161b22';
const BORDER = '#30363d';
const TEXT = '#c9d1d9';
const MUTED = '#8b949e';
const FAINT = '#6e7681';
const BLUE = '#1f6feb';
const GREEN = '#3fb950';
const RED = '#f85149';

function ArchiveRow({ badge, primary, meta, onRestore, onDelete }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.9,
        borderBottom: `1px solid ${BORDER}`,
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, minWidth: 0 }}>
          {badge && (
            <Typography
              variant="caption"
              sx={{
                color: MUTED,
                border: `1px solid ${BORDER}`,
                borderRadius: '6px',
                px: 0.5,
                py: 0.1,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {badge}
            </Typography>
          )}
          <Typography
            variant="body2"
            sx={{ color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {primary}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.2 }}>
          {meta}
        </Typography>
      </Box>
      <Tooltip title="恢复显示">
        <IconButton size="small" onClick={onRestore} sx={{ color: MUTED, '&:hover': { color: GREEN } }}>
          <UnarchiveIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="彻底删除">
        <IconButton size="small" onClick={onDelete} sx={{ color: MUTED, '&:hover': { color: RED } }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** 归档行右侧的说明文字：打卡项看历史条数，待办看完成状态与行动清单进度 */
function archiveMeta(entry) {
  return entry.kind === 'item'
    ? `归档于 ${entry.archivedAt || '—'} · 历史打卡 ${entry.recordCount} 条${entry.lastRecordDate ? `（最近 ${entry.lastRecordDate}）` : ''} · 创建于 ${String(entry.createdAt || '—').slice(0, 10)}`
    : [
      `归档于 ${entry.archivedAt || '—'}`,
      entry.completed ? '已完成' : '未完成',
      entry.phaseTotal ? `行动 ${entry.phaseDone}/${entry.phaseTotal}` : '',
      entry.dueDate ? `截止 ${entry.dueDate}` : '',
      `创建于 ${String(entry.createdAt || '—').slice(0, 10)}`,
    ].filter(Boolean).join(' · ');
}

/**
 * 归档子界面里的一个月分节：整月默认折起，只看得到月份和条数，
 * 这样归档再多也不会把子界面拉成一长串。
 */
function ArchiveMonthSection({ month, expanded, onToggle, onRestore, onDelete }) {
  return (
    <Box
      sx={{
        bgcolor: '#0d1117',
        border: `1px solid ${BORDER}`,
        borderRadius: '16px',
        overflow: 'hidden',
      }}
    >
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1.1,
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': { bgcolor: 'rgba(177,186,196,0.06)' },
        }}
      >
        <Typography sx={{ color: TEXT, fontWeight: 700, fontSize: '0.86rem' }}>
          {month.label}
        </Typography>
        <Typography variant="caption" sx={{ color: FAINT }}>
          {month.entries.length} 条
        </Typography>
        <Box sx={{ flex: 1 }} />
        {expanded
          ? <ExpandLessIcon fontSize="small" sx={{ color: MUTED }} />
          : <ExpandMoreIcon fontSize="small" sx={{ color: MUTED }} />}
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 0.5, borderTop: `1px solid ${BORDER}` }}>
          {month.entries.map((entry) => (
            <ArchiveRow
              key={`${entry.kind}-${entry.id}`}
              badge={entry.kind === 'item' ? '打卡' : '待办'}
              primary={entry.kind === 'item' ? entry.name : entry.title}
              meta={archiveMeta(entry)}
              onRestore={() => onRestore(entry)}
              onDelete={() => onDelete(entry)}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function countRecords(records) {
  let n = 0;
  Object.keys(records || {}).forEach((date) => {
    Object.keys((records && records[date]) || {}).forEach(() => { n += 1; });
  });
  return n;
}

function StatCard({ label, value, sub }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        bgcolor: '#0d1117',
        border: `1px solid ${BORDER}`,
        borderRadius: '16px',
        p: 1.5,
      }}
    >
      <Typography variant="caption" sx={{ color: MUTED, display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ color: TEXT, fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.5 }}>
        {sub || ' '}
      </Typography>
    </Box>
  );
}

function Notice({ kind, children }) {
  const color = kind === 'error' ? RED : kind === 'success' ? GREEN : '#d29922';
  const bg = kind === 'error'
    ? 'rgba(248, 81, 73, 0.1)'
    : kind === 'success'
      ? 'rgba(63, 185, 80, 0.1)'
      : 'rgba(210, 153, 34, 0.1)';
  return (
    <Box
      sx={{
        mt: 1.5,
        p: 1.2,
        borderRadius: '16px',
        bgcolor: bg,
        border: `1px solid ${color}55`,
        color,
        fontSize: '0.8rem',
        lineHeight: 1.6,
        wordBreak: 'break-word',
      }}
    >
      {children}
    </Box>
  );
}

function DataManagerDialog({ open, onClose }) {
  const fileRef = useRef(null);

  const [overview, setOverview] = useState(() => getDataOverview());
  const [archive, setArchive] = useState(() => getArchiveInventory());
  const [mode, setMode] = useState('merge');
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  // 归档区里的恢复 / 彻底删除：改动已经写进 localStorage，但背后的页面要刷新才看得见
  const [dataTouched, setDataTouched] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  // 归档条目可能很多，一律收在「数据管理 → 归档」这个子界面里按月展开，不铺在主界面下方
  const [archiveView, setArchiveView] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState({});

  // 每次打开重新读取概览并清空临时状态
  useEffect(() => {
    if (open) {
      setOverview(getDataOverview());
      setArchive(getArchiveInventory());
      setMode('merge');
      setParsed(null);
      setFileName('');
      setError('');
      setResult(null);
      setBusy(false);
      setDataTouched(false);
      setPendingDelete(null);
      setArchiveView(false);
      setExpandedMonths({});
    }
  }, [open]);

  const refreshArchive = () => {
    setArchive(getArchiveInventory());
    setOverview(getDataOverview());
  };

  /** 恢复一条归档：只清掉归档标记，历史数据一直在原处，所以恢复后连旧账一起回来 */
  const handleRestoreArchived = (kind, entry) => {
    if (kind === 'item') unarchiveCheckinItem(entry.id);
    else unarchiveTodo(entry.id);
    setDataTouched(true);
    refreshArchive();
  };

  const askDeleteArchived = (kind, entry) => {
    setPendingDelete({
      kind,
      id: entry.id,
      message: kind === 'item'
        ? `确定彻底删除已归档的打卡项目「${entry.name}」吗？它的 ${entry.recordCount} 条打卡记录将一并删除，且无法恢复。`
        : `确定彻底删除已归档的待办「${entry.title}」吗？其 STAR 描述、行动清单与复盘将一并删除，且无法恢复。`,
    });
  };

  const confirmDeleteArchived = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'item') deleteCheckinItem(pendingDelete.id);
    else deleteTodo(pendingDelete.id);
    setPendingDelete(null);
    setDataTouched(true);
    refreshArchive();
  };

  const pending = parsed
    ? {
        items: parsed.items.length,
        records: countRecords(parsed.records),
        todos: parsed.todos.length,
      }
    : null;

  const handlePickFile = () => {
    if (fileRef.current) fileRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选择同一个文件
    if (!file) return;

    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await readBackupFile(file);
      const empty = !data.items.length && !countRecords(data.records) && !data.todos.length;
      if (empty) {
        setError('文件中没有找到可导入的记录，请确认选择的是本应用导出的文件。');
        setParsed(null);
        setFileName('');
      } else {
        setParsed(data);
        setFileName(file.name);
      }
    } catch (err) {
      setError(err && err.message ? err.message : '文件解析失败。');
      setParsed(null);
      setFileName('');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = () => {
    if (!parsed) return;
    if (mode === 'replace') {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        '「覆盖」会先清空本机现有的全部打卡与待办数据，只保留本次导入的内容。\n\n确定继续吗？',
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      const stats = restoreData(parsed, mode);
      setResult(stats);
      setParsed(null);
      setFileName('');
      setOverview(getDataOverview());
      setArchive(getArchiveInventory());
    } catch (err) {
      setError(err && err.message ? err.message : '恢复失败。');
    } finally {
      setBusy(false);
    }
  };

  // 备份恢复或归档区的改动都只进了 localStorage，关闭时刷新页面，让所有组件重新读取最新数据
  const handleClose = () => {
    if (result || dataTouched) {
      // 这两条路径都走防抖落盘，reload 会掐掉未触发的定时器 —— 先同步写一次文件
      flushNow();
      window.location.reload();
      return;
    }
    onClose();
  };

  const dayRange = overview.dayCount
    ? `${overview.firstDay} ~ ${overview.lastDay}`
    : '暂无记录';

  const archiveTotal = archive.items.length + archive.todos.length;
  const archiveMonths = groupArchiveByMonth(archive);

  const openArchiveView = () => {
    setArchiveView(true);
    // 进去只看最近一个月，其余折起，避免子界面一长串
    if (archiveMonths.length) setExpandedMonths({ [archiveMonths[0].month]: true });
  };

  const toggleMonth = (month) => {
    setExpandedMonths((prev) => ({ ...prev, [month]: !prev[month] }));
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          bgcolor: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: '16px',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ color: TEXT, display: 'flex', alignItems: 'center', gap: 1 }}>
        {archiveView ? (
          <>
            <IconButton
              size="small"
              onClick={() => setArchiveView(false)}
              sx={{ color: MUTED, ml: -0.5 }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <ArchiveIcon fontSize="small" sx={{ color: MUTED }} />
            归档
          </>
        ) : (
          <>
            <SettingsBackupRestoreIcon fontSize="small" sx={{ color: MUTED }} />
            数据管理
          </>
        )}
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: BORDER }}>
        {archiveView ? (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography sx={{ color: TEXT, fontWeight: 600, fontSize: '0.9rem' }}>
                {archiveTotal} 条归档
              </Typography>
              <Typography variant="caption" sx={{ color: FAINT }}>
                分布在 {archiveMonths.length} 个月
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: FAINT, display: 'block', mb: 1.5 }}>
              归档表示阶段性收尾：打卡项与待办归档后不再出现在界面上，但归档日之前的历史记录照旧参与统计。
              在月份里「恢复」即回到界面（旧账一并回来），「彻底删除」会连打卡记录 / STAR 与复盘一起删掉，无法恢复。
            </Typography>
            {archiveTotal === 0 ? (
              <Typography variant="caption" sx={{ color: '#484f58', display: 'block' }}>
                归档已经清空 —— 点左上角返回。
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {archiveMonths.map((month) => (
                  <ArchiveMonthSection
                    key={month.month || 'unknown'}
                    month={month}
                    expanded={!!expandedMonths[month.month]}
                    onToggle={() => toggleMonth(month.month)}
                    onRestore={(entry) => handleRestoreArchived(entry.kind, entry)}
                    onDelete={(entry) => askDeleteArchived(entry.kind, entry)}
                  />
                ))}
              </Box>
            )}
          </Box>
        ) : (
          <>
            {/* ===== 概览 ===== */}
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <StatCard
                label="打卡项目"
                value={overview.itemCount}
                sub={overview.archivedItemCount ? `项 · 归档 ${overview.archivedItemCount}` : '项'}
              />
              <StatCard
                label="打卡记录"
                value={overview.recordCount}
                sub={`覆盖 ${overview.dayCount} 天`}
              />
              <StatCard
                label="待办事项"
                value={overview.todoCount}
                sub={
                  overview.archivedTodoCount
                    ? `已完成 ${overview.todoDone} · 归档 ${overview.archivedTodoCount}`
                    : `已完成 ${overview.todoDone} 条`
                }
              />
              <StatCard
                label="临时任务"
                value={overview.noteCount}
                sub={`已完成 ${overview.noteDone} 条`}
              />
            </Box>
            <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 1 }}>
              记录日期范围：{dayRange}
              {overview.archivedRecordCount
                ? ` · 其中 ${overview.archivedRecordCount} 条属于已归档的打卡项`
                : ''}
            </Typography>

            <Divider sx={{ my: 2, borderColor: BORDER }} />

            {/* ===== 导出 ===== */}
            <Typography sx={{ color: TEXT, fontWeight: 600, mb: 0.5, fontSize: '0.9rem' }}>
              导出
            </Typography>
            <Typography variant="caption" sx={{ color: FAINT, display: 'block', mb: 1.5 }}>
              CSV 为单文件，含打卡项目、打卡记录、待办事项、临时任务四个区块，已归档的数据同样在内
              （靠「归档日期」列标记），可直接用 Excel 打开；
              JSON 为无损备份，换设备或跨浏览器迁移请用 JSON。
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={exportAllCSV}
                sx={{ bgcolor: BLUE, '&:hover': { bgcolor: '#388bfd' }, fontWeight: 600 }}
              >
                导出全量 CSV
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={exportBackupJSON}
                sx={{
                  color: TEXT,
                  borderColor: BORDER,
                  '&:hover': { borderColor: '#8b949e', bgcolor: 'rgba(177,186,196,0.08)' },
                  fontWeight: 600,
                }}
              >
                导出备份 JSON
              </Button>
            </Box>

            <Divider sx={{ my: 2, borderColor: BORDER }} />

            {/* ===== 恢复 ===== */}
            <Typography sx={{ color: TEXT, fontWeight: 600, mb: 0.5, fontSize: '0.9rem' }}>
              恢复
            </Typography>
            <Typography variant="caption" sx={{ color: FAINT, display: 'block', mb: 1.5 }}>
              支持本应用导出的 CSV 与 JSON 文件。合并只补充本地缺失的数据，不会删除现有内容。
            </Typography>

            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={(_e, v) => v && setMode(v)}
              size="small"
              sx={{
                mb: 1.5,
                display: 'flex',
                '& .MuiToggleButtonGroup-grouped': {
                  flex: 1,
                  borderRadius: '16px !important',
                  border: '1px solid !important',
                  borderColor: `${BORDER} !important`,
                  ml: '0 !important',
                  bgcolor: 'transparent',
                },
                '& .MuiToggleButtonGroup-grouped + .MuiToggleButtonGroup-grouped': {
                  ml: '8px !important',
                },
                '& .MuiToggleButton-root': {
                  color: TEXT,
                  fontWeight: 600,
                  px: 1.5,
                  py: 0.8,
                  '&.Mui-selected': {
                    bgcolor: `${BLUE} !important`,
                    borderColor: `${BLUE} !important`,
                    color: '#ffffff',
                    '&:hover': {
                      bgcolor: '#388bfd !important',
                      borderColor: '#388bfd !important',
                    },
                  },
                  '&:hover': {
                    bgcolor: 'rgba(177,186,196,0.08)',
                  },
                },
              }}
            >
              <ToggleButton value="merge">合并</ToggleButton>
              <ToggleButton value="replace">覆盖</ToggleButton>
            </ToggleButtonGroup>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<UploadIcon />}
                onClick={handlePickFile}
                disabled={busy}
                sx={{
                  flex: '1 0 100%',
                  color: TEXT,
                  borderColor: BORDER,
                  '&:hover': { borderColor: '#8b949e', bgcolor: 'rgba(177,186,196,0.08)' },
                  fontWeight: 600,
                  py: 0.8,
                }}
              >
                选择备份文件
              </Button>
              {parsed && (
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleRestore}
                  disabled={busy}
                  sx={{ bgcolor: GREEN, '&:hover': { bgcolor: '#46c55c' }, fontWeight: 600 }}
                >
                  确认恢复
                </Button>
              )}
            </Box>

            {parsed && pending && (
              <Box
                sx={{
                  mt: 1.5,
                  p: 1.2,
                  borderRadius: '16px',
                  bgcolor: '#0d1117',
                  border: `1px solid ${BORDER}`,
                }}
              >
                <Typography variant="caption" sx={{ color: MUTED, display: 'block', mb: 0.5 }}>
                  待导入：{fileName}
                </Typography>
                <Typography variant="body2" sx={{ color: TEXT }}>
                  打卡项目 {pending.items} 项 · 打卡记录 {pending.records} 条 · 待办 {pending.todos} 条
                </Typography>
                <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.5 }}>
                  {mode === 'merge'
                    ? '合并模式：与本地重复的部分会被跳过，仅补充缺失内容。'
                    : '覆盖模式：先清空本地全部数据，再写入本次导入内容。'}
                </Typography>
                {parsed.warnings && parsed.warnings.length > 0 && (
                  <Typography variant="caption" sx={{ color: '#d29922', display: 'block', mt: 0.5 }}>
                    {parsed.warnings.join(' ')}
                  </Typography>
                )}
              </Box>
            )}

            {busy && <LinearProgress sx={{ mt: 1.5, bgcolor: '#21262d', '& .MuiLinearProgress-bar': { bgcolor: BLUE } }} />}

            {error && <Notice kind="error">{error}</Notice>}

            {result && (
              <Notice kind="success">
                恢复完成：新增打卡项目 {result.items.added} 项（跳过重复 {result.items.kept} 项）、
                打卡记录 {result.records.added} 条（跳过重复 {result.records.skipped} 条）、
                待办 {result.todos.added} 条（跳过重复 {result.todos.skipped} 条）。
                <br />
                点击「关闭」刷新页面后即可看到最新数据。
              </Notice>
            )}

            {/* ===== 归档 ===== */}
            <Divider sx={{ my: 2, borderColor: BORDER }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.5 }}>
              <ArchiveIcon fontSize="small" sx={{ color: MUTED }} />
              <Typography sx={{ color: TEXT, fontWeight: 600, fontSize: '0.9rem' }}>
                归档
              </Typography>
              {archiveTotal > 0 && (
                <Typography variant="caption" sx={{ color: FAINT }}>{archiveTotal} 条</Typography>
              )}
            </Box>
            <Typography variant="caption" sx={{ color: FAINT, display: 'block', mb: 1 }}>
              归档表示阶段性收尾：打卡项与待办归档后不再出现在界面上，但归档日之前的历史记录照旧参与统计。
              归档内容按月份收在子界面里，进去后逐月恢复或删除，不在这里排成长列表。
            </Typography>

            {archiveTotal === 0 ? (
              <Typography variant="caption" sx={{ color: '#484f58', display: 'block' }}>
                还没有归档数据 —— 打卡项与待办卡片右侧都有归档按钮。
              </Typography>
            ) : (
              <Box
                sx={{
                  bgcolor: '#0d1117',
                  border: `1px solid ${BORDER}`,
                  borderRadius: '16px',
                  px: 1.5,
                  py: 1.2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ color: TEXT, fontWeight: 600 }}>
                    共 {archiveTotal} 条归档
                  </Typography>
                  <Typography variant="caption" sx={{ color: FAINT, display: 'block', mt: 0.2 }}>
                    打卡项目 {archive.items.length} 项 · 待办 {archive.todos.length} 条 · 分布在 {archiveMonths.length} 个月
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  endIcon={<ChevronRightIcon fontSize="small" />}
                  onClick={openArchiveView}
                  sx={{
                    color: TEXT,
                    borderColor: BORDER,
                    '&:hover': { borderColor: '#8b949e', bgcolor: 'rgba(177,186,196,0.08)' },
                    fontWeight: 600,
                  }}
                >
                  按月查看
                </Button>
              </Box>
            )}

            {/* ===== 桌面版：本机文件保存 + WebDAV 云同步（浏览器版不显示） ===== */}
            <SmartSyncPanel />
          </>
        )}

        <ConfirmDialog
          open={!!pendingDelete}
          title="彻底删除归档数据"
          message={pendingDelete ? pendingDelete.message : ''}
          onConfirm={confirmDeleteArchived}
          onClose={() => setPendingDelete(null)}
        />
      </DialogContent>

      <DialogActions sx={{ borderColor: BORDER, p: 1.5 }}>
        <Button onClick={handleClose} sx={{ color: MUTED, fontWeight: 600 }}>
          {(result || dataTouched) ? '关闭并刷新' : '关闭'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DataManagerDialog;
