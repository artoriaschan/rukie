# 04：`host.*` wire 命令与 Electron 迁移

Status: ready-for-agent

**What to build:** 按 [spec](../spec.md#wire-命令) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#原生能力)，sidecar 提供选择文件夹、在 Finder 中显示、在终端打开；Electron 与浏览器共用显示与终端路径。

- [ ] `WireCommandSchema` 新增 `host.pickFolder`、`host.revealPath`、`host.openInTerminal`
- [ ] 路径必须为已存在的绝对路径；显示与终端只接受已登记项目根、无项目会话 workspace 及其子路径
- [ ] macOS：`osascript` 固定脚本源选择文件夹、`open -R`、`open -a Terminal`；Linux：`xdg-open`（显示文件时打开所在目录），选择文件夹返回 `unsupported`；Windows：`explorer /select,` 与默认终端，选择文件夹返回 `unsupported`；全部参数向量执行，不经 shell
- [ ] 浏览器 host 实现 `pickProjectFolder`；`unsupported` 与取消时界面退回手动填写路径
- [ ] `revealPath`、`openInTerminal` 移出 `DesktopHost`，app 经 wire 调用；删除 main 的 IPC 与 preload 暴露。Electron 保留窗口内 `pickProjectFolder`
- [ ] server 测试通过注入的执行接口验证参数向量与路径限制，不真实弹窗或启动进程；ui Chromium 测试覆盖成功、取消、unsupported；desktop 测试验证 IPC 已删除
- [ ] 更新 desktop、ui README 中 `DesktopHost` 能力说明
