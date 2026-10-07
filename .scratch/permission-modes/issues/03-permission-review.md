# 03: Permission Review（auto-review 评审）

Status: resolved

**What to build:** `auto-review` 模式下，非只读且未命中 `allowTools` 的工具调用先经一次 Permission Review：安全的直接执行，有风险或评审失败的转为 ask 并附评审理由。Headless CLI 下有风险的即 deny。见 spec Implementation Decisions 的 review 模块与 session 节，以及 ADR-0007。

Blocked by: 01

- [x] 新 review 模块（Agent Core 内独立概念目录），复用 session 的 `streamFn`，模型取 `reviewModel` 否则主模型，`temperature: 0`
- [x] 评审输入：cwd、project instructions、最近 compaction 之后的过滤历史（user 消息 + 历史工具调用名与参数，不含 assistant 文本 / thinking / tool result）、待执行调用（名称、description、参数 schema、实参）
- [x] 固定 review policy：low 必须 allow；medium 仅在用户明确授权动作、目标与范围时 allow；high 一律 deny
- [x] 严格 JSON 解析；非法形状、provider 错误、30s 超时、截断后仍超长（上限为评审模型上下文窗口一半，旧历史先截）均视为失败 → ask
- [x] allow → 执行；deny / 失败 → ask，`PermissionAskRequest` 带 `mode` 与 `reason`
- [x] 用户拒绝后模型只看到"用户拒绝"类结果，不含评审理由
- [x] abort 取消进行中的评审，该调用按 deny；同 turn 多调用并发评审
- [x] `permission_review` 事件（start / end，end 带 risk、decision、reason），stream-json 输出
- [x] 评审 token 不计入 context_usage
- [x] Agent Core e2e 覆盖以上行为（fake model 按 system prompt 区分评审请求与主 turn）

## Comments

2026-10-03：完成。`packages/agent/src/review/index.ts` 独立承载固定 policy、历史过滤、输入预算、严格 JSON 协议与 30s/abort 控制；session 接入评审、mode/reason 和 shared 事件。pi 0.99.2 的并行工具执行会串行准备调用，session 在首个需要评审的 hook 中并发启动同 turn 的有效待审调用，各实际 hook 继续读取当前模式。

评审请求不进入 Transcript，token 不进入 Run usage / Context Usage；deny 或评审失败转 ask，Headless CLI 沿用无回调即 deny，主模型只收到用户拒绝类结果。TUI 的理由标题、两选项和 REVIEW ActivityLine 由票 04 负责。

验证：安全调用、并发评审与独立模型选择先 red 后 green；新增 30 项 Agent Core e2e 与 3 项 Headless CLI stream-json 测试，包含真实 30s 超时、不响应 abort 的 provider、非法/重复 JSON 字段、provider 异常、compaction/resume 过滤、超长截断与 token 隔离。阶段性 `rtk proxy bunx tsc -b` 及定向权限测试通过。最终 `rtk proxy env -u NO_COLOR bun run check` 通过格式、Lint、类型检查、Knip 与全部 463 项测试（0 fail）。

### Standards

独立审查未发现仓库规范违规或需要处理的代码异味。概念目录、公共 index 入口、Bun e2e 边界与 shared 运行时无关约束均符合规范。

### Spec

独立审查未发现缺项、错误实现或范围扩张。前端 test helper 仅适配新增评审请求，未提前实现票 04 的 UI 行为。

审查结果：Standards 0 项问题；Spec 0 项问题。
