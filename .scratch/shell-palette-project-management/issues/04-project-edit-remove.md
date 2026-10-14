# 04：编辑项目与移除确认

Status: ready-for-agent

Blocked by: 02, 03

**What to build:** 按 [spec](../spec.md#编辑项目c29与移除确认c31)，实现编辑项目弹窗 C29 与移除确认 C31，接入 `project.update` / `project.remove`，并替换欢迎页的“项目目录”入口。

- [ ] C29：520px，预填名称与目录，复用 03 的目录行与“添加文件夹”；底栏为“移除本地项目”（实心 destructive）、“取消”与“保存”；无修改或空名称时禁用保存
- [ ] 保存时，已信任项目新增目录先打开 C28（“信任并保存”），确认后带 `trusted: true` 提交；其他情况直接提交；冲突与保留目录以 alert 显示；取消、关闭或按 Esc 放弃修改
- [ ] 欢迎页 Project 下拉的“项目目录”改为“编辑项目”并打开 C29，删除旧的只读目录弹窗
- [ ] C31：448px，标题“移除 {name}？”，参考截图的说明文案，ghost“取消”与柔和 destructive“移除项目”（`destructive-soft` token）；确认后发送 `project.remove` 并关闭两层弹窗；取消返回 C29
- [ ] 项目下有执行中或等待交互的 Session 时禁用“移除本地项目”并说明原因；`session_busy` 兜底显示 alert
- [ ] 移除后，属于该项目的当前会话保持打开，标题栏与侧栏按“对话”呈现
- [ ] zh 与 en 文案同步
- [ ] 扩展 fake wire helper（`project.update` / `project.remove`）；按 spec 补充编辑、信任提升、主目录接任、最后一个目录、移除确认与忙碌禁用的浏览器用例

## Comments
