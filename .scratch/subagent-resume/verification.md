Status: resolved

# Subagent Resume — 集成验收

2026-10-05。四张工单在独立受管 worktree 中使用 implement / tdd 完成，按 01 → 02 → 03 和独立 04 的依赖图集成；本次验收包含 main 的 Rewind 提示浮层修复。

## 验证结果

- 完整检查：`env -u NO_COLOR caffeinate -is bun run check`，exit 0，1622 pass / 0 fail，8542 expects，121 files。日志：`/tmp/neant-subagent-resume-review-fixes-check-final.log`。
- 最终相关回归：97 pass / 0 fail，710 expects，11 files；类型与 Knip 检查 exit 0。完整检查之后只补强测试断言，生产代码未变，最终相关回归和类型检查覆盖补强。日志：`/tmp/neant-subagent-resume-review-fixes-focused-final.log`。
- 面板同步反馈环：旧用例在第 16 次复现，确认两个 child 的模型请求仍活跃，修正为等待真实请求身份与可见终端帧；100 次通过，未使用 sleep。日志：`/tmp/neant-resume-review-panel-stress-green.log`。
- 公共验收入口保持为 Core 的 createSession + 可控模型 + 真实临时 Store，以及 TUI 的实际 main/start + 虚拟终端。覆盖真实 SIGTERM 收束、回调 dispose、Hook、首次真实输入摘要、只读子文件字节、损坏隔离、branch/fork、未知工具结果幂等与不重放、send_message 原 id 和父 Checkpoint。

## 独立两轴审查

- 固定比较点：main `c3f7bfdfedf51c899cd06dd58a5c895e57a0000b`；最终实现 HEAD：`a3291604a1b294ba412eb2177184ce478e558a7b`。
- Standards 初审 1 项：Session Resume / Unknown Tool Outcome 缺少概念目录。修复后领域实现分别置于对应目录的 index，Session 保留生命周期接线；复核 0 项文档标准违反、0 项新增 smell。
- Spec 初审 1 项 P2：无关子代理更新覆盖已核对子 Run 的历史结局。修复后事件更新与初始化共用公开 recovery，按 child id + Run id 匹配；复核 0 项剩余发现，未发现其他缺失要求或 scope creep。
- Spec 独立重跑新增公共 TUI 回归：2 pass / 0 fail，24 assertions；日志：`/tmp/neant-spec-review-history-recheck.log`。
- 全部发现由同一个 implementer 子代理修复；实现修复及红绿证据见 [review-fixes.md](review-fixes.md)。
