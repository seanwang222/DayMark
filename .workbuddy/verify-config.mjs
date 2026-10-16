/**
 * 回归验证：桌面版配置文件读写（electron/config.js）
 * 用法: node .workbuddy/verify-config.mjs（需经 esbuild 打包，见 package.json 的 verify:config）
 *
 * 起因：界面有「WebDAV 服务器」输入框并提交 server，但主进程的 readConfig /
 * set-config 都没有这个字段，导致地址被静默丢弃、恒用坚果云默认服务。
 * 配置读写抽成纯 Node 模块后，这条链路可以脱离 Electron 直接验证。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const {
  DEFAULT_CONFIG, configFile, readConfig, writeConfig, mergeConfigInput, hasCloudConfig, publicConfig,
} = await import('../electron/config.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daymark-config-'));

try {
  /* ---- 1. 无配置文件时回落默认值，且 server 键必须存在 ---- */
  const empty = readConfig(dir);
  assert.deepEqual(empty, DEFAULT_CONFIG, '空目录应返回完整默认配置');
  assert.ok('server' in empty, '默认配置必须含 server 键，否则界面无从回填');
  assert.equal(empty.server, '', 'server 默认为空 = 使用内置坚果云地址');
  assert.equal(empty.dir, 'DayMark');
  console.log('OK: 无配置时回落默认值且字段齐全');

  /* ---- 2. 界面提交 → 落盘 → 读回：server 必须接通 ---- */
  const saved = mergeConfigInput(empty, {
    account: 'user@example.com',
    password: 'app-password',
    server: 'https://dav.example.com/dav/',
    dir: 'MyDayMark',
    autoSync: true,
  });
  writeConfig(dir, saved);
  const back = readConfig(dir);
  assert.equal(back.server, 'https://dav.example.com/dav/', '自定义 WebDAV 地址必须原样落盘读回');
  assert.equal(back.account, 'user@example.com');
  assert.equal(back.password, 'app-password');
  assert.equal(back.dir, 'MyDayMark');
  assert.equal(back.autoSync, true);
  console.log('OK: server / account / dir / autoSync 往返一致');

  /* ---- 3. makeClient 用的就是这份 server：URL 拼装要跟着地址走 ---- */
  const { Jianguoyun, SNAPSHOT_FILENAME } = await import('../electron/webdav.js');
  const client = new Jianguoyun({
    account: back.account,
    password: back.password,
    dir: back.dir,
    baseUrl: back.server || undefined,
  });
  assert.equal(client.url, `https://dav.example.com/dav/MyDayMark/${SNAPSHOT_FILENAME}`, '同步地址应指向自定义服务器');
  assert.equal(client.dirUrl, 'https://dav.example.com/dav/MyDayMark');
  assert.equal(client.urlFor('daymark-snapshot.cloud-x.json'), 'https://dav.example.com/dav/MyDayMark/daymark-snapshot.cloud-x.json');
  // 留空时回到默认坚果云
  const dflt = new Jianguoyun({ account: 'a', password: 'b', dir: 'DayMark' });
  assert.ok(dflt.url.startsWith('https://dav.jianguoyun.com/dav/'), 'server 留空应使用默认地址');
  console.log('OK: 自定义 server 贯通到 WebDAV URL');

  /* ---- 4. 密码留空表示保持不变；非空则覆盖 ---- */
  assert.equal(mergeConfigInput(back, { account: back.account, password: '   ', dir: back.dir }).password, 'app-password', '留空密码不应清掉已存密码');
  assert.equal(mergeConfigInput(back, { password: 'new-password' }).password, 'new-password');
  console.log('OK: 密码留空保持原值、非空覆盖');

  /* ---- 5. 归一化：dir 空白回落默认、各项 trim ---- */
  assert.equal(mergeConfigInput(back, { dir: '' }).dir, 'DayMark');
  assert.equal(mergeConfigInput(back, { dir: '  A  ' }).dir, 'A');
  assert.equal(mergeConfigInput(back, { account: '  u@e.com  ' }).account, 'u@e.com');
  assert.equal(mergeConfigInput(back, {}).autoSync, false, '未提交 autoSync 即视为关闭');
  console.log('OK: 界面输入被 trim 且非法值回落');

  /* ---- 6. syncedAt 不接受界面输入、只由主进程维护 ---- */
  const withSyncedAt = { ...back, syncedAt: '2026-10-08T00:00:00.000Z' };
  assert.equal(mergeConfigInput(withSyncedAt, { syncedAt: '伪造值' }).syncedAt, '2026-10-08T00:00:00.000Z', '界面不应能改写 syncedAt');
  console.log('OK: syncedAt 由主进程独占');

  /* ---- 7. 回给渲染进程的副本不含密码 ---- */
  const pub = publicConfig(back);
  assert.equal(pub.password, '', '回显配置不得包含密码');
  assert.equal(pub.passwordSet, true);
  assert.equal(pub.server, back.server, '回显需带 server，否则界面输入框重启后是空的');
  assert.equal(back.password, 'app-password', 'publicConfig 不应改动原对象');
  console.log('OK: 配置回显抹掉密码但保留 server');

  /* ---- 8. 原子写：不留 .tmp；坏 JSON 回落默认而非崩溃 ---- */
  assert.ok(!fs.existsSync(`${configFile(dir)}.tmp`), '原子写不应残留 .tmp');
  const rawBefore = fs.readFileSync(configFile(dir), 'utf8');
  writeConfig(dir, { ...back, dir: 'Other' });
  assert.notEqual(fs.readFileSync(configFile(dir), 'utf8'), rawBefore, '写入应生效');
  fs.writeFileSync(configFile(dir), '{"account":"a",', 'utf8'); // 半截 JSON
  assert.deepEqual(readConfig(dir), DEFAULT_CONFIG, '坏配置应安全回落默认值');
  console.log('OK: 原子写无残留、坏 JSON 安全回落');

  /* ---- 9. 云端配置可用性判定 ---- */
  assert.equal(hasCloudConfig(back), true);
  assert.equal(hasCloudConfig({ ...back, password: '' }), false, '缺密码不可同步');
  assert.equal(hasCloudConfig({ ...back, account: '' }), false, '缺账号不可同步');
  assert.equal(hasCloudConfig(null), false);
  console.log('OK: hasCloudConfig 判定正确');

  /* ---- 10. 应用密码加密存储（主进程注入 safeStorage，这里用可逆假 codec） ---- */
  const cdir = path.join(dir, 'secure');
  fs.mkdirSync(cdir, { recursive: true });
  let codecOn = true;
  const codec = {
    available: () => codecOn,
    encrypt: (s) => Buffer.from(`enc:${s}`, 'utf8').toString('base64'),
    decrypt: (b64) => {
      const s = Buffer.from(String(b64), 'base64').toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('不是本 codec 产出的密文');
      return s.slice(4);
    },
  };
  const cfgWithPlain = { ...DEFAULT_CONFIG, account: 'user@example.com', password: 's3cret-app-pass', dir: 'DayMark' };

  writeConfig(cdir, cfgWithPlain, codec);
  const cipherText = fs.readFileSync(configFile(cdir), 'utf8');
  assert.ok(!cipherText.includes('s3cret-app-pass'), `配置文件里不应出现明文密码: ${cipherText}`);
  const stored = JSON.parse(cipherText);
  assert.equal(stored.password, '', '加密可用时明文键应留空');
  assert.ok(stored.passwordEnc && stored.passwordEnc !== 'enc:s3cret-app-pass', 'passwordEnc 应是 codec 产出的密文');
  assert.equal(readConfig(cdir, codec).password, 's3cret-app-pass', '同一 codec 应解回原密码');
  assert.equal(hasCloudConfig(readConfig(cdir, codec)), true, '解密后应判定为已配置');
  console.log('OK: 密码以密文落盘、读回自动解密');

  // 没有 codec 时拿不到明文（而不是把密文当密码送去同步）
  assert.equal(readConfig(cdir).password, '', '无 codec 不应返回任何密码');
  assert.equal(hasCloudConfig(readConfig(cdir)), false, '无 codec 时应视为未配置');
  // 密文解不开（换机 / 换系统账户）→ 视为未配置，而不是崩溃或带乱码去同步
  fs.writeFileSync(configFile(cdir), JSON.stringify({ ...stored, passwordEnc: 'bm90LWEtY2lwaGVy' }), 'utf8');
  assert.equal(readConfig(cdir, codec).password, '', '解密失败应回落为空');
  assert.equal(publicConfig(readConfig(cdir, codec)).passwordSet, false, '解密失败时 passwordSet 应为 false');
  console.log('OK: 无 codec / 解密失败都安全地视为未配置');

  // 旧版明文配置：读得到，且下次写入自动迁移为密文
  fs.writeFileSync(configFile(cdir), JSON.stringify({ ...cfgWithPlain }), 'utf8');
  const legacy = readConfig(cdir, codec);
  assert.equal(legacy.password, 's3cret-app-pass', '应兼容旧版明文配置');
  writeConfig(cdir, legacy, codec);
  assert.ok(!fs.readFileSync(configFile(cdir), 'utf8').includes('s3cret-app-pass'), '迁移后不应再留明文');
  assert.equal(readConfig(cdir, codec).password, 's3cret-app-pass', '迁移后仍应读回原密码');
  console.log('OK: 旧明文配置在下次写入时自动迁移为密文');

  // 只是关掉自动同步（内存里没有新明文）时，盘上密文不能被抹掉；此时 codec 恰好不可用
  writeConfig(cdir, { ...legacy, password: '', autoSync: false }, { ...codec, available: () => false });
  const kept = JSON.parse(fs.readFileSync(configFile(cdir), 'utf8'));
  assert.equal(kept.autoSync, false);
  assert.ok(kept.passwordEnc, '无明文可写时应保留盘上密文');
  assert.equal(kept.password || '', '', '保留密文时不应写入明文');
  assert.equal(readConfig(cdir, codec).password, 's3cret-app-pass', '保留的密文应仍可解回');

  // 同样的"本次没有新明文"场景，但 codec 可用 —— 老实现走的是加密分支，
  // 会把 passwordEnc 直接写成空串，密码就此消失，之后每次同步都只能拿到 401
  writeConfig(cdir, { ...legacy, password: '', syncedAt: '2026-10-17 00:00:00' }, codec);
  const keptOn = JSON.parse(fs.readFileSync(configFile(cdir), 'utf8'));
  assert.ok(keptOn.passwordEnc, 'codec 可用且明文为空时同样要保留盘上密文');
  assert.equal(keptOn.password || '', '', '保留密文时不应写入明文');
  assert.equal(keptOn.syncedAt, '2026-10-17 00:00:00', '其它字段应照常落盘');
  assert.equal(readConfig(cdir, codec).password, 's3cret-app-pass', '保留下来的密文仍应解回原密码');
  console.log('OK: 明文为空时即使加密可用也不抹掉密文（这正是"每次都 401"的成因之一）');

  // 盘上只剩旧版明文、本次又不带明文 → 顺手迁成密文，而不是把密码丢掉
  fs.writeFileSync(configFile(cdir), JSON.stringify({ ...cfgWithPlain }), 'utf8');
  writeConfig(cdir, { ...cfgWithPlain, password: '', autoSync: true }, codec);
  const migrated = JSON.parse(fs.readFileSync(configFile(cdir), 'utf8'));
  assert.ok(migrated.passwordEnc, '旧明文应被迁成密文而不是随空密码一起消失');
  assert.equal(migrated.password || '', '', '迁移后不应再留明文');
  assert.ok(!fs.readFileSync(configFile(cdir), 'utf8').includes('s3cret-app-pass'), '迁移后的文件里不应有明文密码');
  assert.equal(migrated.autoSync, true, '本次提交的其它字段应生效');
  assert.equal(readConfig(cdir, codec).password, 's3cret-app-pass', '迁移后仍能解回原密码');
  console.log('OK: 旧明文 + 本次空明文 → 自动迁成密文并保持原密码');

  // 密文 + 用户重新输入的明文：以新明文为准覆盖密文
  writeConfig(cdir, { ...legacy, password: 'new-pass' }, codec);
  assert.equal(readConfig(cdir, codec).password, 'new-pass', '新密码应覆盖旧密文');
  assert.ok(!fs.readFileSync(configFile(cdir), 'utf8').includes('new-pass'), '新密码同样不能明文落盘');
  console.log('OK: 更新 syncedAt 不丢密文、重填密码以新值覆盖');

  // codec 不可用（如无 keyring 的桌面环境）→ 退回明文存储，功能不断
  writeConfig(cdir, { ...legacy, password: 'plain-only' }, { ...codec, available: () => false });
  const fallback = JSON.parse(fs.readFileSync(configFile(cdir), 'utf8'));
  assert.equal(fallback.password, 'plain-only', '无加密能力时应仍能保存密码');
  assert.ok(!fallback.passwordEnc, '此时不应写入解不开的密文');
  assert.equal(readConfig(cdir).password, 'plain-only', '明文存储应能直接读回');
  console.log('OK: 加密不可用时安全退回明文，不丢配置');

  // 回给渲染进程的副本既无明文也无密文
  const pub2 = publicConfig(readConfig(cdir, codecOn ? codec : undefined));
  assert.equal(pub2.password, '');
  assert.ok(!('passwordEnc' in pub2), '回显副本不得包含密文字段');
  console.log('OK: 配置回显不含任何形态的密码');

  console.log('\n全部验证通过 ✅');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
