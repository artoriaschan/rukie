# 13: async 与 asyncRewake

**What to build:** 日志、通知类 command hook 在后台运行不拖慢 agent；后台检查发现问题时可以把 agent 叫回来。见 [spec](../spec.md)「执行与协议」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `async: true`：立即返回，不参与决定，不受超时约束；完成后的 `additionalContext` / `systemMessage` 在下一次模型调用前注入。
- [ ] `asyncRewake: true`：后台完成且 exit 2 时，session 空闲则以 stderr 作为 user 消息起新 run，run 中则 steer。
- [ ] `dispose()` 存在时（05）中止仍在跑的 async hook；05 未落地时不阻塞本票。
- [ ] Agent Core e2e：async hook 不阻塞工具调用、结果下一次注入、asyncRewake 在 run 中 steer。
