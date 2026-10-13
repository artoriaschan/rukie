# 04：永久删除 Session

Status: resolved

Blocked by: 01

**What to build:** 按 [spec](../spec.md#永久删除) 让用户从会话菜单经确认后永久删除 Session，移除其全部存储与外部文件。

- [x] Agent Core store 能力新增删除接口：先取得写入租约确认无其他宿主占用，再删除根 Session 存储目录（含共用存储的子代理）及数据根下该 Session 的 `attachments/` 与 `file-history/`；路径解析保持在数据根内；租约被占用时返回 session-busy 且不删除任何文件
- [x] 新增 wire 命令 `session.delete { sessionId }`：拒绝执行中或有挂起交互的 Session；已在本服务打开且空闲时先关闭并释放租约；删除后从 `pinned` 与 `archived` 移除该 id，发出 `sessions_changed`，删除当前 Session 时携带 `closedSessionId`
- [x] 确认对话框遵循 DESIGN.md 对话框规则，写明不可撤销，确认按钮为危险样式；取消不发送命令
- [x] 会话行右键、行内更多与标题栏“会话更多”加入“永久删除”，危险色；执行中或等待确认时禁用；删除当前 Session 后回到首页新聊天
- [x] zh 与 en 文案同步
- [x] 测试：store 层覆盖删除后列表不再出现、子代理与外部文件被移除、租约占用时不删除、不越出数据根；server 测试覆盖删除、置顶与归档清理、执行中拒绝、已打开空闲 Session 的关闭与 `closedSessionId`；shell browser 覆盖确认与取消、禁用状态、删除当前 Session 后回到新聊天

## Answer

Core 公开 `deleteSession` 在写者租约内验证 metadata 身份与所有规范路径，再永久删除根 Session 目录（共用存储的子代理、Transcript、tasks、输出）和根下该 id 的 attachments/file-history。缺失、cwd 不匹配、符号链接重定向（含内部存储、协调目录/文件与悬空链接）或占用在破坏操作前拒绝；忙碌时文件保持不变。所有写入入口与 busy 探测改用数据根 `.session-leases/` 中按规范存储目录哈希标识的永久协调文件，删除不会让其他进程锁住新 inode；等待中的打开取得租约后重查存在性，不重建已删除的 Session。协调文件没有 Session 内容；升级前关闭使用旧目录内 mutex 的宿主，不提供跨旧协议互锁。

Wire `session.delete` 在整个命令期间阻止该 Session 的新 prompt、订阅和其他命令，拒绝执行、排队、后台 Job、子代理、挂起 Interaction、打开过程或其他命令准入。已打开空闲 Session 先关闭、释放租约并撤销订阅，然后删除；仅成功时清理 pinned/archived 并广播带 closedSessionId 的 sessions_changed。三个菜单共用危险删除定义，执行或等待确认时禁用；确认复用已安装 beUI MorphingModal/Button，取消优先聚焦，取消不发命令，提交防重、错误保持，当前删除回新聊天，其他 Session 删除保留当前对话。zh/en 同步。

ADR coverage 已将根目录外永久协调 lease 的 inode/存在性取舍补充到 ADR-0035，并修正 spec 对应覆盖行；保留原 Harness/storage/单写者执行契约。API 契约在 Agent、server、UI README/JSDoc；无需新布局或组件来源决定。spec 状态保持 claimed，整体闭环归 ticket06。

已执行的局部验证与实际结果：

- `env -u NO_COLOR bun test packages/agent/tests/e2e/desktop-sqlite.test.ts packages/agent/tests/e2e/session-title-store.test.ts packages/agent/tests/e2e/session-store-ownership.test.ts`：17/17 通过，11.66s。涵盖 JSONL/SQLite normal create/resume/rename、busy 只读探测与 snapshot、同进程/跨进程单写者、实际删除与 Resume 竞争、规范路径别名、全部新删除能力。根目录移除断言补充后，仅 root delete 单例增量 1/1，680ms。跨进程 case 4.10/3.17s 是实际独立进程、SIGKILL、锁竞争与退出的整合成本；无固定 sleep。并发删除获胜时 Resume 可在持锁中返回 busy 或删除后返回 not-found；同时断言存储不重建且完成后的 Resume 明确 not-found。
- Server focused wire 6/6 通过，1.52s：运行、挂起、排队、Job、子代理拒绝；已打开空闲关闭、文件与 pinned/archived 删除、重启持久化及外部宿主 busy。并发 prompt 准入新增后仅 idle delete 单例增量 1/1，255ms；其他成功结果复用。
- Chromium shell focused：当前删除与三入口禁用 2/2，4.03s；既有 hover/focus/context/pin 菜单消费者与禁用 2/2，3.12s；中文 busy 失败保持、重复提交与其他选择保留 1/1，2.57s。缺失菜单 TDD red、错误 accessible name 的失败与修正记录保留在协调日志；不把失败的初次 run 描述为通过。
- `bunx --no -- tsc -b packages/agent packages/server packages/ui` 通过。变更文件格式、lint、文档与最终差异检查的结果在下方最终证据补充。

完整命令、失败历史、时间、状态与日志归外部协调验证记录 `/tmp/rukie-session-sidebar-evidence/04-verification.md`。ticket06 负责 aggregate static、desktop package、最终 agent-browser，并因这次共享 lease/lifecycle 变化运行一次完整本地 check；本票不重复其验收，不声称 CI/发布已完成。

最终硬化与集成证据：根路径别名仍共用锁；内部 Session 父目录、storage 文件、`.session-leases` 目录/文件（含悬空 mutex）拒绝为同一物理存储产生第二把锁或创建外部文件。公开 guard TDD red 证明原打开会成功，硬化后 3/3 通过。受影响 Core normal open/resume/rename/busy/delete 与真实进程 lease 最小范围 11/11 通过，13.20s；删除可选目标的悬空链接补充单例 1/1，59ms。此范围替代失效的旧 lease 证据，其他只读/恢复/UI 行为证据复用。

已 fast-forward 合并当前集成 `9e6e2916`（ticket05），stash 恢复本票改动无冲突，保留搜索浮层和独立 opener refs，以及本票删除 callbacks/dialog；所有 Search chats 标签一致。组合 App/menu 范围与类型结果归最终记录，不能因无冲突合并自动声称整体验收通过。

最终局部结果：合并 ticket05 后仅组合 App/menu/delete/archive 4/4 通过（8.05s），`tsc -b packages/agent packages/server packages/ui` 通过；变更 21 文件 oxfmt、变更 TS/TSX oxlint、`check:docs`（147 Markdown）、`check:scratch` 与 `git diff --check` 通过。未运行 package/aggregate/manual browser；由 ticket06 按协调记录执行。
