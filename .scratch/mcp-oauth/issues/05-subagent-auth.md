# 05: 子代理授权

**What to build:** 子代理遇到需要授权的 server 时，也能通过 `authenticate` 请用户授权，授权面板经父 session 转发给用户；授权结果父子共用。详见 [MCP OAuth spec](../spec.md) 的 Interaction 回调一节。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 子代理（`subagent` / `subagent_fork`）在 needs-auth 时拿到伪工具；它的 `onMcpAuth` 请求经父 session 的顶层回调转发，带上 `origin`
- [ ] 子代理授权后，父 session 的下一个 run 直接可以使用该 server，不再交互
- [ ] Headless 下子代理同样没有伪工具
- [ ] e2e：参照 `subagent-permissions.test.ts` 中 `origin` 转发的写法
