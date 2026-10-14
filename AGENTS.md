# AGENTS.md

DayMark（React 18 + Vite 4 渲染层，Electron 44 桌面层）的协作约定。面向在此仓库工作的 agent 与开发者。

用户可读的完整说明在 **README.md**（功能、安装、WebDAV 配置与同步机制、数据存储位置）。本文件只记录改代码前必须知道的约束与验证入口，不重复 README 的内容。

改数据路径前先读 **`docs/architecture/`**：`persistence.md`（落盘时序）、`sync.md`（同步链路与冲突决策）、`stats.md`（统计口径）都带 `文件:行号` 的事实来源，以及一份与代码冲突时以代码为准的「已知差异」清单——下面的条目是那些文档的摘要。

## 0. 动手前

- **改数据/同步相关代码前先跑 `npm run verify`**（六套，见 README 脚本表）；改完再跑一次。任一套失败就不要提交。钩子在 `npm install` 时由 package.json 的 `prepare` 自动装好（也可手动 `npm run hooks:install`），之后每次 commit 都会跑；依赖没装时钩子会拦住提交而不是放行（绕过：`--no-verify`）。
- 涉及渲染层或主进程的时序改动，另跑 `npm run build:standalone` 确认打包链没断。
- 本仓库是 **GitHub 公开仓库**（`origin` = `https://github.com/wangsichen222/DayMark`，默认分支 `master`），推送即发布，公开历史撤回不掉。**`.workbuddy/` 下除 `verify-*.mjs` 之外的一切默认被忽略**（本机笔记、一次性改写脚本、verify 打包结果），新写的一次性脚本天然进不了提交；`userData` 里的快照与坚果云凭据物理上在仓库外（`%APPDATA%\daily-checkin-app\`），不要把它们复制进仓库再提交。任何情况下都不要用 `git add -f` 绕过忽略规则。
- 提交身份固定为 GitHub noreply 邮箱 `59314215+wangsichen222@users.noreply.github.com`，避免真实邮箱进公开历史。本机全局 git 身份是空值，因此提交要显式 `git -c user.name="Sichen Wang" -c user.email="59314215+wangsichen222@users.noreply.github.com" commit`。
- 不要调用真实坚果云账号。同步类验证一律走 `.workbuddy/verify-webdav.mjs` 里的本地 mock 服务。
- 启动 Electron GUI（`DAYMARK_SMOKE` / `electron:dev`）会打开真实窗口并读写 `%APPDATA%\daily-checkin-app\` 下的用户数据，需人工确认后再执行。冒烟模式已把 `userData` 重定向到临时目录，但仍属 GUI 操作。主进程带单实例锁，第二次启动只会把已有窗口调到前台。

## 1. 存储模型（最容易改错的地方）

- localStorage 是渲染层唯一的运行时存储，键名只在 `src/utils/storage.js` 的 `STORAGE_KEYS` 里定义；`SCHEMA_VERSION` 变更必须同步 `migrateIfNeeded()`，它在模块导入期就执行。
- 依赖方向是 **persistence → storage**：`storage.js` 通过 `onDataWritten()` 通知「数据变了」，`persistence.js` 决定「何时落盘」。**不要让 storage 反向 import persistence**，那正是回填前空快照盖掉本机文件的成因。
- `ready` 之前（启动回填未完成）一律不落盘；`applySnapshot()` 故意不通知订阅者，避免刚下载的数据被回写并引发多余推送。
- 快照的 `updatedAt` 是本地/云端比对的唯一依据（缺失时回落 `exportDate`）。任何生成快照的新路径都必须带上它。
- 桌面版落盘走主进程：`.tmp` + 同卷 `renameSync` 原子写。**不要退回单步 `writeFileSync`**，半截 JSON 会被 `readLocal` 当作「本机为空」，一次同步就把「空」推上云端。
- 冲突策略是「只在会丢较新一方时动手，且动手前先留档」。决策逻辑是纯函数 `planPull` / `planPush`（`electron/webdav.js`），主进程只负责执行动作；新需求请扩这两个函数并补 `verify:webdav` 用例，不要把判断写进 IPC handler。
- **统计口径**：完成率的分母只算「当天已经存在的打卡项」，且未到来的日子不参与统计（`getMonthlyData` 是唯一的口径实现，季/年视图从它汇总）。单项目与多项聚合的 `total` 必须能相加对齐 —— 改这里同时跑 `verify:stats`。
- 「已过期」判定统一走 `storage.js` 的 `isPastDue(completed, dueDate, todayStr)`。**不要在现场直接写 `dueDate < todayStr`**：空 `dueDate` 参与字符串比较恒为真，会把所有无截止日的待办标成过期。
- 日程页「提醒」的取数与排序是 `storage.js` 的 `getUpcomingPhases(withinDays, todayStr)`，只有一个排序键（剩余天数升序，逾期为负故自然置顶）。改窗口或改排序都去扩 `verify:todo` 第 6 组，不要在页面里另写一套。
- CSV 的公式注入护栏是成对的：`csvCell` 给以 `= + - @` 开头的内容加前置撇号，`parseCSV` 再脱掉。改其中一处必须同时改另一处，否则「导出 → 恢复」会多出一个撇号（`verify:backup` 有往返用例）。

## 2. 桌面层约定

- 配置读写全部经 `electron/config.js`（纯 Node，可脱离 Electron 测试）。规则：空密码表示保持原密码；`syncedAt` 只由主进程维护，不接受界面输入；`publicConfig()` 回显时抹掉密码。新增配置字段时，`DEFAULT_CONFIG`、`readConfig`、`mergeConfigInput` 三处都要补，否则字段会被静默丢弃（「WebDAV 服务器」字段就踩过这个坑）。
- 应用密码不落明文：`readConfig` / `writeConfig` 的第三个参数接收 codec（主进程注入 Electron `safeStorage`，Windows 下绑定当前用户账户），可用时密文存进 `passwordEnc`，`cfg.password` 只在内存里流转。config.js 本身不许 import electron；换机器导致解不开时按「未配置」处理，不要拿乱码去同步。回归用假 codec 跑 `verify:config`。
- WebDAV 路径按 URL 段编码（`encodeWebdavPath` / `buildRemoteUrl`）。新增任何拼接远端地址的地方都走这两个函数，否则含空格、中文、`#` 的目录名会莫名 404。
- 主进程持 `requestSingleInstanceLock`：安装版与便携版共用同一 userData，双开会互相盖写快照文件。新增启动逻辑要放在拿到锁之后。
- 渲染层与主进程只通过 `electron/preload.cjs` 暴露的 `window.daymark` 通信。`beforeunload` 兜底必须走同步通道 `saveSnapshotSync`（`invoke` 是异步的，`beforeunload` 等不到返回）。
- 同一时刻只允许一个同步任务（`withSyncLock`）。新增同步入口请包在锁里，并考虑「锁被占用时重新排期」而不是丢弃。
- **读本机快照必须在 `await` 网络之后**（`runSync` / push-now / pull-now 都是这个顺序）。一次同步要「读本地 + 读云端」，先读本地再等云端那 20 秒，等待期间的用户改动就已落盘，拿旧快照去决策会把新数据无备份地盖掉。锁只互斥同步之间，管不到渲染层落盘。
- 所有 WebDAV 请求带 20 秒超时；错误要经 `describeHttpError` 转成用户能懂的中文提示。

## 3. 构建与依赖约定

- **依赖全部写在 `devDependencies` 是刻意的**：渲染层被 Vite 打包成单文件 HTML，主进程只用 `electron` 与 Node 内置模块，运行时不读 `node_modules`。挪进 `dependencies` 会让 electron-builder 把整个 `node_modules` 打进 asar。
- 桌面版加载的是项目根的 `index-standalone.html`，由 `build:electron` 从 `dist/` 复制而来。只跑 `build:standalone` 不会更新根目录那份，调试桌面版时要留意。`build.files` 里**只有根那份单文件 HTML**，不要再把 `dist/**` 加进 asar（主进程从不读 dist，只是让包白胖 500KB）。
- 开发端口 3000 且 `strictPort: true`：端口被占时宁可报错，也不要静默换到 3001 让桌面窗口加载到别的页面。
- 回归脚本用 esbuild 打包后才跑：源码 import 省略扩展名，纯 Node ESM 无法直接解析。新增校验脚本请沿用 `.workbuddy/verify-*.mjs` + `verify:<name>` 脚本 + 并入 `verify` 的写法，用 `globalThis.localStorage` / `globalThis.window` 桩替代浏览器环境。

## 4. 界面约定

- 中文界面、暗色主题；配色分两套：**完成频率色阶 = 纯蓝**（`src/utils/colors.js` 的 `getRateColor`），**状态语义（完成/勾选）= 绿**，不要混用或回到分档硬编码。
- MUI 与 Tailwind 并存，组件内优先沿用邻近文件的既有写法，不为样式引入新依赖。
