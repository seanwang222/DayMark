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
- **新增一类数据（如临时任务）必须同时改到四个落点**：`getAllData()`（进快照 → 落盘与上云）、`applySnapshot()`（回填时整份替换，缺字段要写空值）、`setAllData()`（备份恢复的合并与覆盖）、`backup.js` 的 CSV 区块导出与解析。少一个就是静默丢数据；`verify:persistence` 与 `verify:backup` 已按这四个落点各留了用例。新键本身不需要动 `SCHEMA_VERSION`（老数据读出来归一化为空即可）。
- 依赖方向是 **persistence → storage**：`storage.js` 通过 `onDataWritten()` 通知「数据变了」，`persistence.js` 决定「何时落盘」。**不要让 storage 反向 import persistence**，那正是回填前空快照盖掉本机文件的成因。
- `ready` 之前（启动回填未完成）一律不落盘；`applySnapshot()` 故意不通知订阅者，避免刚下载的数据被回写并引发多余推送。
- 快照的 `updatedAt` 是本地/云端比对的唯一依据（缺失时回落 `exportDate`）。任何生成快照的新路径都必须带上它。
- 桌面版落盘走主进程：`.tmp` + 同卷 `renameSync` 原子写。**不要退回单步 `writeFileSync`**，半截 JSON 会被 `readLocal` 当作「本机为空」，一次同步就把「空」推上云端。
- 冲突策略是「只在会丢较新一方时动手，且动手前先留档」。决策逻辑是纯函数 `planPull` / `planPush`（`electron/webdav.js`），主进程只负责执行动作；新需求请扩这两个函数并补 `verify:webdav` 用例，不要把判断写进 IPC handler。
- **统计口径**：某天进不进分母，只问 `storage.js` 的 `isItemActiveOn(item, dateStr)`（在册 = `createdAt ≤ 当天 < archivedAt`）。分母只算「当天在册的打卡项」，且未到来的日子不参与统计。分日实现是 `getMonthlyData`（季/年视图从它汇总，`CheckinCalendar` 也必须直接消费它的输出含 `excluded`，**不要在组件里再抄一份 filter**——1.1.1 之前那套「月历自己算一套」就是最容易复发的缺陷）。单项目与多项聚合的 `total` 必须能相加对齐 —— 改这里同时跑 `verify:stats`。
- **汇总统计只按所选区间算**：打卡页统计卡的完成天数 / 完成率 / 当前连续 / 最长连续全部落在 `getViewRange(view, year, month, quarter)` 给出的区间里，实现唯一是 `statsFromRange`（`getItemStats(itemId, range)` 与 `getOverallStats(range)` 都汇到它）。连续段不跨越区间边界；`skip` 的那天既不进分母也不打断连续；区间整体在未来时返回 `empty: true`，界面显示「—」而不是 0%。不要把这四个数字再改回「创建日至今」的总账。**1.1.4 起 `getViewRange` 还返回 `dayBasis`，决定「不在册的日子算不算分母」**：月度 = `active`（求交在册区间，项目诞生前不算未完成），季度 / 年度 = `period`（分母就是这段区间**已经过去的天数**，过去的整季 92 天、整年 365 天，不再被创建日与归档日裁短）。这个开关只由上面两个统计入口读，**不要塞进 `statsFromRange`**——它只负责一天天走，把项目数组递进逐日循环器等于让遍历器同时决定口径。未来的日子在两套基数下都被 `end` 裁掉；连续段在 `period` 下会被诞生前那些「没达成」的日子切断，这是本条口径的应有代价。回归见 `verify:stats` 场景 J 与场景 L。
- **归档（1.1.2 起）不新增存储键**：打卡项与待办仍共用原数组，归档只是加 `archived` / `archivedAt` 两个字段，所以 `getAllData()` / `applySnapshot()` / 快照落盘 / WebDAV 都不用改。但要盯住三处白名单重建，漏一个就静默丢归档状态：`normalizeTodo()`、`setAllData()` 里打卡项的重建、`backup.js` 的 CSV 列与解析（旧备份缺列必须安全回落为未归档）。**界面取数只走 `getActiveCheckinItems()` / `getActiveTodos()`**（`getCheckinItems()` / `getTodos()` 是含归档的全量，只给备份与归档清单用），归档的查看与恢复入口唯一在「数据管理 → 归档」，不要在页面里另起一个归档列表。1.1.3 起该入口是弹窗内的**按月子界面**：主界面只给一行汇总 +「按月查看」，分组的唯一实现是 `backup.js` 的纯函数 `groupArchiveByMonth(getArchiveInventory())`（月份倒序、同月合并打卡项与待办、`archivedAt` 非法或缺失一律归到末尾「未记录归档日期」且分组前后条数必须相等），组件里不要再自己算月份。回归见 `verify:stats` 场景 K、`verify:todo` 第 7 组、`verify:backup` 第 10 与第 11 组、`verify:persistence` 第 6.5 组。
- `reorderCheckinItems()` / `reorderTodos()` 收到的是「界面当前可见」的 id 列表，**不等于整组数据**：归档项（以及任何没被传入的条目）必须按原顺序追加写回，不能拿传入数组直接覆盖存储。取消归档用 `delete` 掉两个字段，别写 `archived: false`，这样恢复后的记录与从未归档过逐字节等价。
- 「已过期」判定统一走 `storage.js` 的 `isPastDue(completed, dueDate, todayStr)`。**不要在现场直接写 `dueDate < todayStr`**：空 `dueDate` 参与字符串比较恒为真，会把所有无截止日的待办标成过期。
- 日程页「提醒」的取数与排序是 `storage.js` 的 `getUpcomingPhases(withinDays, todayStr)`，只有一个排序键（剩余天数升序，逾期为负故自然置顶）。1.1.4 起 `daysLeft === 0`（今天到期）也不进提醒：那些行动已经列在同一屏上方的「行动」分组里，重复列出只会把要往前看的项挤出视野——数据与 `phase.dueDate` 没有任何变化，纯粹是展示归属。**不要在页面里过滤**，否则提醒与「行动」的计数又会各算一套。改窗口、改排序、改「谁进提醒」都去扩 `verify:todo` 第 6 组，不要在页面里另写一套。
- CSV 的公式注入护栏是成对的：`csvCell` 给以 `= + - @` 开头的内容加前置撇号，`parseCSV` 再脱掉。改其中一处必须同时改另一处，否则「导出 → 恢复」会多出一个撇号（`verify:backup` 有往返用例）。

## 2. 桌面层约定

- 配置读写全部经 `electron/config.js`（纯 Node，可脱离 Electron 测试）。规则：空密码表示保持原密码；`syncedAt` 只由主进程维护，不接受界面输入；`publicConfig()` 回显时抹掉密码。新增配置字段时，`DEFAULT_CONFIG`、`readConfig`、`mergeConfigInput` 三处都要补，否则字段会被静默丢弃（「WebDAV 服务器」字段就踩过这个坑）。
- 应用密码不落明文：`readConfig` / `writeConfig` 的第三个参数接收 codec（主进程注入 Electron `safeStorage`，Windows 下绑定当前用户账户），可用时密文存进 `passwordEnc`，`cfg.password` 只在内存里流转。config.js 本身不许 import electron；换机器导致解不开时按「未配置」处理，不要拿乱码去同步。回归用假 codec 跑 `verify:config`。
- **`writeConfig` 在「本次没有明文」时必须回头读盘保住已有密码**（密文优先，只有旧明文则迁成密文）。过去只有 codec 不可用的分支做这件事，加密可用 + 空明文会把 `passwordEnc` 写成空串——一次「只更新 syncedAt」或「只改自动同步开关」就让用户从此每次同步都 401。界面那条「留空即保持原密码」的规则靠这里兜底，改动务必跑 `verify:config`。
- WebDAV 路径按 URL 段编码（`encodeWebdavPath` / `buildRemoteUrl`）。新增任何拼接远端地址的地方都走这两个函数，否则含空格、中文、`#` 的目录名会莫名 404。**用户填的目录过 `normalizeWebdavDir` 只纠正分隔符写法**（反斜杠→`/`、去首尾斜杠与空段），**绝不删改任何层级**：WebDAV 根对应网页里的哪一层各家实现不同，1.1.3 曾擅自剥掉开头的「我的坚果云」，把本来对的配置改错了。填错时由 `checkConnection()` 的 PROPFIND 自检报告实际缺哪一层。
- **坚果云用 409 表示「路径不存在」，不给 404**（实测：GET 一个不存在的目录就是 409）。因此：`pull()` 把 404 与 409 一律归一为「云端为空」`{status:404,data:null}`，让同步按"本机较新→上传"走；`ensureDir()` **自顶向下逐级 MKCOL**（一次整路径 MKCOL 遇到 409 就是父目录不存在，旧实现把 409 当"目录已在"吞掉、后面 PUT 必失败）；405/201/200 才算已存在。读写类 409/403 经 `Jianguoyun.failWith` 出口走 `describeHttpError`，附上 `pathDetail` 里的实际请求路径（URL 不含凭据，可安全展示），401 才走 `authDetail`——加新错误分支不要在调用点自己拼文案。
- 「测试连接」调 `client.checkConnection()` 而不是 `pull()`：它先 GET 快照，命中即 `ready`；404/409 时**逐级 PROPFIND** 定位断在哪一层，并把该层实际存在的目录名列进提示（`parseMultistatus` / `diagnoseMissingLevel` 都是纯函数，可脱离网络测试）。目录存在但没数据文件返回 `ok + empty-dir`，提示去「立即上传」，不当错误报。
- 主进程持 `requestSingleInstanceLock`：安装版与便携版共用同一 userData，双开会互相盖写快照文件。新增启动逻辑要放在拿到锁之后。
- 渲染层与主进程只通过 `electron/preload.cjs` 暴露的 `window.daymark` 通信。`beforeunload` 兜底必须走同步通道 `saveSnapshotSync`（`invoke` 是异步的，`beforeunload` 等不到返回）。
- 同一时刻只允许一个同步任务（`withSyncLock`）。新增同步入口请包在锁里，并考虑「锁被占用时重新排期」而不是丢弃。
- **读本机快照必须在 `await` 网络之后**（`runSync` / push-now / pull-now 都是这个顺序）。一次同步要「读本地 + 读云端」，先读本地再等云端那 20 秒，等待期间的用户改动就已落盘，拿旧快照去决策会把新数据无备份地盖掉。锁只互斥同步之间，管不到渲染层落盘。
- 所有 WebDAV 请求带 20 秒超时；错误要经 `describeHttpError` 转成用户能懂的中文提示。401 额外拼上 `describeAuthFailure` 的诊断尾巴（打码账号、**密码位数**、是否默认坚果云地址、`WWW-Authenticate` 质询，坚果云真实值是 `realm="nutstore"`）——「每次都 401」靠这一句才能自证是密码填错还是地址填错；**这里绝不能回显密码明文**，`verify:webdav` 锁住了这条。**判断密码只看长度（固定 16 位），不要用 `[A-Za-z0-9]` 之类的字符集正则**：应用密码可以含 `-` `_` 等字符，1.1.3 第一版就是拿「16 位字母数字」去卡，把粘贴对了的用户判成「不像应用密码」，回归用例已锁住这个反例。
- 这个凭据在界面与提示里的统一称谓是「用于授权第三方 WebDAV 应用访问的 16 位随机应用密码」，唯一定义在 `electron/webdav.js` 的 `APP_PASSWORD_NAME`；主进程引用该常量，渲染层 `SyncPanel.jsx` 因为不能 import 主进程模块而写了一份同名字面量——`verify:webdav` 会读这两个文件断言两者一字不差，改称谓时两处一起改。
- **「测试连接」用输入框里的当前表单值**（`daymark:test-connection` 收 `input` 后 `mergeConfigInput(readCfg(), input)`，密码留空＝沿用已存，且**不落盘**）；「立即上传 / 下载」与自动同步仍用**已保存**的配置。过去测试也只看盘上那份，用户改完密码不点保存就测，验的是旧密码，表现为"输什么都是 401"。三层接线（`SyncPanel` 传参 → `preload` 透传 → 主进程合并）由 `verify:config` 用源码断言锁住，别改回单参数版本。

## 3. 构建与依赖约定

- **依赖全部写在 `devDependencies` 是刻意的**：渲染层被 Vite 打包成单文件 HTML，主进程只用 `electron` 与 Node 内置模块，运行时不读 `node_modules`。挪进 `dependencies` 会让 electron-builder 把整个 `node_modules` 打进 asar。
- 桌面版加载的是项目根的 `index-standalone.html`，由 `build:electron` 从 `dist/` 复制而来。只跑 `build:standalone` 不会更新根目录那份，调试桌面版时要留意。`build.files` 里**只有根那份单文件 HTML**，不要再把 `dist/**` 加进 asar（主进程从不读 dist，只是让包白胖 500KB）。
- 开发端口 3000 且 `strictPort: true`：端口被占时宁可报错，也不要静默换到 3001 让桌面窗口加载到别的页面。
- 回归脚本用 esbuild 打包后才跑：源码 import 省略扩展名，纯 Node ESM 无法直接解析。新增校验脚本请沿用 `.workbuddy/verify-*.mjs` + `verify:<name>` 脚本 + 并入 `verify` 的写法，用 `globalThis.localStorage` / `globalThis.window` 桩替代浏览器环境。

## 4. 界面约定

- 中文界面、暗色主题；配色分两套：**完成频率色阶 = 纯蓝**（`src/utils/colors.js` 的 `getRateColor`），**状态语义（完成/勾选）= 绿**，不要混用或回到分档硬编码。
- **日程页的分区色各占一个色相**：打卡 = 绿 `#3fb950`、待办 = 琥珀 `#d29922`、行动 = 蓝 `#58a6ff`、提醒 = 紫色系（`SchedulePage.jsx` 的 `REMINDER_COLOR` / `REMINDER_COLOR_SOON` / `REMINDER_COLOR_LATER`）。红色 `#f85149` 在本页只保留给「已过期 / 已逾期」这个状态语义，不给某个分区当身份色；提醒的紧急度也用紫色由亮到暗，别再拿琥珀与蓝去分级（那会和待办、行动撞色，1.1.4 就是为此把提醒整段换紫）。完成率色阶仍然只有 `colors.js` 一处。
- **日程页勾选后不得新增只在完成后才出现的行**：右栏的打卡项与临时任务都曾经在下一次渲染时补一行「完成于 hh:mm」，把下面的分组整体往下推，用户点完一个勾就看见列表跳。完成时间照旧写进数据（`rec.time` / `doneAt`，打卡页与备份都能看得到），只是不再在日程页显示。要往这个页面加任何「完成后才显示」的信息（时间、备注、复盘摘要），先想清楚它会不会改变行高——改行高就给它一个恒定占位，别复现这种跳动。
- MUI 与 Tailwind 并存，组件内优先沿用邻近文件的既有写法，不为样式引入新依赖。
