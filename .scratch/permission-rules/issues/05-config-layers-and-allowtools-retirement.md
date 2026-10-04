# 05: 配置层级与 allowTools 退役

**What to build:** 项目 `.neant/settings.json` 的 `permissions.deny` 和 `ask` 总是与用户层合并；项目层的 `permissions.allow` 只在 Trusted Project 下生效，否则丢弃并警告（与项目级 `.mcp.json` 共用同一个信任判定）。这修掉了项目级 `allowTools` 可以放宽权限的漏洞。`allowTools` 退役：任一层出现时报错，提示迁移到 `permissions.allow`。CLI / TUI 的 `--allow-tools` 参数名不变，改为接受规则语法，作为会话级 allow 规则传给 session 的 `allowRules` 选项；规则非法时启动失败，并指出来源 `--allow-tools`。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「配置层级与来源」；User Stories 19–23。

- [ ] settings 测试：用户层与项目层的 deny / ask 合并；非 trusted 时项目 allow 被忽略并告警；trusted 时生效
- [ ] settings 测试：任一层出现 `allowTools` 都报错，错误含文件路径和迁移提示
- [ ] session 选项 `allowTools` 改名为 `allowRules`；代码中不再有 `allowTools` 的读取路径（contract）
- [ ] CLI 与 TUI 测试：`--allow-tools 'bash(git status*)'` 生效；非法规则报错
- [ ] `loadSettings` 注释与实际行为一致
- [ ] `tsc -b` 与全量 `bun test` 通过
