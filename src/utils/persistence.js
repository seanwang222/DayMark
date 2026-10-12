/**
 * 持久化桥：Electron 环境下把 localStorage 快照落盘 + 接收 WebDAV 同步事件
 *
 * 职责边界：本模块只决定「何时写文件」，localStorage 的键名与读写全部在 utils/storage。
 * 依赖方向是 persistence → storage，storage 反过来不 import 本模块。
 *
 * 关键时序：ready 之前（启动回填尚未完成）一律不落盘。
 * 否则模块导入期的 migrateIfNeeded、或慢速 IPC 与 300ms 防抖竞跑时，
 * 会用尚未回填的 localStorage 生成快照盖掉本机文件，把「空数据」推上云端。
 *
 * 非 Electron（普通浏览器 / Node 回归测试）环境下所有函数为安全 no-op。
 */
import { onDataWritten, buildSnapshot, applySnapshot } from './storage';

const FLUSH_DEBOUNCE_MS = 300;

let flushTimer = null;
let ready = false;

export function isElectron() {
  return typeof window !== 'undefined' && !!window.daymark && !!window.daymark.saveSnapshot;
}

function isElectronRuntime() {
  // 同步落盘通道是本次加固新增的，缺失即视为旧版桥不可用，退回只有防抖落盘的行为
  return isElectron() && typeof window.daymark.saveSnapshotSync === 'function';
}

/** 立即同步落盘当前数据：关窗 / 主动 reload 前兜住防抖窗口内的最后一笔改动 */
export function flushNow() {
  if (!isElectronRuntime() || !ready) return false;
  clearTimeout(flushTimer);
  flushTimer = null;
  try {
    return window.daymark.saveSnapshotSync(buildSnapshot()) === true;
  } catch (e) {
    console.error('snapshot sync flush failed:', e);
    return false;
  }
}

/** 数据写库后调用：防抖 300ms 全量落盘（未就绪 / 非桌面版为 no-op） */
function scheduleFlush() {
  if (!isElectronRuntime() || !ready) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // saveSnapshot 走 invoke，返回 Promise：主进程写盘失败会被 reject 或返回 false，
    // 不接住就是完全静默失败，用户以为已保存
    Promise.resolve()
      .then(() => window.daymark.saveSnapshot(buildSnapshot()))
      .then((ok) => {
        if (ok === false) console.error('snapshot flush rejected by main process');
      })
      .catch((e) => console.error('snapshot flush failed:', e));
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * 应用启动时调用：加载本机快照回填 localStorage，之后才放开落盘，并挂载主进程事件
 * @returns {Promise<object|null>} 本机快照（首次运行无文件时为 null）
 */
export async function initPersistence() {
  if (!isElectron()) return null;

  const snap = await window.daymark.loadSnapshot().catch(() => null);
  if (snap) applySnapshot(snap);
  ready = true;

  // 收到云端拉取的快照：应用并整页刷新（HashRouter 会保留当前路径）
  window.daymark.onApplySnapshot((remote) => {
    if (applySnapshot(remote)) window.location.reload();
  });

  // 关窗 / 刷新 / beforeunload 时同步兜一次盘，避免防抖窗口内的改动被静默丢弃
  window.addEventListener('beforeunload', () => {
    flushNow();
  });

  return snap;
}

/* 同步状态（SyncPanel 自己订阅，这里只提供便捷封装） */
export function onSyncStatus(cb) {
  if (!isElectron()) return () => {};
  return window.daymark.onSyncStatus(cb);
}

/* ==================== 提供给 UI（SyncPanel）的云端配置接口 ==================== */

export function getCloudConfig() {
  if (!isElectron()) return Promise.resolve(null);
  return window.daymark.getConfig().catch(() => null);
}

export function saveCloudConfig(cfg) {
  if (!isElectron()) return Promise.resolve(null);
  return window.daymark.setConfig(cfg).catch(() => null);
}

export function testCloudConnection() {
  if (!isElectron()) return Promise.resolve({ ok: false, error: '当前非桌面环境' });
  return window.daymark.testConnection().catch((e) => ({ ok: false, error: String(e) }));
}

export function pushNow(force) {
  if (!isElectron()) return Promise.resolve({ ok: false, error: '当前非桌面环境' });
  return window.daymark.pushNow(!!force).catch((e) => ({ ok: false, error: String(e) }));
}

export function pullNow(force) {
  if (!isElectron()) return Promise.resolve({ ok: false, error: '当前非桌面环境' });
  return window.daymark.pullNow(!!force).catch((e) => ({ ok: false, error: String(e) }));
}

/* 数据层每次写库都通知到这里；ready 之前 scheduleFlush 自己会丢弃 */
onDataWritten(() => scheduleFlush());
