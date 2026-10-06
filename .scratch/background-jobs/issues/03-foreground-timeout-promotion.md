# 03: 前台超时转后台

**What to build:** 前台 bash 超时后不再被杀，而是转为 Background Job，模型拿到 job id 后可以继续读取或终止。详见 [后台 bash spec](../spec.md) 的 bash 工具一节。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 超时后返回 `[still running after <s>s; moved to background job <id>]` 加 harness 的说明文字，进程继续运行
- [ ] 转入后台不受每个 owner 10 个的上限限制
- [ ] 在超时前结束的前台命令不出现在 `job_list` 里，结果格式与 01 一致
- [ ] 前台调用被 abort 时仍然杀掉它的 job
- [ ] 现有的"bash 超时返回错误"e2e 按新行为更新；新增 e2e：转入后台后 `job_output` 能读到后续输出，`job_kill` 能终止它
