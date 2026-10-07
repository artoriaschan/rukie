# pi-durable 1.0.4 Bun 可行性探针

这是 [01 工单](../issues/01-bun-feasibility.md)的隔离执行门槛。它不导入 Rukie 生产模块，不访问用户配置、凭据或 Session 根目录。测试只通过精确发布包的公开 Harness、Conversation、tools、env、documents 和 events 入口观察行为。

## 运行

从本目录执行：

```sh
rtk proxy bun install --frozen-lockfile --ignore-scripts
rtk proxy bun run typecheck
rtk proxy bun test probe.test.ts
```

目标包 pi-durable、pi-ai、pi-mcp、Chord 均直接固定 1.0.4，传递 pi-telemetry 用 override 固定 1.0.4，TypeBox 固定 1.3.27。锁文件保存实际解析。开发用 TypeScript 与 Bun types 只属于探针。所有 Pi 包声明 Node >=22.19.0；这里以 Bun 1.4.2 实际执行验证相关公开 API，不把 Node engines 字段当作 Bun 兼容承诺。安装跳过生命周期脚本；本门槛不依赖 Google SDK 的 no-op preinstall 或 protobufjs postinstall。

## 当前证据

2026-10-08：Bun 1.4.2 (744846f84)，11 项测试、52 条断言通过，总计 1.420 秒。8 个独立进程场景分别约 152–167 毫秒，真实进程成本是恢复验收的一部分，其余案例 9–43 毫秒。typecheck 退出码 0；pi-mcp 公共入口在 Bun 下导入成功（18 个导出）。未调用真实模型或 MCP 服务。

- `smoke` 用 fsync JSONL 完成 open、提交、流式 watch、实际原生 write 工具、wait、typed document、close、reopen；相同 requestId 返回原 submission ID。宿主直接使用 NodeExecutionEnv 读取实际写入内容。
- `worker.ts` 在已提交输入、已提交模型 partial、beforeTool 等待、已提交工具 intent/输出、已提交结果等屏障发布 READY。父进程收到 READY 才 SIGKILL，然后以另一个进程重开同一 storage。safe intent 在当前定义也 safe 时重跑一次；默认 unsafe 不执行，保留 committed output 并给 interrupted。stored safe/current unsafe 和 stored unsafe/current safe 都不重跑。结果已提交时不重复执行。
- 异步 beforeTool 等待期间原生 close 中断当前 invocation，保持 pending input/tool；重新打开后重新执行当前 hook，工具仅执行一次。等待 callback 自身没有持久化审批语义。独立进程 beforeTool 场景也证明同样的恢复边界。
- 空 Conversation 在 close/reopen 后只读 inspect 不创建模型请求；未提交工作不凭空产生。rewindable document 的 snapshotAsOf 与 fork `asOf` 得到历史值，原 Conversation 保留当前值。watchEvents 提供当前 snapshot。background task 不阻止普通 idle，也不受普通 Conversation abort 影响；显式 `{ background: true }` abort 终止该 task。

测试用受控 provider 直接推送 partial 事件，无固定 sleep；进程场景用 stream READY 与 process exit 同步，5 秒 deadline 仅为故障界限。finally 终止并等待所有仍存活的 worker，删除每个临时 storage/cwd。测试文件的 10 秒 timeout 也是故障界限。

## 后续迁移必须承担的义务

1. exact 1.0.4 的 ToolTask 在 intent 前运行 beforeTool；intent 后恢复直接进入 execute，**不再运行 beforeTool**。安全重放的 execute 路径必须由 Rukie 当前授权检查覆盖，不能只在 beforeTool 放权限检查。内置 write/edit/bash/read 默认 unsafe；不因为工具名或可读性扩大 safe 范围。
2. 原生 hooks 不是可恢复审批/问题协议。Rukie extension 可以在 `api.commit` 写 typed documents 和阶段，用稳定 requestId 提交 input；恢复时需重新判定、重新发起并失效旧 callback。execute 中的 Interaction 必须明确持久化阶段和安全重放义务，不能凭本探针声称已交付产品恢复。
3. `defineTask`、`tx.createTask`、task ownership、`background`、owned Conversation、waitForTask/getTask 与稳定 submit requestId 可组装后台 anchor 和 reporter；本探针验证后台任务边界，但未实现产品子代理/reporters/整次请求结算。原生 `close` 保存 pending work；`abort` 提交取消，两者不同。
4. JSONL 开启 fsync，公开 storage API 没有跨进程锁。迁移宿主必须另行保证单写者；本探针只在 worker 确认退出后重开。
5. 原生 text read 无图片读取实现；保留自有图片能力。Compaction、真实 OAuth/MCP 传输、自有 shell/jobs、Goal 和 Frontend 集成留给依赖票验收，不将 README 声明算作实测。

所用定义以安装的 1.0.4 发布包为准：`ToolTask` 的 call/execute 阶段、`Conversation.abort/waitForIdle/fork`、`TaskOptions.background`、`TaskRuntime.commit`、`ToolExecutionApi.commit/memo`、`Harness.inspect/submission/resume`、`watchEvents`。未使用私有解析路径、main 分支或旧 harness fallback。当前门槛通过；生产迁移尚未完成。
