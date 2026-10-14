/*
 * DayMark 的 C4 结构源（Structurizr DSL）
 *
 * 这份文件与 README.md / persistence.md / sync.md / stats.md 描述同一套结构，
 * 差别只在形式：那几篇讲「时序与不变式」，这里给「静态边界与依赖方向」。
 *
 * 渲染方式：Structurizr CLI（`structurizr export -inputFile daymark.dsl`）
 * 或 Structurizr 的 IDE 插件 / Web 服务。日常阅读直接用 Markdown 里的 Mermaid 即可，
 * GitHub 原生渲染，不需要额外工具。
 *
 * 与代码冲突时以代码为准；行号级的事实来源写在四篇 Markdown 里。
 */
workspace "DayMark" "本地优先的打卡 / 待办应用：渲染层 React 18 + Vite 4，桌面层 Electron 44，可选坚果云 WebDAV 同步" {

    model {
        user = person("使用者", "在浏览器或桌面窗口里打卡、记待办的人")

        daymark = softwareSystem("DayMark", "localStorage 为运行时真相，桌面版全量落盘为文件快照") {

            renderer = container("渲染层", "React 18 + Vite 4，构建为单文件 HTML", "JavaScript") {
                ui = component("pages + components", "打卡 / 待办 / 日程三页与图表、同步面板", "React")
                storage = component("src/utils/storage.js", "localStorage 唯一读写入口；SCHEMA_VERSION 迁移；统计口径唯一实现", "JavaScript")
                persistence = component("src/utils/persistence.js", "只决定「何时落盘」：ready 闸门、300ms 防抖、beforeunload 同步兜底", "JavaScript")
                backup = component("src/utils/backup.js", "全量 CSV / JSON 导出与 merge / replace 恢复，含公式注入护栏", "JavaScript")
            }

            preload = container("electron/preload.cjs", "contextBridge 白名单：唯一的进程边界", "JavaScript")

            mainproc = container("主进程", "Electron 44，只用 Node 内置模块，运行时不读 node_modules", "JavaScript") {
                mainjs = component("electron/main.js", "IPC 落地、原子写快照、自动同步排期、单实例锁、冒烟 userData 隔离", "JavaScript")
                webdav = component("electron/webdav.js", "WebDAV 协议 + 纯决策函数 planPull / planPush / resolveLatest", "JavaScript")
                config = component("electron/config.js", "配置读写（纯 Node）：密码 codec 加解密、publicConfig 抹密码", "JavaScript")
            }

            disk = container("userData 目录", "daymark-snapshot.json、daymark-config.json、daymark-snapshot.conflict-*.json", "文件系统")
            cloud = container("坚果云 WebDAV", "dav.jianguoyun.com/dav/，Basic 认证，20 秒超时", "WebDAV")
        }

        regression = softwareSystem("verify 回归套件", ".workbuddy/verify-*.mjs，esbuild 打包后以纯 Node 运行，用本地 mock 服务替代真实坚果云", "Node.js") {
            external = true
        }

        user -> ui "打卡、记待办、看统计"

        ui -> storage "读写数据、取统计口径"
        backup -> storage "导入导出经同一套键名"
        storage -> persistence "onDataWritten 通知「数据变了」（单向，storage 不 import persistence）"
        persistence -> preload "buildSnapshot() 交出去落盘"
        preload -> mainjs "window.daymark（invoke；beforeunload 走 sendSync）"
        mainjs -> webdav "调用纯决策函数，只负责执行动作"
        mainjs -> config "readCfg / writeCfg，注入 safeStorage codec"
        mainjs -> disk "writeSnapshotRaw：.tmp + 同卷 renameSync 原子写"
        webdav -> cloud "MKCOL / PUT / GET"
        webdav -> disk "readLocal：解析失败视为本机为空"
        mainjs -> cloud "同步完成后写回 syncedAt"

        storage -> regression "被断言：分母口径、连续天数、isPastDue、提醒排序"
        persistence -> regression "被断言：ready 前不落盘、防抖合并、同步兜底"
        webdav -> regression "被断言：冲突决策、备份留档与清理、超时、URL 编码"
        config -> regression "被断言：字段贯通、空密码保持原值、密文迁移、回显无密码"
    }

    views {
        systemBoundary daymark "系统上下文与边界" {
            include *
            autoLayout
        }

        container daymark "容器：进程与数据边界" {
            include *
            autoLayout
        }

        component mainproc "主进程内部：决策与执行分离" {
            include *
            autoLayout
        }

        component renderer "渲染层内部：storage 是唯一真相入口" {
            include *
            autoLayout
        }

        styles {
            element "Person" {
                background #3fb950
                color #0d1117
            }
            element "Software System" {
                background #0d1117
                color #e6edf3
            }
            element "Container" {
                background #161b22
                color #e6edf3
            }
            element "Component" {
                background #1f6feb
                color #ffffff
            }
            element "regression" {
                shape Hexagon
                background #30363d
                color #e6edf3
            }
        }
    }
}
