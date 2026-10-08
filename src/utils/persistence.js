/**
 * 持久化桥：Electron 环境下把 localStorage 快照落盘 + WebDAV 云同步
 *
 * 职责：
 * - 启动时把本机快照文件回填到 localStorage（Electron 下 localStorage 只是缓存）
 * - 每次数据写库后防抖 300ms 全量落盘到 userData/daymark-snapshot.json
 * - 订阅主进程同步状态、接收云端拉取结果并应用到界面
 *
 * 非 Electron（普通浏览器 / Node 回归测试）环境下所有函数为安全 no-op，
 * 不影响现有 dev / file:// 单文件版 / verify 脚本的行为。
 */

const KEYS = {
  CHECKIN_ITEMS: 'daily_checkin_items',
  CHECKIN_RECORDS: 'daily_checkin_records',
  TODOS: 'daily_todos',
  SCHEMA_VERSION: 'daily_schema_version',
};

const SCHEMA_VERSION = 2;

let flushTimer = null;
let applySnapshotHandler = null;
let syncStatusHandler = null;

function isElectron() {
  return typeof window !== 'undefined' && !!window.daymark && !!window.daymark.saveSnapshot;
}

function readJS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function buildSnapshot() {
  return {
    schemaVersion: readJS(KEYS.SCHEMA_VERSION, SCHEMA_VERSION),
    exportDate: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: readJS(KEYS.CHECKIN_ITEMS, []),
    records: readJS(KEYS.CHECKIN_RECORDS, {}),
    todos: readJS(KEYS.TODOS, []),
  };
}

/** 把一份快照直写进 localStorage（不触发落盘回写），供启动加载与云端拉取使用 */
export function applySnapshot(snap) {
  if (!snap || !snap.exportDate) return false;
  try {
    localStorage.setItem(KEYS.CHECKIN_ITEMS, JSON.stringify(Array.isArray(snap.items) ? snap.items : []));
    localStorage.setItem(KEYS.CHECKIN_RECORDS, JSON.stringify(snap.records && typeof snap.records === 'object' ? snap.records : {}));
    localStorage.setItem(KEYS.TODOS, JSON.stringify(Array.isArray(snap.todos) ? snap.todos : []));
    localStorage.setItem(KEYS.SCHEMA_VERSION, String(snap.schemaVersion || SCHEMA_VERSION));
    return true;
  } catch (e) {
    console.error('applySnapshot failed:', e);
    return false;
  }
}

/**
 * 应用启动时调用：加载本机快照回填 localStorage，并挂载主进程事件
 * @returns {Promise<object|null>} 本机快照（首次运行无文件时为 null）
 */
export async function initPersistence() {
  if (!isElectron()) return null;

  const snap = await window.daymark.loadSnapshot().catch(() => null);
  if (snap && snap.exportDate) {
    applySnapshot(snap);
  }

  // 收到云端拉取的快照：应用并整页刷新（HashRouter 会保留当前路径）
  applySnapshotHandler = window.daymark.onApplySnapshot((remote) => {
    if (applySnapshot(remote)) {
      window.location.reload();
    }
  });
  syncStatusHandler = window.daymark.onSyncStatus(() => {
    /* SyncPanel 自己订阅同步状态 */
  });

  return snap;
}

/** 数据写库后调用：防抖 300ms 全量落盘（非 Electron 下 no-op） */
export function scheduleFlush() {
  if (!isElectron()) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      window.daymark.saveSnapshot(buildSnapshot());
    } catch (e) {
      console.error('snapshot flush failed:', e);
    }
  }, 300);
}

/* ==================== 提供给 UI（SyncPanel）的接口 ==================== */

export { isElectron };

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

export function onSyncStatus(cb) {
  if (!isElectron()) return () => {};
  return window.daymark.onSyncStatus(cb);
}