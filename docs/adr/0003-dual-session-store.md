# Session Store：headless 用 JSONL，桌面端用 SQLite，两者共用一个接口

两种存储都实现 pi-agent-core 的 session repo 接口。headless CLI 使用 pi 自带的 `JsonlSessionRepo`（原生 v4 格式），文件存放在 `~/.rukie/sessions/<项目路径 slug>/<时间戳>_<id>.jsonl`，slug 和文件名由 pi 生成。桌面端自己写一个基于 `bun:sqlite` 的实现，不用 `pi-session-backend-sqlite-node`，因为那个包面向 Node，而 agent 跑在 Bun 上。之所以 headless 不直接用 SQLite，是因为 JSONL 便于直接查看、diff 和脚本处理，也不依赖数据库文件。

2026-10-01 核实锁定的 pi-agent-core 0.99.2：`JsonlSessionRepo` 新建文件使用 v4，读取旧 v3 文件后首次写入会升级为 v4。经确认采用该原生格式，不另外实现 v3 编码。Agent Core 的 `SessionStore` 类型只要求 repo 的 `create`、`open`、`list` 能力；所有消息追加到唯一的 `main` 分支，Run 结束后关闭存储 Session，repo 的生命周期仍由调用方管理。
