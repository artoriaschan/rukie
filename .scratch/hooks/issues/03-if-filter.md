# 03: handler 级 `if` 过滤

**What to build:** 用户在单个 hook 上写一条 Permission Rule（如 `bash(git push *)`），只在命中时运行该 hook。见 [spec](../spec.md)「匹配」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `if` 复用权限规则解析与匹配（复合命令拆段任一段命中、路径规范化）；非法规则加载报错。
- [ ] 仅在工具类事件上评估；写在非工具事件上的 hook 永不运行，加载时告警。
- [ ] `if` 参与去重键。
- [ ] Agent Core e2e：命中运行、未命中不运行、复合命令某段命中运行。
