/**
 * 回归验证：桌面版落盘时序（src/utils/persistence.js + storage 写库通知）
 * 用法: npm run verify:persistence（需经 esbuild 打包，见 package.json）
 *
 * 起因：storage 曾经直接 import persistence 并在每次写库时 scheduleFlush，
 * 于是「模块导入期的迁移」和「启动回填尚未完成」都会去写文件，
 * 轻则把还没回填的空快照盖掉本机数据文件，重则把这份空数据推上云端。
 * 现在依赖方向反转，ready 之前一律不落盘，本套用例把这条时序钉死。
 */
import assert from 'node:assert/strict';

/* ---- mock 浏览器/桌面桥环境 ---- */

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

/** 主进程被调用记录：[['async'|'sync', snapshot], ...] */
const writes = [];
/** 主进程写盘返回值，用于模拟失败 */
let mainOk = true;
const listeners = {};
let reloadCount = 0;

globalThis.window = {
  daymark: {
    saveSnapshot: async (data) => { writes.push(['async', data]); return mainOk; },
    saveSnapshotSync: (data) => { writes.push(['sync', data]); return mainOk; },
    loadSnapshot: async () => storedSnapshot,
    onApplySnapshot: (cb) => { listeners.apply = cb; return () => {}; },
    onSyncStatus: (cb) => { listeners.status = cb; return () => {}; },
    getConfig: async () => ({}),
    setConfig: async () => ({}),
    testConnection: async () => ({ ok: true }),
    pushNow: async () => ({ ok: true }),
    pullNow: async () => ({ ok: true }),
  },
  addEventListener: (type, cb) => { listeners[type] = cb; },
  location: { reload: () => { reloadCount += 1; } },
};

/* 本机文件里已有的一份云端数据（含一条待办），启动时应回填进 localStorage */
const cloudTodo = { id: 't-old', title: '云端已有待办', completed: false, dueDate: '', description: {}, phases: [] };
let storedSnapshot = {
  schemaVersion: 2,
  exportDate: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  items: [{ id: 'i-old', name: '云端已有打卡项' }],
  records: {},
  todos: [cloudTodo],
};

/* 先导入 storage：模块导入期的 migrateIfNeeded 此刻还没有任何订阅者 */
const storage = await import('../src/utils/storage.js');
const { addTodo, getTodos, addCheckinItem, addQuickNote, getAllQuickNotes } = storage;

/* 再导入 persistence：此刻才挂上写库监听 */
const { initPersistence, flushNow } = await import('../src/utils/persistence.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  /* ---- 1. ready 之前（启动回填尚未完成）写库，绝不能落盘 ---- */
  addCheckinItem('回填前的改动');
  addTodo({ title: '回填前的待办', description: {}, priority: 'not_urgent_important' });
  await sleep(500); // 越过 300ms 防抖窗口
  assert.deepEqual(writes, [], `回填完成前不应有任何落盘调用，实际: ${JSON.stringify(writes.map((w) => w[0]))}`);
  console.log('OK: ready 之前的写库不落盘（否则空回填会盖掉本机文件）');

  /* ---- 2. 启动回填：文件内容成为权威，且回填本身不触发落盘 ---- */
  const snap = await initPersistence();
  assert.ok(snap, 'initPersistence 应返回本机快照');
  assert.equal(getTodos().length, 1, '应回填云端那 1 条待办');
  assert.equal(getTodos()[0].id, 't-old');
  assert.deepEqual(writes, [], '回填是直写 localStorage，不应反过来触发一次落盘');
  assert.deepEqual(getAllQuickNotes(), {}, '回填的快照里没有 quickNotes 时应为空（老版本文件）');
  console.log('OK: 启动回填恢复文件数据且自身不触发落盘');

  /* ---- 3. ready 之后写库：防抖合并成一次全量落盘 ---- */
  addTodo({ title: '新增待办A', description: {}, priority: 'not_urgent_important' });
  addTodo({ title: '新增待办B', description: {}, priority: 'not_urgent_important' });
  addTodo({ title: '新增待办C', description: {}, priority: 'not_urgent_important' });
  addQuickNote('2026-10-11', '顺路取快递');
  assert.deepEqual(writes, [], '防抖窗口内不应立刻写文件');
  await sleep(500);
  assert.equal(writes.length, 1, `3 次写库应合并为 1 次落盘，实际 ${writes.length}`);
  const [kind, payload] = writes[0];
  assert.equal(kind, 'async');
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.todos.length, 4, '落盘的应是全量快照（回填 1 条 + 新增 3 条）');
  assert.equal(payload.updatedAt, payload.exportDate, 'updatedAt 必须存在，同步靠它判新旧');
  assert.ok(Array.isArray(payload.items) && typeof payload.records === 'object');
  assert.equal(payload.quickNotes['2026-10-11'][0].text, '顺路取快递', '临时任务必须进快照，否则换机/同步会丢');
  console.log('OK: ready 之后防抖合并，落盘为含 updatedAt 与 quickNotes 的全量快照');

  /* ---- 4. 关窗兜底：beforeunload 走同步通道，且取消未到期的防抖 ---- */
  writes.length = 0;
  addTodo({ title: '关窗前的最后一笔', description: {}, priority: 'not_urgent_important' });
  assert.equal(typeof listeners.beforeunload, 'function', '必须挂载 beforeunload 兜底');
  listeners.beforeunload();
  assert.equal(writes.length, 1, 'beforeunload 应立刻同步落一次盘');
  assert.equal(writes[0][0], 'sync', 'beforeunload 只能用同步通道（invoke 等不到）');
  assert.equal(writes[0][1].todos.length, 5);
  await sleep(500);
  assert.equal(writes.length, 1, '已同步落盘后到期的防抖不该再写第二次');
  console.log('OK: beforeunload 用同步通道兜住防抖窗口内的改动');

  /* ---- 5. 主进程写盘失败必须可见（flushNow 返回 false 而不是假装成功） ---- */
  writes.length = 0;
  mainOk = false;
  assert.equal(flushNow(), false, '主进程返回 false 时 flushNow 应返回 false');
  assert.equal(writes.length, 1);
  mainOk = true;
  assert.equal(flushNow(), true);
  console.log('OK: 落盘失败被如实上报');

  /* ---- 6. 云端推送下来的快照：应用后刷新界面，且不回写文件 ---- */
  writes.length = 0;
  storedSnapshot = {
    schemaVersion: 2,
    exportDate: '2026-10-09T00:00:00.000Z',
    updatedAt: '2026-10-09T00:00:00.000Z',
    items: [],
    records: {},
    todos: [{ id: 't-new', title: '云端下载来的待办', completed: false, description: {}, phases: [] }],
  };
  listeners.apply(storedSnapshot);
  await sleep(500);
  assert.equal(reloadCount, 1, '应用云端快照后应刷新界面');
  assert.equal(getTodos()[0].id, 't-new');
  assert.deepEqual(writes, [], '收到的就是文件内容，不该再落一次盘引发布多余推送');
  assert.deepEqual(getAllQuickNotes(), {}, '快照是整份替换：云端那份没有 quickNotes，本机也不该留');
  console.log('OK: 云端快照应用后刷新，且不产生回写');

  /* ---- 7. 缺少同步通道（旧版桥）时退回安全行为 ---- */
  delete window.daymark.saveSnapshotSync;
  writes.length = 0;
  addTodo({ title: '旧版桥下的改动', description: {}, priority: 'not_urgent_important' });
  await sleep(500);
  assert.equal(flushNow(), false, '没有同步通道时 flushNow 应明确失败而非返回成功');
  assert.deepEqual(writes, [], '旧版桥不启用同步落盘');
  console.log('OK: 桥缺少同步通道时不会误用');

  console.log('\n全部验证通过 ✅');
} finally {
  window.daymark = window.daymark || {};
}
