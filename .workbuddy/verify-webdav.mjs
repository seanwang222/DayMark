/**
 * 临时验证脚本：坚果云 WebDAV 同步核心
 * 用法: node .workbuddy/verify-webdav.mjs（需经 esbuild 打包，见 package.json 的 verify:webdav）
 *
 * 用本地 mock HTTP 服务模拟坚果云 dav.jianguoyun.com 的 MKCOL / PUT / GET 语义，
 * 验证 ensureDir / push / pull / 401 / 404 / 非法 JSON 防护 / resolveLatest 冲突判定。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Jianguoyun, resolveLatest, planPull, planPush, backupFileName, pruneBackups, webdavRequest, buildRemoteUrl, encodeWebdavPath, describeAuthFailure, APP_PASSWORD_NAME, SNAPSHOT_FILENAME, BACKUP_NAME_RE } from '../electron/webdav.js';

/* ==================== mock 坚果云服务 ==================== */

const USER = 'user@example.com';
const PASS = 'app-password';
const goodAuth = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

/** pathname -> 文件内容 */
const cloud = new Map();
let mockServer;

function startMockServer() {
  return new Promise((resolvePromise) => {
    mockServer = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = url.pathname;

      // 模拟网络半开：收下请求但永不返回，用于验证超时而不是无限挂起
      if (p.startsWith('/dav/Hang/')) {
        req.resume();
        return;
      }

      const send = (code, body) => {
        res.statusCode = code;
        if (body !== undefined) {
          res.setHeader('Content-Type', 'application/json');
          res.end(typeof body === 'string' ? body : JSON.stringify(body));
        } else {
          res.end();
        }
      };

      if (auth !== goodAuth) {
        // 真实服务器在 401 上会带 WWW-Authenticate，用它来区分"地址对不对"与"密码对不对"
        res.setHeader('WWW-Authenticate', 'Basic realm="nutstore"');
        send(401, { error: 'unauthorized' });
        return;
      }

      if (req.method === 'MKCOL') {
        if (cloud.has(p)) return send(405, { error: 'already exists' });
        cloud.set(p, '');
        return send(201);
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          cloud.set(p, body);
          send(201, { ok: 1 });
        });
        return;
      }

      if (req.method === 'GET') {
        if (!cloud.has(p)) return send(404, { error: 'not found' });
        send(200, cloud.get(p));
        return;
      }

      send(405, { error: 'method not allowed' });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      resolvePromise(mockServer.address().port);
    });
  });
}

/* ==================== resolveLatest 冲突判定 ==================== */

function t() {
  const now = new Date();
  const later = new Date(now.getTime() + 1000).toISOString();
  const earlier = new Date(now.getTime() - 1000).toISOString();
  return { later, earlier };
}

{
  const { later, earlier } = t();
  assert.equal(resolveLatest({ updatedAt: later }, { updatedAt: earlier }), 'local', 'updatedAt 新者应为 local');
  assert.equal(resolveLatest({ updatedAt: earlier }, { updatedAt: later }), 'remote', 'updatedAt 新者应为 remote');
  assert.equal(resolveLatest({ updatedAt: later }, { updatedAt: later }), 'equal', '相同应判 equal');
  // 无 updatedAt 时回退 exportDate
  assert.equal(resolveLatest({ updatedAt: '', exportDate: later }, { updatedAt: '', exportDate: earlier }), 'local');
  // 某侧为空
  assert.equal(resolveLatest(null, { exportDate: later }), 'remote', '本地为空应取远端');
  assert.equal(resolveLatest({ exportDate: later }, null), 'local', '远端为空应取本地');
  console.log('OK: resolveLatest 冲突判定正确');
}

/* ==================== planPull / planPush 防覆盖决策 ==================== */

{
  const { later, earlier } = t();
  const newer = { updatedAt: later };
  const older = { updatedAt: earlier };

  // 下载：云端更新 → 直接应用（本机那份本就较旧，无需备份）
  assert.equal(planPull({ local: older, remote: newer }), 'apply');
  // 下载：本机更新 → 默认拒绝，只有 force 才先备份再覆盖
  assert.equal(planPull({ local: newer, remote: older }), 'conflict', '本机更新时默认应拒绝下载');
  assert.equal(planPull({ local: newer, remote: older, force: true }), 'backup-then-apply');
  // 下载：同一份 → 什么都不做
  assert.equal(planPull({ local: newer, remote: newer }), 'noop');
  // 下载：云端为空 / 本机为空
  assert.equal(planPull({ local: newer, remote: null }), 'empty-cloud');
  assert.equal(planPull({ local: null, remote: newer }), 'apply', '本机为空（换机恢复）应直接下载');

  // 上传：本地更新 → 直接推送
  assert.equal(planPush({ local: newer, remote: older }), 'push');
  // 上传：云端更新 → 默认拒绝，force 才先备份云端
  assert.equal(planPush({ local: older, remote: newer }), 'conflict', '云端更新时默认应拒绝上传');
  assert.equal(planPush({ local: older, remote: newer, force: true }), 'backup-then-push');
  assert.equal(planPush({ local: newer, remote: newer }), 'noop');
  assert.equal(planPush({ local: null, remote: null }), 'no-local');
  assert.equal(planPush({ local: newer, remote: null }), 'push', '云端为空应可直接上传');
  console.log('OK: planPull / planPush 只在会丢较新数据时要求确认');
}

/* ==================== 备份文件名与数量收敛 ==================== */

{
  const name = backupFileName('conflict', '2026-10-08T17:30:45.123Z');
  assert.equal(name, 'daymark-snapshot.conflict-2026-10-08T17-30-45.json', `文件名不应含冒号等非法字符，实际: ${name}`);
  assert.match(name, BACKUP_NAME_RE, '备份名应能被清理规则识别');
  assert.equal(backupFileName('cloud', '2026-10-08T17:30:45.123Z'), 'daymark-snapshot.cloud-2026-10-08T17-30-45.json');
  assert.ok(!SNAPSHOT_FILENAME.match(BACKUP_NAME_RE), '主快照文件绝不能被清理规则命中');
  console.log('OK: 备份文件名合法且与主快照可区分');
}

/* ==================== 目录名的 URL 段编码 ==================== */

{
  const BASE = 'https://dav.jianguoyun.com/dav/';
  // 裸空格会截断 HTTP 请求行，裸 # 之后的部分被当成片段 → 莫名的 404 / 传到别处
  assert.equal(
    buildRemoteUrl({ baseUrl: BASE, dir: 'My DayMark' }),
    'https://dav.jianguoyun.com/dav/My%20DayMark/daymark-snapshot.json',
    '空格应被编码',
  );
  const odd = new Jianguoyun({ account: USER, password: PASS, dir: '备份 2026/Q1#1', baseUrl: BASE });
  assert.ok(!odd.url.includes(' '), `URL 里不应有裸空格: ${odd.url}`);
  assert.ok(!odd.url.includes('#'), `URL 里不应有裸井号: ${odd.url}`);
  assert.equal(
    decodeURIComponent(odd.url.slice(BASE.length)),
    '备份 2026/Q1#1/daymark-snapshot.json',
    '编码后应能还原成原目录路径',
  );
  assert.equal(decodeURIComponent(odd.dirUrl.slice(BASE.length)), '备份 2026/Q1#1');
  // 备份文件与主快照同目录，且同样不受裸字符影响
  const bk = odd.urlFor('daymark-snapshot.cloud-2026-10-08T17-30-45.json');
  assert.ok(bk.startsWith(odd.dirUrl + '/'), '备份文件应与主快照同目录');
  assert.equal(encodeWebdavPath('/DayMark/'), 'DayMark', '首尾斜杠应被去掉');
  assert.equal(new Jianguoyun({ account: 'a', password: 'b', dir: 'DayMark' }).url, BASE + 'DayMark/daymark-snapshot.json', '常规目录名不应被改变');
  console.log('OK: 目录名按 URL 段编码，空格 / # / 中文不再拼坏地址');
}

function pruneFixture() {
  const dir = path.join(os.tmpdir(), `daymark-prune-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  // 12 份备份 + 1 份主快照；mtime 依次递增
  for (let i = 1; i <= 12; i += 1) {
    const f = path.join(dir, `daymark-snapshot.conflict-2026-10-0${i}T00-00-0${i}.json`);
    fs.writeFileSync(f, '{}', 'utf8');
    const when = new Date(Date.now() + i * 1000);
    fs.utimesSync(f, when, when);
  }
  fs.writeFileSync(path.join(dir, 'daymark-snapshot.json'), '{}', 'utf8');
  return dir;
}

{
  const dir = pruneFixture();
  const removed = pruneBackups(dir, { keep: 5 });
  assert.equal(removed.length, 7, `应删掉最旧的 7 份，实际 ${removed.length}`);
  const left = fs.readdirSync(dir);
  assert.equal(left.length, 6, '应剩下 5 份备份 + 主快照');
  assert.ok(left.includes('daymark-snapshot.json'), '主快照必须保留');
  assert.ok(!left.includes('daymark-snapshot.conflict-2026-10-07T00-00-07.json'), '第 7 旧的应被删除');
  assert.ok(left.includes('daymark-snapshot.conflict-2026-10-08T00-00-08.json'), '最近 5 份应全部保留');
  assert.deepEqual(pruneBackups(path.join(os.tmpdir(), 'daymark-no-such-dir')), [], '目录不可读时应安全返回空');
  left.forEach((n) => fs.unlinkSync(path.join(dir, n)));
  fs.rmdirSync(dir);
  console.log('OK: pruneBackups 只留最近若干份且不动主快照');
}

/* ==================== WebDAV 客户端 ==================== */

async function run() {
  const port = await startMockServer();
  const baseUrl = `http://127.0.0.1:${port}/dav/`;
  const client = new Jianguoyun({ account: USER, password: PASS, dir: 'DayMark', baseUrl });

  // 1. ensureDir + push + pull 往返
  const snap = { schemaVersion: 2, exportDate: t().later, updatedAt: t().later, items: [], records: { '2026-09-01': {} }, todos: [] };
  await client.ensureDir();
  await client.push(JSON.stringify(snap));
  const pulled = await client.pull();
  assert.equal(pulled.status, 200);
  assert.deepEqual(pulled.data, snap, 'pull 应返回与 push 一致的数据');
  console.log('OK: ensureDir / push / pull 往返一致');

  // 2. 二次 push（覆盖）后仍一致
  const snap2 = { ...snap, todos: [{ id: 'x', title: '测试' }] };
  await client.push(JSON.stringify(snap2));
  const pulled2 = await client.pull();
  assert.deepEqual(pulled2.data, snap2, '重复 push 应覆盖云端文件');
  console.log('OK: 重复 push 覆盖云端内容');

  // 3. 认证失败
  const badClient = new Jianguoyun({ account: USER, password: 'wrong', dir: 'DayMark', baseUrl });
  try {
    await badClient.pull();
    assert.fail('错误密码不应成功');
  } catch (err) {
    assert.match(err.message, /认证失败/, `401 应报认证失败，实际: ${err.message}`);
    // 诊断三要素：账号（打码）+ 密码位数 + 服务器质询，让用户自己就能看出填错哪一格
    assert.match(err.message, /u\*\*\*@example\.com/, `401 应给出打码后的账号，实际: ${err.message}`);
    assert.match(err.message, /密码长度 5 位/, `应如实报出密码位数，实际: ${err.message}`);
    assert.match(err.message, /固定 16 位/, `位数不对应点出应用密码固定 16 位，实际: ${err.message}`);
    assert.match(err.message, /没粘贴完整或填成了登录密码/, `应给出可执行的纠正动作，实际: ${err.message}`);
    assert.match(err.message, /realm="nutstore"/, `401 应带上服务器质询，实际: ${err.message}`);
    assert.ok(!err.message.includes('wrong'), '401 提示绝不能回显密码明文');
  }

  // 3b. 长度就是 16 位却被拒 → 不能再说"不像应用密码"，应转向"账号错或应用密码已被删除/失效"
  const shapedClient = new Jianguoyun({ account: USER, password: 'A1b2C3d4E5f6G7h8', dir: 'DayMark', baseUrl });
  try {
    await shapedClient.pull();
    assert.fail('错误密码不应成功');
  } catch (err) {
    assert.match(err.message, /长度 16 位，与.*一致/, `16 位密码应走"长度一致"分支，实际: ${err.message}`);
    assert.match(err.message, /已被删除/, `应提示可能是应用密码被删除，实际: ${err.message}`);
    assert.ok(!err.message.includes('不像'), '16 位密码绝不该被判定为"不像应用密码"');
    assert.ok(!err.message.includes('A1b2C3d4E5f6G7h8'), '提示绝不能回显 16 位应用密码');
  }

  // 3c. 16 位但含 - _ 等非字母数字字符：应用密码的字符集不限于字母数字，按长度判断（曾误判过）
  const dashed = describeAuthFailure({ account: USER, password: 'Ab3-5678_901.234' });
  assert.equal(dashed.includes('固定 16 位'), false, '16 位含特殊字符不能被判成位数不对');
  assert.match(dashed, /长度 16 位，与.*一致/, `含特殊字符的 16 位密码应判为位数一致，实际: ${dashed}`);
  assert.ok(!dashed.includes('Ab3-5678_901.234'), '同样不回显密码');

  // 3d. describeAuthFailure 是纯函数：空密码、非默认地址、非邮箱账号各自成句
  const emptyPw = describeAuthFailure({ account: 'a@b.com', password: '', server: 'https://dav.jianguoyun.com/dav/' });
  assert.match(emptyPw, /本机没有存到密码/);
  assert.match(emptyPw, new RegExp(APP_PASSWORD_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '空密码要给统一称谓');
  assert.match(emptyPw, /地址：默认坚果云/);
  const customServer = describeAuthFailure({ account: 'a@b.com', password: 'x'.repeat(16), server: 'http://192.168.1.9/dav/' });
  assert.match(customServer, /不是默认坚果云地址/);
  const notEmail = describeAuthFailure({ account: 'myname', password: 'y'.repeat(16) });
  assert.match(notEmail, /不是邮箱格式/);

  // 3e. 称谓只许一处定义、两处字面量必须一致：渲染层无法 import 本文件
  const panelSrc = fs.readFileSync(new URL('../src/components/SyncPanel.jsx', import.meta.url), 'utf8');
  assert.ok(panelSrc.includes(APP_PASSWORD_NAME), `SyncPanel 必须逐字使用统一称谓「${APP_PASSWORD_NAME}」`);
  const mainSrc = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.ok(mainSrc.includes('APP_PASSWORD_NAME'), '主进程的未配置提示应引用同一常量，不要各写一份');
  console.log('OK: 认证失败（401）正确报错，给出打码账号 / 密码位数 / 服务器质询，称谓与渲染层一致且从不回显密码');

  // 4. 文件名错误 → 404 → data null
  const emptyClient = new Jianguoyun({ account: USER, password: PASS, dir: 'NotFoundDir', baseUrl });
  const missing = await emptyClient.pull();
  assert.equal(missing.status, 404);
  assert.equal(missing.data, null, '404 应返回 data null');
  console.log('OK: 云端无文件（404）返回空');

  // 5. 云端文件为非法 JSON → 拒绝导入防覆盖
  const brokenClient = new Jianguoyun({ account: USER, password: PASS, dir: 'Broken', baseUrl });
  const put = await fetch(`${baseUrl}Broken/${SNAPSHOT_FILENAME}`, {
    method: 'PUT',
    headers: { Authorization: goodAuth, 'Content-Type': 'application/json' },
    body: 'not-json-at-all{',
  });
  assert.equal(put.status, 201);
  try {
    await brokenClient.pull();
    assert.fail('非法 JSON 不应通过');
  } catch (err) {
    assert.match(err.message, /不是合法的 DayMark 数据文件/, `应拒绝非法 JSON，实际: ${err.message}`);
  }
  console.log('OK: 云端非法 JSON 被拒绝导入');

  // 6. 本地文件读取
  const tmp = path.join(os.tmpdir(), `daymark-snap-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(snap2), 'utf8');
  const local = Jianguoyun.readLocal(tmp);
  assert.deepEqual(local, snap2, 'readLocal 应读回本地文件');
  assert.equal(Jianguoyun.readLocal(path.join(os.tmpdir(), 'no-such-file.json')), null, '文件不存在应返回 null');
  fs.unlinkSync(tmp);
  console.log('OK: 本地快照文件读写正确');

  // 7. 强制覆盖云端前，云端较旧那份能原样留档且不影响主快照
  const bkClient = new Jianguoyun({ account: USER, password: PASS, dir: 'Backup', baseUrl });
  const staleRemote = { schemaVersion: 2, updatedAt: t().earlier, items: [], records: {}, todos: [{ id: 'a' }] };
  await bkClient.push(JSON.stringify(staleRemote));
  const bkName = backupFileName('cloud', t().later);
  await bkClient.pushBackup(bkName, JSON.stringify(staleRemote));
  const backed = await fetch(bkClient.urlFor(bkName), { headers: { Authorization: goodAuth } });
  assert.equal(backed.status, 200, '备份文件应可在云端读回');
  assert.deepEqual(JSON.parse(await backed.text()), staleRemote, '备份内容应与被覆盖的云端数据一致');
  const afterMain = await bkClient.pull();
  assert.deepEqual(afterMain.data, staleRemote, '写备份不应改动主快照文件');
  console.log('OK: 云端备份写入独立文件，主快照不受影响');

  // 8. 请求超时：服务端收下请求却永不返回时，应在设定时间内报错，而不是无限挂起
  const hangClient = new Jianguoyun({ account: USER, password: PASS, dir: 'Hang', baseUrl });
  const t0 = Date.now();
  try {
    await webdavRequest({ url: hangClient.url, method: 'GET', auth: hangClient.auth, timeoutMs: 300 });
    assert.fail('挂起的服务端不应成功');
  } catch (err) {
    assert.match(err.message, /超时/, `超时应给出可读错误，实际: ${err.message}`);
  }
  assert.ok(Date.now() - t0 < 5000, `超时应尽快返回，实际耗时 ${Date.now() - t0}ms`);
  console.log('OK: 无响应的服务端请求按超时中断并给出可读错误');

  mockServer.close();

  console.log('\n全部验证通过 ✅');
}

run().catch((err) => {
  console.error('验证失败:', err);
  try { mockServer && mockServer.close(); } catch {}
  process.exit(1);
});