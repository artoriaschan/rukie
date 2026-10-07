# Tool View 交付记录

日期：2026-10-07。集成分支：`codex/tool-view`。实施基点：`3e8c2a150604a0e68353d556428a357ed5b69074`。最终代码及测试状态：`3fd4fd51c11156c7f6dcd1660abfa0e1b6fd8ad3`；此后的收尾提交只更新交付记录与 spec 状态。

## 交付范围

[Spec](spec.md) 的 11 张票据全部 resolved。Tool View schema、安全 presenter、Session 事件与恢复投影、CLI stream-json 和子代理转发已接通；view 不持久化，Headless text 输出保持既有行为。各内置工具与 MCP 使用结构化呈现事实，TUI 提供分类状态、耗时、折叠与展开、统一特殊工具分流、unified / split diff、语法高亮、Tooltip、文件操作菜单、pending reveal 和完整消息区搜索。

TUI 使用说明见[应用 README](../../apps/neant-tui/README.md)，Core 契约见[Agent README](../../packages/agent/README.md)，renderer API 见[renderer README](../../packages/tui/README.md)。`diffLayout` 与 `foldTerminalCommand` 按用户设置校验，分别默认 `auto` 与 `true`。

## Standards 审查

对实施基点至集成分支的 diff 独立审查，发现两项 P2，均已修复并复核通过：子代理续跑后搜索索引了隐藏旧行，现由渲染与搜索共用可见性投影；新增文字点击 API 命中了被横向裁掉而未绘制的宽字符，现按完整 glyph 的绘制边界准入。公开 continuation 搜索与 renderer 裁剪回归通过，最终无遗留 Standards finding。

## Spec 审查

独立审查发现四项 P2，均已修复并复核通过：完成或恢复的 edit 缺少结果事实时，回退为原始参数标题与原始结果；read 截断披露和 bash 完整输出路径在折叠与 400 行窗口外保持可见；网页 Markdown 的已绘制非空白文字支持单卡展开；todo、question、plan、subagent 系列事件提供 `kind: task`。原审查者复验 30 项测试、88 个断言通过，最终无遗留 Spec finding。

## 验证

开发阶段按票据运行公开 `createSession` / fake model、`start` / headless terminal 与真实 CLI 子进程测试；计时交互使用虚拟时钟。主代理独立复验了契约、diff、展开、工具 presenter、分流、语法色、Tooltip、文件菜单、reveal、搜索及审查回归。各票据保留具体命令、红绿证据与用例耗时。

最终 `env -u NO_COLOR bun run check` 在隔离的临时 HOME 下运行，并使用 `caffeinate -is` 保持执行：格式、Oxlint、TypeScript、Knip 全部通过；2587 pass、0 fail、14425 个断言，196 个文件，测试阶段 70.84 秒。

首次完整检查为 2586 pass / 1 fail：旧恢复测试将新增 view 的 `Session.messages` 投影直接与原始持久消息比较。聚焦复现后仅调整该测试，保留原始事实的严格相等断言，另行验证重算 view、不持久化 view 和重复恢复后存储不变；该文件 5 项测试通过。因首次交付检查失败，修正并集成后重跑上述完整检查，结果全通过。最后的记录提交不改变已验证代码。

## 集成与清理

所有实施票按依赖图在独立分支和 worktree 实现，交付前同步集成分支，经 merger 子代理逐次合并；双轴审查的修复由同一个实现子代理完成。本轮实施 worktree 和已合并的实施分支在最终检查后移除，保留 `codex/tool-view` 及原有其他 worktree。未创建远端 PR；本仓库通过本地 Markdown 票据关闭工作。
