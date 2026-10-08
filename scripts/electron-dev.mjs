/**
 * Electron 开发启动：先起 vite dev server（127.0.0.1:3000），
 * 端口就绪后以 DAYMARK_DEV=1 启动 Electron 加载开发页面。
 * 任一进程退出即全部结束。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronPath = require('electron'); // electron 包导出可执行文件路径

function waitDevServer(url, times = 80) {
  return new Promise((resolvePromise) => {
    let tries = 0;
    const ping = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolvePromise(true);
      });
      req.on('error', () => {
        tries += 1;
        if (tries > times) return resolvePromise(false);
        setTimeout(ping, 500);
      });
    };
    ping();
  });
}

const vite = spawn(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
});

const up = await waitDevServer('http://127.0.0.1:3000');
if (!up) {
  console.error('[electron:dev] vite dev server 启动失败');
  vite.kill();
  process.exit(1);
}

const app = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DAYMARK_DEV: '1' },
});

const teardown = (code = 0) => {
  try { vite.kill(); } catch {}
  process.exit(code);
};
app.on('exit', (code) => teardown(code || 0));
process.on('SIGINT', () => {
  try { app.kill(); } catch {}
  teardown(0);
});