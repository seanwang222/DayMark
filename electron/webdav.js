/**
 * 坚果云 WebDAV 同步核心（纯 Node，无 Electron 依赖，可独立回归测试）
 *
 * 协议要点（坚果云 dav.jianguoyun.com/dav/）：
 * - 认证：Authorization: Basic base64(注册邮箱:应用密码)，这里的应用密码专指
 *   用于授权第三方 WebDAV 应用访问的 16 位随机应用密码（不是坚果云登录密码）
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
/**
 * 界面与提示里对这个凭据的统一称谓。渲染层（SyncPanel）无法 import 本文件，
 * 那边写的是同一串字面量，verify:webdav 用文件比对锁住两者不得漂移。
 */
export const APP_PASSWORD_NAME = '用于授权第三方 WebDAV 应用访问的 16 位随机应用密码';
export const APP_PASSWORD_LENGTH = 16;
/** 请求超时：没有超时时，网络半开会让界面永远停在「处理中…」 */
export const REQUEST_TIMEOUT_MS = 20000;
export const SNAPSHOT_FILENAME = 'daymark-snapshot.json';
/** 备份文件名前缀匹配：daymark-snapshot.conflict-*.json（被覆盖的本地）/ .cloud-*.json（被覆盖的云端） */
export const BACKUP_NAME_RE = /^daymark-snapshot\.(conflict|cloud)-[\dT-]+\.json$/;

function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * 归一化用户填写的远程目录：反斜杠（从资源管理器粘的 Windows 路径）换成 `/`、
 * 去掉首尾斜杠与空白、合并空段。
 *
 * 这里**刻意不动目录内容本身**：WebDAV 根对应的是网页里的哪一层，各家实现不一样，
 * 猜着剥掉「我的坚果云」这类前缀会把本来对的配置改错。填错时由 checkConnection()
 * 逐级 PROPFIND 告诉你云端实际有什么。
 * @param {string} dir
 * @returns {string}
 */
export function normalizeWebdavDir(dir) {
  return String(dir == null ? '' : dir)
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join('/');
}

/**
 * 逐段编码 WebDAV 路径：坚果云目录名允许空格、#、中文等字符，
 * 不编码会让 URL 变形（空格截断、# 之后被当片段），表现为莫名的 404。
 */
export function encodeWebdavPath(dir) {
  return normalizeWebdavDir(dir)
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

/** href 里可能带百分号编码，坏码不能把整个诊断带崩 */
function safeDecode(s) {
  try {
    return decodeURIComponent(String(s));
  } catch {
    return String(s);
  }
}

/**
 * 解析 PROPFIND 的多状态响应（207）。命名空间前缀各家实现写法不同（d: / D: / 无前缀），
 * 所以按标签名匹配而不是完整前缀。
 * @param {string} xml
 * @returns {Array<{href:string, name:string, isDir:boolean}>}
 */
export function parseMultistatus(xml) {
  const chunks = String(xml || '').match(/<(?:[\w-]+:)?response>[\s\S]*?<\/(?:[\w-]+:)?response>/gi) || [];
  return chunks
    .map((c) => {
      const m = c.match(/<(?:[\w-]+:)?href>([^<]*)</i);
      const href = safeDecode(m ? m[1] : '');
      const isDir = /<(?:[\w-]+:)?collection\b/i.test(c);
      const name = href.replace(/\/+$/, '').split('/').filter((s) => s !== '').pop() || '';
      return { href, name, isDir };
    })
    .filter((e) => e.name !== '');
}

/**
 * 找出「远程目录」里第一个在云端不存在的层级。
 * @param {string[]} segments 归一化后的目录段
 * @param {Array<Array<{name:string}>>} levels levels[i] 是第 i 段所在父目录的子项（levels[0] 为根）
 * @returns {?{index:number, missing:string, trail:string, available:string[]}}
 */
export function diagnoseMissingLevel(segments, levels) {
  for (let i = 0; i < segments.length; i += 1) {
    const children = levels[i] || [];
    const names = children.map((e) => e.name);
    if (!names.includes(segments[i])) {
      return {
        index: i,
        missing: segments[i],
        trail: segments.slice(0, i + 1).join('/'),
        available: names,
      };
    }
  }
  return null;
}

/**
 * 执行一次 WebDAV HTTP 请求
 * @param {{url:string, method?:string, auth:{account:string,password:string}, body?:string, depth?:string, timeoutMs?:number}} opts
 * @returns {Promise<{status:number, body?:string, challenge?:string}>}
 */
export async function webdavRequest({ url, method = 'GET', auth, body, depth, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const headers = { Authorization: `Basic ${b64(`${auth.account}:${auth.password}`)}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // PROPFIND 不带 Depth 时不少服务端会拒绝或只回自己
  if (depth) headers.Depth = depth;
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
  return {
    status: res.status,
    body: text,
    // 401 时服务器用这个头说明"要哪种认证、针对哪个域"，是判断"地址填错 vs 密码填错"的关键线索
    challenge: (res.headers && typeof res.headers.get === 'function' && res.headers.get('www-authenticate')) || '',
  };
}

/** 账号打码：只留首字符与 @ 之后的域，够用户认出是不是自己那个邮箱 */
function maskAccount(account) {
  const s = String(account || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? `${s.slice(0, 1)}***（不是邮箱格式）` : '（空）';
  return `${s.slice(0, 1)}***${s.slice(at)}`;
}

/** 压成单行、去掉控制字符并截断，避免把整段 HTML 错误页塞进界面 */
function oneLine(s, max = 80) {
  const t = String(s || '').replace(/[\s]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 认证失败的可诊断说明（纯函数，绝不回显密码明文，只给长度形态）
 * @param {{account?:string, password?:string, server?:string, challenge?:string}} info
 */
export function describeAuthFailure(info = {}) {
  const parts = [];
  const account = String(info.account || '');
  const password = String(info.password || '');
  const server = String(info.server || DEFAULT_BASE);

  parts.push(`本机使用的账号：${maskAccount(account)}`);

  // 只按长度判断：应用密码固定 16 位，但字符集不限于字母数字，
  // 拿 /^[A-Za-z0-9]{16}$/ 去卡会把粘对了的用户判成"不像应用密码"（实测踩到）
  if (!password) {
    parts.push(`本机没有存到密码：请输入${APP_PASSWORD_NAME}（坚果云网页「账户信息 → 安全选项 → 添加应用密码」生成，不是登录密码）`);
  } else if (password.length === APP_PASSWORD_LENGTH) {
    parts.push(`密码长度 ${password.length} 位，与${APP_PASSWORD_NAME}一致 —— 仍被拒更可能是账号写错，或这个应用密码已被删除/失效，建议重新生成一个再整串粘贴`);
  } else {
    parts.push(`密码长度 ${password.length} 位，而${APP_PASSWORD_NAME}固定 ${APP_PASSWORD_LENGTH} 位 —— 多半是没粘贴完整或填成了登录密码，请在坚果云网页「账户信息 → 安全选项 → 添加应用密码」重新生成并整串粘贴`);
  }

  const isDefaultBase = server === DEFAULT_BASE;
  parts.push(isDefaultBase ? `地址：默认坚果云 ${DEFAULT_BASE}` : `地址：${oneLine(server, 120)}（不是默认坚果云地址，若你用的是坚果云请清空这一格）`);

  const challenge = oneLine(info.challenge);
  if (challenge) parts.push(`服务器质询：${challenge}`);

  return parts.join('；');
}

/**
 * 解析服务端错误为可读信息
 * @param {string} method
 * @param {number} status
 * @param {string} [detail] 认证类错误的补充诊断（describeAuthFailure 的产出）
 */
export function describeHttpError(method, status, detail) {
  // detail 一律附在句尾：401 是认证诊断，409 / 403 是实际请求路径，都靠它才看得懂
  const tail = detail ? `。${detail}` : '';
  if (status === 401) {
    return `${method} 认证失败：请检查 WebDAV 账号与${APP_PASSWORD_NAME}${tail}`;
  }
  if (status === 403) return `${method} 权限不足：账号无权写入该路径${tail}`;
  if (status === 404) return `${method} 404：云端文件/目录不存在${tail}`;
  if (status === 409 || status === 405) {
    // 同一个 409 在建目录时是"目录已在"（ensureDir 已按成功处理），在读写文件时
    // 坚果云多半是在说"父目录不存在"——所以必须把实际请求的路径带出来
    return `${method} 409：路径不存在或已存在（读 / 写时通常是「远程目录」写错了）${tail}`;
  }
  if (status === 507) return `${method} 507：云端存储空间不足${tail}`;
  return `${method} 失败（HTTP ${status}）${tail}`;
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
    this.baseUrl = baseUrl;
    this.dir = normalizeWebdavDir(dir);
    this.fileName = fileName;
    this.url = buildRemoteUrl({ baseUrl, dir, fileName });
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const encodedDir = encodeWebdavPath(dir);
    // 备份文件与主快照同目录，dirUrl 结尾不带斜杠
    this.dirUrl = encodedDir ? `${this.base}${encodedDir}` : this.base.replace(/\/$/, '');
  }

  /** 401 时把「本机到底用了什么」拼进错误信息；不含密码明文 */
  authDetail(res) {
    return describeAuthFailure({
      account: this.auth.account,
      password: this.auth.password,
      server: this.baseUrl,
      challenge: res && res.challenge,
    });
  }

  /**
   * 路径类错误（409 / 403）时把实际请求的 URL 带出来——凭据只在 Authorization 头里，
   * URL 本身不含密钥，可以直接展示给用户自查「远程目录」。
   */
  pathDetail(res) {
    if (!res || (res.status !== 409 && res.status !== 403)) return '';
    return `实际请求的路径：${this.url}；「远程目录」用 / 分段（反斜杠会被当成文件名的一部分），不确定云端叫什么时点「测试连接」，它会列出该层实际存在的目录`;
  }

  /** 统一的抛错出口：401 给认证诊断，409/403 给实际路径 */
  failWith(method, res) {
    const detail = res && res.status === 401 ? this.authDetail(res) : this.pathDetail(res);
    return new Error(describeHttpError(method, res && res.status, detail));
  }

  /** 同目录下的备份文件地址（不新建子目录，免去二次 MKCOL） */
  urlFor(fileName) {
    return `${this.dirUrl}/${encodeURIComponent(fileName)}`;
  }

  /**
   * PROPFIND 一个集合的直接子项（Depth:1）。
   * 集合不存在时返回 null（坚果云对不存在的路径给 404/409，都不当作异常抛出，
   * 因为调用方是"先看看云端有什么"的诊断路径，不是数据路径）。
   * @param {string} collectionUrl 以不带斜杠的集合路径给出，内部补 `/`
   * @returns {Promise<?Array<{name:string, isDir:boolean}>>}
   */
  async listChildren(collectionUrl) {
    const url = collectionUrl.endsWith('/') ? collectionUrl : `${collectionUrl}/`;
    const res = await webdavRequest({ url, method: 'PROPFIND', auth: this.auth, depth: '1' });
    if (res.status === 404 || res.status === 409) return null;
    if (res.status !== 207 && res.status !== 200) throw this.failWith('PROPFIND', res);
    // Depth:1 的第一条通常是被查询的集合自己，去掉它才是在数子项
    const selfPath = safeDecode(url.replace(/^https?:\/\/[^/]+/i, '')).replace(/\/+$/, '');
    return parseMultistatus(res.body).filter((e) => e.href.replace(/\/+$/, '') !== selfPath);
  }

  /**
   * 逐级 PROPFIND，定位「远程目录」里第一个云端不存在的层级。
   * @returns {Promise<{ok:boolean, missing:?object, levels:Array, segments:string[]}>}
   */
  async probeDir() {
    const segments = this.dir ? this.dir.split('/') : [];
    const levels = [];
    let url = this.base;
    for (let i = 0; i < segments.length; i += 1) {
      const children = await this.listChildren(url);
      levels.push(children || []);
      if (!children) break; // 这一层的父目录就不存在，后面不必再问
      url = `${url}${encodeURIComponent(segments[i])}/`;
    }
    return { segments, levels, missing: diagnoseMissingLevel(segments, levels) };
  }

  /**
   * 连接自检：GET 一次快照，把各种结果翻译成用户能行动的话。
   * 坚果云用 409 表示"路径不存在"（不给 404），所以 409 不能直接当错误扔给用户，
   * 得逐级 PROPFIND 才知道到底哪一层不对、云端那层实际叫什么。
   * @returns {Promise<{ok:boolean, status:string, notice?:string, error?:string}>}
   */
  async checkConnection() {
    const res = await webdavRequest({ url: this.url, method: 'GET', auth: this.auth });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: 'ready', notice: '连接有效，云端已有数据文件。' };
    }
    if (res.status !== 404 && res.status !== 409) {
      return { ok: false, status: 'error', error: this.failWith('GET 下载', res).message };
    }
    let probe;
    try {
      probe = await this.probeDir();
    } catch (err) {
      return { ok: false, status: 'error', error: err.message };
    }
    if (probe.missing) {
      const { trail, available } = probe.missing;
      const where = probe.missing.index === 0 ? 'WebDAV 根目录下' : `「${probe.segments.slice(0, probe.missing.index).join('/')}」下`;
      const listed = available.length ? `${available.slice(0, 15).join('、')}${available.length > 15 ? ' …' : ''}` : '（这一层是空的）';
      return {
        ok: false,
        status: 'missing-dir',
        error: `云端没有「${trail}」这一层（坚果云对不存在的路径回 ${res.status}）。${where}实际有：${listed}。把「远程目录」改成与上面一致的名字即可；你当前填的是「${this.dir}」。`,
      };
    }
    // 目录每一层都在，只是还没有数据文件
    return {
      ok: true,
      status: 'empty-dir',
      notice: `连接有效，云端目录「${this.dir}」存在但还没有数据文件，点「立即上传」会创建它。`,
    };
  }

  /**
   * 确保云端目录存在：逐级 MKCOL。
   * 405/405 类"已存在"视为成功；409 在坚果云是**父目录不存在**，所以必须自顶向下建，
   * 不能对整条路径发一次 MKCOL 再把 409 当成功吞掉（那样后面 PUT 必失败）。
   */
  async ensureDir() {
    const segments = this.dir ? this.dir.split('/') : [];
    let url = this.base;
    for (let i = 0; i < segments.length; i += 1) {
      url = `${url}${encodeURIComponent(segments[i])}/`;
      const res = await webdavRequest({ url, method: 'MKCOL', auth: this.auth });
      if (res.status === 201 || res.status === 200 || res.status === 405) {
        // 405 = 已存在，继续下一层
      } else if (res.status === 409) {
        // 上一层没建出来（权限或并发），直接报清楚断在哪
        throw new Error(`${describeHttpError('MKCOL', 409)}：建到「${segments.slice(0, i + 1).join('/')}」时失败，请确认上一级目录存在且账号有写权限`);
      } else {
        throw this.failWith('MKCOL', res);
      }
    }
  }

  /**
   * 上传快照（覆盖云端文件）
   * @param {string} jsonString
   */
  async push(jsonString) {
    await this.ensureDir();
    const res = await webdavRequest({ url: this.url, method: 'PUT', auth: this.auth, body: jsonString });
    if (res.status < 200 || res.status >= 300) {
      throw this.failWith('PUT 上传', res);
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
      throw this.failWith('PUT 备份', res);
    }
  }

  /**
   * 下载快照
   * @returns {Promise<{status:number, data:object|null}>}
   */
  async pull() {
    const res = await webdavRequest({ url: this.url, method: 'GET', auth: this.auth });
    // 404 = 目录在、文件还没有；409 = 坚果云用它表示"路径不存在"。
    // 两者对同步的语义相同：云端没有可比对的数据，按"本机较新"走上传分支。
    if (res.status === 404 || res.status === 409) return { status: 404, data: null };
    if (res.status < 200 || res.status >= 300) {
      throw this.failWith('GET 下载', res);
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