/**
 * DayMark Electron 主进程
 * 职责：
 * - 创建窗口，加载 dev server 或生产构建
 * - 本地快照落盘（userData/daymark-snapshot.json）
 * - 坚果云 WebDAV 同步（手动 + 自动）
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Jianguoyun, SNAPSHOT_FILENAME, planPull, planPush, backupFileName, pruneBackups } from './webdav.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.DAYMARK_DEV;
const isSmoke = !!process.env.DAYMARK_SMOKE;
const isShot = !!process.env.DAYMARK_SHOT;

let mainWindow = null;
let autoPushTimer = null;
let syncState = {
  status: 'idle', // idle | syncing | ok | error
  message: '',
  lastSync: '',
};

/* ==================== 文件路径与读写 ==================== */

function snapshotFile() {
  return path.join(app.getPath('userData'), SNAPSHOT_FILENAME);
}

function configFile() {
  return path.join(app.getPath('userData'), 'daymark-config.json');
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    return {
      account: cfg.account || '',
      password: cfg.password || '',
      dir: cfg.dir || 'DayMark',
      autoSync: !!cfg.autoSync,
      syncedAt: cfg.syncedAt || '',
    };
  } catch {
    return { account: '', password: '', dir: 'DayMark', autoSync: false, syncedAt: '' };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8');
}

function hasCloudConfig(cfg) {
  return !!(cfg && cfg.account && cfg.password);
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

/** 把较新的那份数据同步到双方（自动同步用；较旧一方被覆盖前不涉及，故无需备份） */
async function runSync(cfg) {
  const client = makeClient(cfg);
  const local = Jianguoyun.readLocal(snapshotFile());
  const remote = (await client.pull()).data; // 404 时为 null

  const pullPlan = planPull({ local, remote });
  if (pullPlan === 'apply') {
    // 远端更新 → 落盘并通知界面应用（自动同步不带 force，不会出现 backup-then-apply）
    fs.writeFileSync(snapshotFile(), JSON.stringify(remote, null, 2), 'utf8');
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
    try {
      await runSync(cfg);
      cfg.syncedAt = new Date().toISOString();
      writeConfig(cfg);
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
    const raw = JSON.stringify(data, null, 2);
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(snapshotFile(), raw, 'utf8');
    const cfg = readConfig();
    if (hasCloudConfig(cfg) && cfg.autoSync) scheduleAutoPush(cfg);
    return true;
  });

  ipcMain.handle('daymark:get-config', () => {
    const cfg = readConfig();
    // 密码不回显明文，只标记是否已设置
    return { ...cfg, passwordSet: !!cfg.password, password: '' };
  });

  ipcMain.handle('daymark:set-config', (_e, input) => {
    const cur = readConfig();
    const next = {
      account: (input.account || '').trim(),
      password: typeof input.password === 'string' && input.password.trim() !== '' ? input.password.trim() : cur.password,
      dir: (input.dir || 'DayMark').trim() || 'DayMark',
      autoSync: !!input.autoSync,
      syncedAt: cur.syncedAt,
    };
    writeConfig(next);
    return { ...next, passwordSet: !!next.password, password: '' };
  });

  ipcMain.handle('daymark:test-connection', async () => {
    const cfg = readConfig();
    if (!hasCloudConfig(cfg)) return { ok: false, error: '请先填写账号与应用密码' };
    try {
      const client = makeClient(cfg);
      await client.pull();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('daymark:push-now', async (_e, force) => {
    const cfg = readConfig();
    if (!hasCloudConfig(cfg)) return { ok: false, error: '请先配置 WebDAV 账号与应用密码' };
    setSyncState({ status: 'syncing', message: '正在上传…' });
    try {
      const local = Jianguoyun.readLocal(snapshotFile());
      if (!local) return { ok: false, error: '本地还没有数据文件' };
      const client = makeClient(cfg);
      const remote = (await client.pull()).data;

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
        cfg.syncedAt = new Date().toISOString();
        writeConfig(cfg);
        setSyncState({ status: 'ok', message: '本地与云端已是同一份数据', lastSync: cfg.syncedAt });
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
      cfg.syncedAt = new Date().toISOString();
      writeConfig(cfg);
      setSyncState({ status: 'ok', message: '上传成功', lastSync: cfg.syncedAt });
      return { ok: true, cloudBackupFile };
    } catch (err) {
      setSyncState({ status: 'error', message: `上传失败：${err.message}` });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('daymark:pull-now', async (_e, force) => {
    const cfg = readConfig();
    if (!hasCloudConfig(cfg)) return { ok: false, error: '请先配置 WebDAV 账号与应用密码' };
    setSyncState({ status: 'syncing', message: '正在下载…' });
    try {
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
        cfg.syncedAt = new Date().toISOString();
        writeConfig(cfg);
        setSyncState({ status: 'ok', message: '本地与云端已是同一份数据', lastSync: cfg.syncedAt });
        return { ok: true, unchanged: true };
      }

      let backupPath = null;
      if (plan === 'backup-then-apply') {
        // 强制下载：本机那份较新的数据先留档，再被云端覆盖
        backupPath = writeLocalBackup(local);
      }
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(snapshotFile(), JSON.stringify(remote, null, 2), 'utf8');
      cfg.syncedAt = new Date().toISOString();
      writeConfig(cfg);
      setSyncState({ status: 'ok', message: backupPath ? '已备份本机数据并下载云端数据' : '下载成功', lastSync: cfg.syncedAt });
      // 手动下载不直接刷新界面：把快照交回渲染进程，由它写入 localStorage 后再提示用户刷新，
      // 以免 reload 打断阅读备份路径提示，也避免旧内存数据回写覆盖刚下载的文件
      return { ok: true, backupPath, snapshot: remote };
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
      try {
        const probe = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const hasApi = !!(window.daymark && window.daymark.saveSnapshot);
            let ipc = 'n/a';
            if (hasApi) {
              const snap = await window.daymark.loadSnapshot();
              ipc = snap === null || snap === undefined ? 'ok(empty)' : 'ok(data)';
              await window.daymark.saveSnapshot({ schemaVersion: 2, exportDate: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [], records: {}, todos: [] });
            }
            return JSON.stringify({ hasApi, ipc });
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

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});