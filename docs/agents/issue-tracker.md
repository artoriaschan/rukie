# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as one plain `Status: <value>` line near the top of each spec and issue file: a role string from `triage-labels.md`, `claimed`, or `resolved` (the only closing status besides `wontfix`). Blocking uses a plain `Blocked by: NN, NN` line
- Set the spec to `resolved` in the same change that closes its last open ticket
- `bun run check:scratch` enforces these rules and runs in `check:dev`; `bun scripts/check-scratch.ts --report` prints per-feature progress and open tickets, so use it instead of grepping `.scratch/` for status
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

`resolved` 表示实现、受影响文档、评审修复和适用的本地验证已经完成，不代表 CI 已通过或 PR 已合并。最终推送前在同一变更中关闭最后一个 ticket 和 spec，完成 ADR Coverage，并记录本地验证结果及 CI 待验收状态。推送后的 CI 结果保留在 PR checks、PR 描述或交付回复中；仅为补写成功结果无需再提交 tracker 文档。CI 失败后修复并重新验证；若失败暴露未完成的票内要求，将对应 ticket 和 spec 恢复为 `claimed`，直到要求完成。

resolved 记录中的路径以当时的提交为准。

## ADR coverage before delivery

新建或重新推进交付的 spec 使用 `## ADR Coverage` 记录架构决定的归属。设计阶段确认一项长期取舍时就补录，实施改变取舍时同步更新；将 spec 设为 `resolved` 前，完成下列审阅。已有历史 resolved 记录在本次重新维护时补齐。

1. 对照 spec 的 Implementation Decisions、实施票与最终 diff，逐项检查模块所有权、依赖方向、授权与信任、持久化与恢复、资源生命周期及外部协议取舍。
2. 每项取舍关联新增、更新或沿用的 ADR，说明归属理由。改变既有决定时按 [ADR 维护规则](../adr/README.md)记录替代关系。未确认的决定保留 proposed 和确认条件；交付依赖尚未确认的决定时，先解决该决定再关闭 spec。
3. 局部文案、样式或机械调整可记录“无需 ADR”，说明具体原因；整项工作没有长期架构取舍时也写一条原因。已有 ADR 覆盖的决定使用“沿用”并给链接。填写理由时说明实际选择，避免只写“已同步文档”。
4. 审阅者核对表中链接、状态、取舍与最终实现，检查是否遗漏决定或与既有 ADR 冲突；将结论及修正记录写入交付证据。工单可以引用 spec 的覆盖记录，独立引入的取舍先补回 spec。覆盖记录与审阅结论完成后再关闭 spec。

spec 中的骨架如下；相对链接从该 spec 所在目录计算：

```markdown
## ADR Coverage

| 决定或修改       | 归属                                                      | 理由                             |
| ---------------- | --------------------------------------------------------- | -------------------------------- |
| 长期架构取舍摘要 | 新增／更新／沿用 [相关 ADR](../../docs/adr/NNNN-topic.md) | 选择与该 ADR 的关系              |
| 局部修改摘要     | 无需 ADR                                                  | 为什么没有引入或改变长期架构取舍 |
```

代理在用户已授权的设计和交付范围内主动执行这一步，无需等用户再次调用文档 skill。`check:scratch` 检查工单结构和状态，`check:docs` 检查维护文档格式与链接；目前两者都不检查这张覆盖表，也不判断是否漏写架构决定。覆盖完整性由上述交付审阅负责。

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
