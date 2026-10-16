/**
 * DayMark 桌面版配置读写（纯 Node，不依赖 Electron，可独立回归测试）
 * 配置文件：userData/daymark-config.json
 *
 * 应用密码优先交给调用方提供的 codec（主进程注入 Electron safeStorage）加密，
 * 落盘为 passwordEnc（base64 密文），文件里不留明文；
 * codec 不可用时才退回明文 password 字段。渲染进程只拿到 passwordSet 标记。
 */
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILENAME = 'daymark-config.json';

export const DEFAULT_CONFIG = {
  account: '',
  password: '',
  server: '', // 留空 = 使用默认坚果云地址
  dir: 'DayMark',
  autoSync: false,
  syncedAt: '',
};

export function configFile(dir) {
  return path.join(dir, CONFIG_FILENAME);
}

function readRawConfig(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile(dir), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function canEncrypt(codec) {
  return !!(
    codec
    && typeof codec.available === 'function'
    && codec.available()
    && typeof codec.encrypt === 'function'
  );
}

function canDecrypt(codec) {
  return !!(
    codec
    && typeof codec.available === 'function'
    && codec.available()
    && typeof codec.decrypt === 'function'
  );
}

/**
 * 读出可直接使用的配置（密码为明文，仅在内存中流转）
 * @param {string} dir userData 目录
 * @param {{available:Function, encrypt:Function, decrypt:Function}} [codec] 缺省则按明文读取
 */
export function readConfig(dir, codec) {
  const raw = readRawConfig(dir);
  if (!raw) return { ...DEFAULT_CONFIG };
  let password = '';
  if (raw.passwordEnc) {
    // 密文解不开（换了机器 / 换了系统账户 / 内容被截断）时视为未配置，
    // 宁可让用户重填一次，也不要拿着乱码去同步然后报一个看不懂的 401
    if (canDecrypt(codec)) {
      try {
        password = codec.decrypt(raw.passwordEnc) || '';
      } catch {
        password = '';
      }
    }
  } else {
    password = raw.password || ''; // 旧版明文配置，下次写入时自动迁移为密文
  }
  return {
    account: raw.account || '',
    password,
    server: raw.server || '',
    dir: raw.dir || 'DayMark',
    autoSync: !!raw.autoSync,
    syncedAt: raw.syncedAt || '',
  };
}

/**
 * 落盘配置
 * @param {string} dir
 * @param {object} cfg 含明文 password
 * @param {{available:Function, encrypt:Function, decrypt:Function}} [codec] 可用时密码写成 passwordEnc
 */
export function writeConfig(dir, cfg, codec) {
  const out = { ...DEFAULT_CONFIG, ...cfg };
  const plain = typeof out.password === 'string' ? out.password : '';
  delete out.passwordEnc;
  if (plain) {
    if (canEncrypt(codec)) {
      out.passwordEnc = codec.encrypt(plain);
      out.password = '';
    } else {
      out.password = plain; // 系统钥匙串不可用（如无 keyring 的 Linux）才留在明文
    }
  } else {
    // 内存里没有明文＝「保持原密码」。这里必须回头读盘上那一份，否则一次「只更新 syncedAt」
    // 或「只改自动同步开关」的写入就会把还能用的密码抹成空 —— 用户被迫重填，
    // 而重填时最容易填成登录密码，之后的同步就永远停在 401。
    const prev = readRawConfig(dir);
    const prevEnc = (prev && prev.passwordEnc) || '';
    const prevPlain = (prev && prev.password) || '';
    if (prevEnc) {
      out.passwordEnc = prevEnc;
      out.password = '';
    } else if (prevPlain) {
      if (canEncrypt(codec)) {
        out.passwordEnc = codec.encrypt(prevPlain); // 旧明文顺手迁移成密文
        out.password = '';
      } else {
        out.password = prevPlain;
      }
    } else {
      out.password = '';
    }
  }
  if (!out.passwordEnc) delete out.passwordEnc;

  const file = configFile(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 界面提交 → 待落盘配置
 * 密码留空表示「保持原密码不变」；syncedAt 由主进程自己维护，不接受界面输入
 */
export function mergeConfigInput(current, input = {}) {
  return {
    ...current,
    account: (input.account || '').trim(),
    password:
      typeof input.password === 'string' && input.password.trim() !== ''
        ? input.password.trim()
        : current.password,
    server: (input.server || '').trim(),
    dir: (input.dir || 'DayMark').trim() || 'DayMark',
    autoSync: !!input.autoSync,
  };
}

export function hasCloudConfig(cfg) {
  return !!(cfg && cfg.account && cfg.password);
}

/** 回给渲染进程的安全副本：密码不回显，只标记是否已设置 */
export function publicConfig(cfg) {
  const { password, passwordEnc, ...rest } = cfg || {};
  return { ...DEFAULT_CONFIG, ...rest, passwordSet: !!password, password: '' };
}
