/**
 * DayMark Electron 主进程
 * 职责：
 * - 创建窗口，加载 dev server 或生产构建
 * - 本地快照落盘（userData/daymark-snapshot.json）
 * - 坚果云 WebDAV 同步（手动 + 自动）
 */
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Jianguoyun, SNAPSHOT_FILENAME, APP_PASSWORD_NAME, planPull, planPush, backupFileName, pruneBackups } from './webdav.js';
import { readConfig, writeConfig, mergeConfigInput, hasCloudConfig, publicConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.DAYMARK_DEV;
const isSmoke = !!process.env.DAYMARK_SMOKE;
const isShot = !!process.env.DAYMARK_SHOT;

let mainWindow = null;
let autoPushTimer = null;
let syncBusy = false;
let syncState = {
  status: 'idle', // idle | syncing | ok | error
  message: '',
  lastSync: '',
};

/**
 * 冒烟探测会写入一份空快照。若不隔离 userData，跑一次探测就把本机真实数据文件清空，
 * 而「本地为空」在同步里是被允许的合法状态，一次上传就会把云端也带空。
 */
let smokeDir = null;
if (isSmoke) {
  smokeDir = path.join(app.getPath('temp'), `daymark-smoke-${Date.now()}`);
  fs.mkdirSync(smokeDir, { recursive: true });
  app.setPath('userData', smokeDir);
  app.on('will-quit', () => {
    try {
      fs.rmSync(smokeDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响退出 */
    }
  });
}

/* ==================== 文件路径与读写 ==================== */

function userDataDir() {
  return app.getPath('userData');
}

function snapshotFile() {
  return path.join(userDataDir(), SNAPSHOT_FILENAME);
}

/**
 * 应用密码加解密：交给系统的 DPAPI（Windows 下按当前用户账户绑定）。
 * 不可用时（例如没有 keyring 的 Linux）config.js 会退回明文存储，功能不受影响。
 */
const passwordCodec = () => ({
  available: () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
});

const readCfg = () => readConfig(userDataDir(), passwordCodec());
const writeCfg = (cfg) => writeConfig(userDataDir(), cfg, passwordCodec());

/**
 * 原子写主快照：先落 .tmp 再同卷 rename。
 * 直接 writeFileSync 若中途崩溃/断电会留下半截 JSON，
 * 而 readLocal 把解析失败当作「本机为空」，一次同步就会把这份「空」定损。
 */
function writeSnapshotRaw(snap) {
  const dir = userDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SNAPSHOT_FILENAME);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ==================== 同步状态推送 ==================== */

function setSyncState(partial) {
  syncState = { ...syncState, ...partial };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('daymark:sync-status', syncState);
  }
}

/* ==================== WebDAV 同步 ==================== */

function makeClient(cfg) {
  return new Jianguoyun({
    account: cfg.account,
    password: cfg.password,
    dir: cfg.dir,
    baseUrl: cfg.server || undefined, // 留空则使用默认坚果云地址
  });
}

/** 展示用的时间戳 */
function stamp(s) {
  return (s && (s.updatedAt || s.exportDate)) || '未知时间';
}

/** 覆盖本机数据前，先把当前本地快照另存一份，返回绝对路径 */
function writeLocalBackup(snap) {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName('conflict'));
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), 'utf8');
  pruneBackups(dir);
  return file;
}

/**
 * 同一时刻只允许一个同步流程。
 * 手动推/拉与 5s 自动同步若不互斥，会交错读写同一份快照：
 * 刚 PUT 上去的数据可能被并发的 runSync apply 分支用云端旧副本盖掉。
 */
async function withSyncLock(task) {
  if (syncBusy) throw new Error('已有同步任务在进行，请稍候再试');
  syncBusy = true;
  try {
    return await task();
  } finally {
    syncBusy = false;
  }
}

/** 把较新的那份数据同步到双方（自动同步用；较旧一方被覆盖前不涉及，故无需备份） */
async function runSync(cfg) {
  const client = makeClient(cfg);
  // 顺序要紧：先取云端，再读本机。pull 最长要等 20 秒，这期间用户的改动已经防抖落盘，
  // 若沿用等待前读到的那份快照做决策，就会拿旧数据判成「远端更新」，
  // 然后无备份地盖掉刚写进文件的新数据（withSyncLock 只互斥同步之间，管不到渲染层落盘）。
  const remote = (await client.pull()).data; // 404 时为 null
  const local = Jianguoyun.readLocal(snapshotFile());

  const pullPlan = planPull({ local, remote });
  if (pullPlan === 'apply') {
    // 远端更新 → 落盘并通知界面应用（自动同步不带 force，不会出现 backup-then-apply）
    writeSnapshotRaw(remote);
    setSyncState({ status: 'ok', message: `已从云端下载较新数据（${stamp(remote)}）` });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('daymark:apply-snapshot', remote);
    }
    return;
  }

  const pushPlan = planPush({ local, remote });
  if (pushPlan === 'push') {
    await client.push(JSON.stringify(local));
    setSyncState({ status: 'ok', message: `已上传本地数据到云端（${stamp(local)}）` });
    return;
  }
  if (pushPlan === 'noop') {
    setSyncState({ status: 'ok', message: '本地与云端已是同一份数据' });
    return;
  }
  setSyncState({ status: 'error', message: '本地没有可上传的数据' });
}

function scheduleAutoPush(cfg) {
  clearTimeout(autoPushTimer);
  if (!hasCloudConfig(cfg) || !cfg.autoSync) return;
  autoPushTimer = setTimeout(async () => {
    if (syncBusy) {
      scheduleAutoPush(cfg); // 手动同步还没走完，让位并重新排期
      return;
    }
    try {
      await withSyncLock(() => runSync(cfg));
      // 只更新 syncedAt，且重新读盘：不能用调度时捕获的 cfg 回写，
      // 否则用户在这 5 秒里改的账号/目录/服务器会被旧配置覆写回去
      const cur = readCfg();
      cur.syncedAt = new Date().toISOString();
      writeCfg(cur);
    } catch (err) {
      setSyncState({ status: 'error', message: `自动同步失败：${err.message}` });
    }
  }, 5000);
}

/* ==================== IPC ==================== */

function registerIpc() {
  ipcMain.handle('daymark:load-snapshot', () => Jianguoyun.readLocal(snapshotFile()));

  ipcMain.handle('daymark:save-snapshot', (_e, data) => {
    if (!data || typeof data !== 'object') return false;
    try {
      writeSnapshotRaw(data);
    } catch (err) {
      // 落盘失败必须让界面知道：否则用户以为已保存，实际数据只活在内存里
      setSyncState({ status: 'error', message: `本机保存失败：${err.message}` });
      return false;
    }
    const cfg = readCfg();
    if (hasCloudConfig(cfg) && cfg.autoSync) scheduleAutoPush(cfg);
    return true;
  });

  // 渲染进程 beforeunload 用的同步兜底：300ms 防抖窗口内的最后一笔改动，
  // 关窗/刷新时走这条通道落盘（invoke 是异步的，beforeunload 等不到）
  ipcMain.on('daymark:save-snapshot-sync', (event, data) => {
    if (!data || typeof data !== 'object') {
      event.returnValue = false;
      return;
    }
    try {
      writeSnapshotRaw(data);
      event.returnValue = true;
    } catch (err) {
      setSyncState({ status: 'error', message: `本机保存失败：${err.message}` });
      event.returnValue = false;
    }
  });

  ipcMain.handle('daymark:get-config', () => publicConfig(readCfg()));

  ipcMain.handle('daymark:set-config', (_e, input) => {
    const next = mergeConfigInput(readCfg(), input || {});
    writeCfg(next);
    // 关掉自动同步时取消已排期的推送，否则改完设置仍会再推一次
    if (!next.autoSync) clearTimeout(autoPushTimer);
    return publicConfig(next);
  });

  ipcMain.handle('daymark:test-connection', async () => {
    const cfg = readCfg();
    if (!hasCloudConfig(cfg)) return { ok: false, error: `请先填写账号与${APP_PASSWORD_NAME}` };
    try {
      const client = makeClient(cfg);
      await client.pull();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('daymark:push-now', async (_e, force) => {
    const cfg = readCfg();
    if (!hasCloudConfig(cfg)) return { ok: false, error: `请先配置 WebDAV 账号与${APP_PASSWORD_NAME}` };
    setSyncState({ status: 'syncing', message: '正在上传…' });
    try {
      return await withSyncLock(async () => {
        if (!Jianguoyun.readLocal(snapshotFile())) return { ok: false, error: '本地还没有数据文件' };
        const client = makeClient(cfg);
        const remote = (await client.pull()).data;
        // 等 pull 的这几秒里用户可能又改了数据：重新读一次，别把等待前的旧快照推上云
        const local = Jianguoyun.readLocal(snapshotFile());

        const plan = planPush({ local, remote, force: !!force });
        if (plan === 'conflict') {
          setSyncState({ status: 'error', message: '云端数据比本地更新，已阻止上传以免覆盖云端' });
          return {
            ok: false,
            conflict: true,
            side: 'push',
            localAt: stamp(local),
            remoteAt: stamp(remote),
            error: `云端那份数据（${stamp(remote)}）比本机（${stamp(local)}）更新，直接上传会丢掉云端的改动。建议先「立即下载」。`,
          };
        }
        if (plan === 'noop') {
          const cur = readCfg();
          cur.syncedAt = new Date().toISOString();
          writeCfg(cur);
          setSyncState({ status: 'ok', message: '本地与云端已是同一份数据', lastSync: cur.syncedAt });
          return { ok: true, unchanged: true };
        }
        let cloudBackupFile = null;
        if (plan === 'backup-then-push') {
          // 强制上传：先把云端较新的一份原样留档，再覆盖
          cloudBackupFile = backupFileName('cloud');
          await client.pushBackup(cloudBackupFile, JSON.stringify(remote));
          setSyncState({ status: 'ok', message: `云端较新数据已备份为 ${cloudBackupFile}，正在上传…` });
        }
        await client.push(JSON.stringify(local));
        const cur = readCfg();
        cur.syncedAt = new Date().toISOString();
        writeCfg(cur);
        setSyncState({ status: 'ok', message: '上传成功', lastSync: cur.syncedAt });
        return { ok: true, cloudBackupFile };
      });
    } catch (err) {
      setSyncState({ status: 'error', message: `上传失败：${err.message}` });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('daymark:pull-now', async (_e, force) => {
    const cfg = readCfg();
    if (!hasCloudConfig(cfg)) return { ok: false, error: `请先配置 WebDAV 账号与${APP_PASSWORD_NAME}` };
    setSyncState({ status: 'syncing', message: '正在下载…' });
    try {
      return await withSyncLock(async () => {
        const client = makeClient(cfg);
        const { status, data: remote } = await client.pull();
        if (status === 404) {
          setSyncState({ status: 'ok', message: '云端暂无数据文件' });
          return { ok: true, empty: true };
        }
        const local = Jianguoyun.readLocal(snapshotFile());

        const plan = planPull({ local, remote, force: !!force });
        if (plan === 'conflict') {
          setSyncState({ status: 'error', message: '本地数据比云端更新，已阻止下载以免丢数据' });
          return {
            ok: false,
            conflict: true,
            side: 'pull',
            localAt: stamp(local),
            remoteAt: stamp(remote),
            error: `本机数据（${stamp(local)}）比云端（${stamp(remote)}）更新，直接下载会丢掉本机的改动。若确认以云端为准，请点下方「仍然下载」。`,
          };
        }
        if (plan === 'noop') {
          const cur = readCfg();
          cur.syncedAt = new Date().toISOString();
          writeCfg(cur);
          setSyncState({ status: 'ok', message: '本地与云端已是同一份数据', lastSync: cur.syncedAt });
          return { ok: true, unchanged: true };
        }

        let backupPath = null;
        if (plan === 'backup-then-apply') {
          // 强制下载：本机那份较新的数据先留档，再被云端覆盖
          backupPath = writeLocalBackup(local);
        }
        writeSnapshotRaw(remote);
        const cur = readCfg();
        cur.syncedAt = new Date().toISOString();
        writeCfg(cur);
        setSyncState({ status: 'ok', message: backupPath ? '已备份本机数据并下载云端数据' : '下载成功', lastSync: cur.syncedAt });
        // 手动下载不直接刷新界面：把快照交回渲染进程，由它写入 localStorage 后再提示用户刷新，
        // 以免 reload 打断阅读备份路径提示，也避免旧内存数据回写覆盖刚下载的文件
        return { ok: true, backupPath, snapshot: remote };
      });
    } catch (err) {
      setSyncState({ status: 'error', message: `下载失败：${err.message}` });
      return { ok: false, error: err.message };
    }
  });
}

/* ==================== 窗口 ==================== */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'DayMark',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // 生产版加载打包入内的单文件版（与根目录 index-standalone.html 同构建同内容）
    mainWindow.loadFile(path.join(__dirname, '..', 'index-standalone.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isSmoke) {
    mainWindow.webContents.once('did-finish-load', async () => {
      console.log('[smoke] window loaded OK');
      await new Promise((r) => setTimeout(r, 800));
      try {
        const probe = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const hasApi = !!(window.daymark && window.daymark.saveSnapshot);
            const hasSyncApi = !!(window.daymark && typeof window.daymark.saveSnapshotSync === 'function');
            let ipc = 'n/a';
            let syncIpc = 'n/a';
            let readBack = 'n/a';
            if (hasApi) {
              const snap = await window.daymark.loadSnapshot();
              ipc = snap === null || snap === undefined ? 'ok(empty)' : 'ok(data)';
              const payload = { schemaVersion: 2, exportDate: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [], records: {}, todos: [] };
              await window.daymark.saveSnapshot(payload);
              if (hasSyncApi) {
                syncIpc = window.daymark.saveSnapshotSync(payload) === true ? 'ok' : 'failed';
              }
              // 原子写后必须能原样读回，否则界面刷新就是丢数据
              const got = await window.daymark.loadSnapshot();
              readBack = got && got.schemaVersion === 2 && Array.isArray(got.todos) ? 'ok' : 'FAILED';
            }
            // 渲染进程真正挂载成功，才说明 storage/persistence 的启动时序没出错
            const mounted = !!document.querySelector('#root') && document.querySelectorAll('button').length > 0;
            return JSON.stringify({ hasApi, hasSyncApi, ipc, syncIpc, readBack, mounted });
          })()
        `);
        console.log(`[smoke] preload+ipc probe: ${probe}`);
      } catch (e) {
        console.error('[smoke] probe failed:', e);
      }
      setTimeout(() => app.quit(), 800);
    });
    mainWindow.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error(`[smoke] load failed: ${code} ${desc}`);
      app.exit(1);
    });
  }

  // 截图模式：依次访问三页 + 数据管理弹窗，capturePage 存 PNG 到项目 shots/ 目录
  if (isShot) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const out = path.join(process.cwd(), 'shots');
        fs.mkdirSync(out, { recursive: true });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const capture = async (name) => {
          await sleep(700);
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.join(out, name), image.toPNG());
          console.log(`[shot] saved ${name}`);
        };
        const nav = (hash) => mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`);
        await capture('shot-schedule.png'); // 初始即 #/schedule
        await nav('#/checkin'); await capture('shot-checkin.png');
        await nav('#/todos'); await capture('shot-todos.png');
        // 打开数据管理弹窗（点击底部「数据管理」按钮）
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const btns = [...document.querySelectorAll('button')];
            const b = btns.find((x) => x.textContent.includes('数据管理'));
            if (b) b.click();
            return !!b;
          })()
        `);
        await capture('shot-datamanage.png');
      } catch (e) {
        console.error('[shot] failed:', e);
        app.exit(1);
        return;
      }
      setTimeout(() => app.quit(), 300);
    });
    mainWindow.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error(`[shot] load failed: ${code} ${desc}`);
      app.exit(1);
    });
  }
}

/* ==================== 启动 ==================== */

/**
 * 单实例：两个进程各自维护一份内存数据，又抢写同一个 userData 下的快照文件，
 * 后写入的一方会把先写入的整份盖掉（安装版与便携版共用同一 userData，同样会撞上）。
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});