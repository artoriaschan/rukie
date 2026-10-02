# 03: 状态行渲染与接线

Status: ready-for-agent

**What to build:** 用户可见的工作状态行，见 spec ③④ 节。

- `components/activity-line/` 的 `ActivityLine` 负责帧、扫光和 subtle 色的 suffix，单行截断。
- `conversation.ts` 把事件喂给 02 的 reducer，并跟踪 `↑` / `↓` token。
- `index.tsx` 把状态行放在输入框上方，suffix 为 `· ↑ … · ↓ … tokens · esc 中断`，并派发 `approval-open` / `approval-close`，按 `nextWakeAt` 刷新。
- 启动时读一次 git 分支。
- `StatusLine` 删掉 `Running` / `Ready`。

**Blocked by:** 01, 02

- [ ] Run 进行中显示状态行；结束后显示 done 行，下次提交时替换；启动后首次提交前不显示
- [ ] 流式过程中 `↓` 增长，`message_end` 后校正为真实 usage
- [ ] 权限对话框打开时显示"在等你点头"
- [ ] 状态栏不再出现 `Running` / `Ready`
- [ ] 冒烟测试：首格为月相帧、文字加粗、suffix 为 subtle 色、超宽时单行截断
- [ ] e2e：用假 `streamFn` 跑一次带工具的 Run，断言状态行和 done 行
- [ ] 手动运行 `neant` 确认扫光、帧和颜色
- [ ] `bun run check` 全绿
