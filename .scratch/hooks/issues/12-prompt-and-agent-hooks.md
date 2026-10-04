# 12: prompt 与 agent hook 类型

**What to build:** 用户写一句自然语言规则，由 LLM 判定是否放行；需要看代码时可以用一个只读小 agent 核查。见 [spec](../spec.md)「执行与协议」。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] prompt：`$ARGUMENTS` 替换为输入 JSON，单次调用 review model（`model` 覆盖时解析该模型），输出 `{ ok, reason? }`；`ok: false` 视同 deny / block。默认超时 30s。
- [ ] agent：以 read / glob / grep 跑一个无 transcript 的临时 run，最终输出 `{ ok, reason? }`。默认超时 60s。
- [ ] 输出解析失败为非阻断错误。
- [ ] Agent Core e2e 用 `fakeModel` 脚本化 review 回复，覆盖放行、拒绝、坏输出。
