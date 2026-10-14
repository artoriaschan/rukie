# 04：编辑项目与移除确认

Status: resolved

Blocked by: 02, 03

**What to build:** 按 [spec](../spec.md#编辑项目c29与移除确认c31)，实现编辑项目弹窗 C29 与移除确认 C31，接入 `project.update` / `project.remove`，并替换欢迎页的“项目目录”入口。

- [x] C29：520px，预填名称与目录，复用 03 的目录行与“添加文件夹”；底栏为“移除本地项目”（实心 destructive）、“取消”与“保存”；无修改或空名称时禁用保存
- [x] 保存时，已信任项目新增目录先打开 C28（“信任并保存”），确认后带 `trusted: true` 提交；其他情况直接提交；冲突与保留目录以 alert 显示；取消、关闭或按 Esc 放弃修改
- [x] 欢迎页 Project 下拉的“项目目录”改为“编辑项目”并打开 C29，删除旧的只读目录弹窗
- [x] C31：448px，标题“移除 {name}？”，参考截图的说明文案，ghost“取消”与柔和 destructive“移除项目”（`destructive-soft` token）；确认后发送 `project.remove` 并关闭两层弹窗；取消返回 C29
- [x] 项目下有执行中或等待交互的 Session 时禁用“移除本地项目”并说明原因；`session_busy` 兜底显示 alert
- [x] 移除后，属于该项目的当前会话保持打开，标题栏与侧栏按“对话”呈现
- [x] zh 与 en 文案同步
- [x] 扩展 fake wire helper（`project.update` / `project.remove`）；按 spec 补充编辑、信任提升、主目录接任、最后一个目录、移除确认与忙碌禁用的浏览器用例

## Comments

- 2026-10-14：新的实现子代理在独立工作树 `shell-palette-04/rukie`、分支 `feat/project-edit-remove` 接手，基于 03 集成 `f3934f47`。沿用 spec 已确认的 App/wire/store 测试接缝，验证记录见 `/tmp/rukie-shell-palette-evidence/ticket04.md`；包级与手工 GUI 验收由 06 统一执行。

- 2026-10-14：实现完成：`ProjectEdit` 持有名称、目录与主目录草稿，复用 C28 与目录行，编辑统一提交 `project.update`；移除经 C31 提交 `project.remove`，忙碌原因与服务端兜底本地化，欢迎页入口替换。新增中英文文案，删除旧目录弹窗及旧文案键。C31 长名称单行截断且保留完整可访问标题与固定关闭按钮；删除聚焦目录后将焦点交回编辑名称，保持 Esc 取消。项目表单组合已安装 beUI 控件与 ScrollArea，因为 registry 没有整个 Project 草稿表单角色。
- 2026-10-14：公开 App/wire 浏览器证据按差异组合覆盖 16 个新用例及 4 个既有受影响用例：编辑保存/禁用、受信任新增确认与 Cancel/Close/Esc 草稿保留、未信任新增、错误、目录接任与最后目录、编辑取消、移除保留置顶/归档、当前 Session/Transcript 保留、busy 禁用与兜底、pending 与不支持 picker、Light1280/Dark420 几何长标题。每轮 red/green、失败原因、耗时与精确命令保留在外部验证记录；不将增量通过称为最新版本整包通过。
- 2026-10-14：适用 scoped lint、ui 类型、文档检查150文件与格式/diff 通过，集成分支仍为 `f3934f47`，合并检查 Already up to date。沿用 spec ADR Coverage 的 ADR0041/0039/0035，局部编辑呈现未增加架构取舍。全量评审、整包、手工 GUI/截图、PR/CI 由 06/主代理负责；未启动 Electron、未使用真实凭据或 Session。
- 2026-10-14：影响发现留给新的最终评审修复代理：UI 已不使用 `project.setPrimary`，shared/server/fake helper 的旧命令需要按单一路径规则清理，独特主目录用例迁移至 `project.update`。另需检查 C27 删除聚焦目录后 Esc 的焦点交接：04 已修复 C29，03 没有覆盖该 C27 路径，尚未复现，避免将其记为已修复。
