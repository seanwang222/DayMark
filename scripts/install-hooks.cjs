/**
 * 安装本地 git 钩子（把 scripts/git-hooks/ 下的文件复制到仓库 hooks 目录）
 * 用法: npm run hooks:install
 *
 * 只影响本机 .git 目录，不进版本库；卸载：删除复制过去的那个文件即可。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const srcDir = path.join(repoRoot, 'scripts', 'git-hooks');

let hooksDir;
try {
  // 用 git 自己算，兼容 worktree（.git 可能是文件而非目录）
  hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (!path.isAbsolute(hooksDir)) hooksDir = path.join(repoRoot, hooksDir);
} catch (e) {
  console.error('无法定位 git hooks 目录（当前目录不是 git 仓库？）:', e.message);
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });
fs.readdirSync(srcDir).forEach((name) => {
  const to = path.join(hooksDir, name);
  fs.copyFileSync(path.join(srcDir, name), to);
  try {
    fs.chmodSync(to, 0o755);
  } catch {
    /* Windows 上权限位无意义，忽略 */
  }
  console.log(`已安装 ${name} -> ${to}`);
});

console.log('提交前会自动跑 npm run verify；绕过：git commit --no-verify');
