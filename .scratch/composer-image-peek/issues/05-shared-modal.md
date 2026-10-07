# 05: 点击复用消息流预览弹窗

Status: resolved
Blocked by: 04

## Request

用户要求输入框图片点击预览复用消息流预览弹窗，并保留点击高亮。

## Acceptance

- [x] 点击绑定 token 使用既有模态 ImagePreview、控件及键盘/鼠标关闭路径。
- [x] 当前草稿绑定图片形成图集快照，翻页同步 token 高亮。
- [x] 关闭保留草稿及 Run，Enter 关闭不提交，关闭后同 token 可重击。
- [x] 光标被动预览与既有拦截条件保留，字面 token 不激活。
- [x] 相关公共 e2e、文档和最终门禁完成，证据见 review.md。

## Verification

先修改公共点击 e2e 要求 Open original 控件，基线失败（102.78ms）；实现后相关 5 文件 33 pass / 0 fail，175 assertions，6.76s。新增/修改点击场景均低于 400ms。最终聚合结果记录于验收文件。
