# Session Store：headless 用 JSONL，桌面端用 SQLite，两者共用一个接口

两种存储都实现 pi-agent-core 的 session repo 接口。headless CLI 使用 pi 自带的 `JsonlSessionRepo`（v3 格式），文件存放在 `~/.neant/sessions/<项目路径 slug>/<id>.jsonl`。桌面端自己写一个基于 `bun:sqlite` 的实现，不用 `pi-session-backend-sqlite-node`，因为那个包面向 Node，而 agent 跑在 Bun 上。之所以 headless 不直接用 SQLite，是因为 JSONL 便于直接查看、diff 和脚本处理，也不依赖数据库文件。
