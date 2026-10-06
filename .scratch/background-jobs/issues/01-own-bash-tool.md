# 01: 自研 bash 工具（前台行为不变）

**What to build:** 用 Agent Core 自研的 bash 替换 pi `createBashTool`（ADR-0010），为后面的 Background Job 准备好单一执行路径。模型侧行为与现在一致，只多 `description`（必填）和 `workdir` 两个参数。详见 [后台 bash spec](../spec.md) 的 bash 工具一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 命令以 detached 方式在独立进程组中启动；终止时先向进程组发 SIGTERM，3 s 后发 SIGKILL
- [ ] 参数为 `command`、`description`（必填）、`timeout?`（秒，默认 120，上限 600）、`workdir?`（相对 session cwd 解析）；`run_in_background` 暂不加
- [ ] 截断规则、spill 路径提示、退出码非 0 报错、`(no output)`、超时报错、abort 报错与现有 pi 行为一致；复用 pi 的 truncate / output-capture 工具函数
- [ ] 删除 pi bash 的接入代码与 120 s 包装，只留一条执行路径
- [ ] 现有 bash 相关 e2e（超时、abort 杀子进程、权限规则、hooks、full-access）不改断言，全部通过
- [ ] 新 e2e：`workdir` 生效；abort 时孙进程也被终止；缺少 `description` 时返回参数校验错误
