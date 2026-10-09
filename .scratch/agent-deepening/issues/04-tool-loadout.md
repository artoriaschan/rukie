# 04: Tool Loadout

**What to build:** `session/tools.ts` 吸收 `rebuildTools`、`refreshChildTools`、`childLoadout`、声明 diff、MCP drift 判定与子代理排除名单，root 与 child 共用；不新增缓存。详见 [spec](../spec.md)。

Blocked by: 03

Status: ready-for-agent

- [ ] Session 不再直接调用 `planToolSearchLoadout`
- [ ] `tests/session/tools.test.ts` 覆盖排序、替换、child 限制与延迟阈值
- [ ] tool-declarations、tool-search、tool-search-children e2e 通过
