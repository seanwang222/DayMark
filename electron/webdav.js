/**
 * 坚果云 WebDAV 同步核心（纯 Node，无 Electron 依赖，可独立回归测试）
 *
 * 协议要点（坚果云 dav.jianguoyun.com/dav/）：
 * - 认证：Authorization: Basic base64(注册邮箱:应用密码)
 * - MKCOL 创建目录（已存在返回 405/409）
 * - PUT 上传/覆盖文件，GET 下载
 * - 认证失败 401，文件不存在 404
 *
 * 冲突策略：只在「会丢弃较新一方」时动手，且动手前先落一份备份副本。
 * planPull / planPush 是纯决策函数，返回该执行的动作名，由主进程落地。
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE = 'https://dav.jianguoyun.com/dav/';
const DEFAULT_DIR = 'DayMark';
/** 请求超时：没有超时时，网络半开会让界面永远停在「处理中…」 */
export const REQUEST_TIMEOUT_MS = 20000;
export const SNAPSHOT_FILENAME = 'daymark-snapshot.json';
/** 备份文件名前缀匹配：daymark-snapshot.conflict-*.json（被覆盖的本地）/ .cloud-*.json（被覆盖的云端） */
export const BACKUP_NAME_RE = /^daymark-snapshot\.(conflict|cloud)-[\dT-]+\.json$/;

function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * 逐段编码 WebDAV 路径：坚果云目录名允许空格、#、中文等字符，
 * 不编码会让 URL 变形（空格截断、# 之后被当片段），表现为莫名的 404。
 */
export function encodeWebdavPath(dir) {
  return String(dir)
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s !== '')
    .map(encodeURIComponent)
    .join('/');
}

/**
 * 把本地路径拼成完整的 WebDAV URL
 */
export function buildRemoteUrl({ baseUrl = DEFAULT_BASE, dir = DEFAULT_DIR, fileName = SNAPSHOT_FILENAME }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const d = encodeWebdavPath(dir);
  const name = encodeURIComponent(fileName);
  return d ? `${base}${d}/${name}` : `${base}${name}`;
}

/**
 * 执行一次 WebDAV HTTP 请求
 * @returns {Promise<{status:number, body?:string, text?:string}>}
 */
export async function webdavRequest({ url, method = 'GET', auth, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const headers = { Authorization: `Basic ${b64(`${auth.account}:${auth.password}`)}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`${method} 超时：${Math.round(timeoutMs / 1000)} 秒内未响应，请检查网络或 WebDAV 地址`);
    }
    throw new Error(`网络请求失败：${err && err.message ? err.message : String(err)}`);
  }
  const text = await res.text().catch(() => '');
  return { status: res.status, body: text };
}

/**
 * 解析服务端错误为可读信息
 */
export function describeHttpError(method, status) {
  if (status === 401) return `${method} 认证失败：请检查 WebDAV 账号与应用密码`;
  if (status === 403) return `${method} 权限不足：账号无权写入该路径`;
  if (status === 404) return `${method} 404：云端文件/目录不存在`;
  if (status === 409 || status === 405) return `${method} 409：目标已存在或需先创建目录`;
  if (status === 507) return `${method} 507：云端存储空间不足`;
  return `${method} 失败（HTTP ${status}）`;
}

/**
 * 对比本地与远端快照谁更新（updatedAt 缺失时回退 exportDate）
 * @returns {'local'|'remote'|'equal'}
 */
export function resolveLatest(localSnap, remoteSnap) {
  if (!remoteSnap) return 'local';
  if (!localSnap) return 'remote';
  const t = (s) => s.updatedAt || s.exportDate || '';
  const a = t(localSnap);
  const b = t(remoteSnap);
  if (a === b) return 'equal';
  return a > b ? 'local' : 'remote';
}

/* ==================== 冲突决策 ==================== */

/**
 * 本地与云端数据谁更新时的处理决策（时间戳较旧的一方被覆盖无需备份）
 * @param {{local:object|null, remote:object|null, force?:boolean}} p
 * @returns {'empty-cloud'|'apply'|'noop'|'backup-then-apply'|'conflict'}
 */
export function planPull({ local, remote, force = false }) {
  if (!remote) return 'empty-cloud';
  if (!local) return 'apply';
  const winner = resolveLatest(local, remote);
  if (winner === 'remote') return 'apply'; // 云端更新，本地那份本来就是旧的
  if (winner === 'equal') return 'noop';
  return force ? 'backup-then-apply' : 'conflict';
}

/**
 * @param {{local:object|null, remote:object|null, force?:boolean}} p
 * @returns {'no-local'|'push'|'noop'|'backup-then-push'|'conflict'}
 */
export function planPush({ local, remote, force = false }) {
  if (!local) return 'no-local';
  if (!remote) return 'push';
  const winner = resolveLatest(local, remote);
  if (winner === 'local') return 'push'; // 本地更新，云端那份本来就是旧的
  if (winner === 'equal') return 'noop';
  return force ? 'backup-then-push' : 'conflict';
}

/**
 * 备份文件名：把 ISO 时间里的 : 和 . 换成 -，保证跨平台可写
 * @param {'conflict'|'cloud'} kind conflict=本机被覆盖副本，cloud=云端被覆盖副本
 * @param {string} isoTs
 */
export function backupFileName(kind, isoTs = new Date().toISOString()) {
  const slug = String(isoTs).slice(0, 19).replace(/[:.]/g, '-');
  return `daymark-snapshot.${kind === 'cloud' ? 'cloud' : 'conflict'}-${slug}.json`;
}

/**
 * 只保留最近 keep 份备份，其余删除（主快照文件不在匹配范围内，绝不会被删）
 * @returns {string[]} 被删除的文件名
 */
export function pruneBackups(dir, { keep = 10 } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => BACKUP_NAME_RE.test(n));
  } catch {
    return [];
  }
  const withTime = names.map((n) => {
    try {
      return { n, m: fs.statSync(path.join(dir, n)).mtimeMs };
    } catch {
      return { n, m: 0 };
    }
  });
  withTime.sort((a, b) => b.m - a.m);
  const removed = [];
  withTime.slice(Math.max(0, keep)).forEach(({ n }) => {
    try {
      fs.unlinkSync(path.join(dir, n));
      removed.push(n);
    } catch {
      /* 单个删除失败不影响同步主流程 */
    }
  });
  return removed;
}

/**
 * 坚果云 WebDAV 客户端
 */
export class Jianguoyun {
  constructor({ account, password, dir = DEFAULT_DIR, fileName = SNAPSHOT_FILENAME, baseUrl = DEFAULT_BASE }) {
    this.auth = { account, password };
    this.url = buildRemoteUrl({ baseUrl, dir, fileName });
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const encodedDir = encodeWebdavPath(dir);
    // 备份文件与主快照同目录，dirUrl 结尾不带斜杠
    this.dirUrl = encodedDir ? `${base}${encodedDir}` : base.replace(/\/$/, '');
  }

  /** 同目录下的备份文件地址（不新建子目录，免去二次 MKCOL） */
  urlFor(fileName) {
    return `${this.dirUrl}/${fileName}`;
  }

  /**
   * 确保云端目录存在（不存在则逐级创建）
   */
  async ensureDir() {
    const res = await webdavRequest({ url: this.dirUrl, method: 'MKCOL', auth: this.auth });
    // 405/409 表示目录已存在，视为成功；401 等其它错误抛出
    if (res.status === 405 || res.status === 409 || res.status === 201 || res.status === 200) return;
    throw new Error(describeHttpError('MKCOL', res.status));
  }

  /**
   * 上传快照（覆盖云端文件）
   * @param {string} jsonString
   */
  async push(jsonString) {
    await this.ensureDir();
    const res = await webdavRequest({ url: this.url, method: 'PUT', auth: this.auth, body: jsonString });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(describeHttpError('PUT 上传', res.status));
    }
  }

  /**
   * 把云端旧内容另存为同目录下的备份文件（覆盖云端前调用）
   * @param {string} fileName
   * @param {string} jsonString
   */
  async pushBackup(fileName, jsonString) {
    await this.ensureDir();
    const res = await webdavRequest({ url: this.urlFor(fileName), method: 'PUT', auth: this.auth, body: jsonString });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(describeHttpError('PUT 备份', res.status));
    }
  }

  /**
   * 下载快照
   * @returns {Promise<{status:number, data:object|null}>}
   */
  async pull() {
    const res = await webdavRequest({ url: this.url, method: 'GET', auth: this.auth });
    if (res.status === 404) return { status: 404, data: null };
    if (res.status < 200 || res.status >= 300) {
      throw new Error(describeHttpError('GET 下载', res.status));
    }
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new Error('云端文件不是合法的 DayMark 数据文件；为防止覆盖，已中止导入');
    }
    return { status: 200, data };
  }

  /**
   * 读取本地快照文件
   * @param {string} filePath
   */
  static readLocal(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

export { DEFAULT_BASE, DEFAULT_DIR };