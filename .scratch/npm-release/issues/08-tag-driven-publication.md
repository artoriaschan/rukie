# 08：tag 驱动完整发布路径

Status: ready-for-agent
Blocked by: 07

## What to build

维护者通过产品版本 tag 或人工指定已有 tag，完成校验、双架构验收、平台包及主包发布。稳定版从 candidate 的 registry 安装验收通过后成为 latest，beta 则进入 next。

## Acceptance criteria

- [ ] 产品 tag 和人工指定已有 tag 触发发布，检出准确 commit，校验版本、tag 规范、可达性和产物身份；任意分支或不匹配版本不能发布。
- [ ] 人工触发不绕过完整检查与双架构安装验收，所有平台通过后才进入有写权限的发布阶段。
- [ ] 发布消费同一次已验证的 tarball 与清单，上传前核对身份；写 registry 阶段不重新构建、pack 或生成 manifest。
- [ ] 发布任务串行，不取消已经写 registry 的旧任务；明确区分构建/验收权限和 npm OIDC 写入权限。
- [ ] 先发布平台包，再发布精确依赖这些版本的主包；显式指定所有发布标签，不提前改变 latest。
- [ ] 稳定主包先进入 candidate，从 registry 安装精确版本完成命令和代表性 Session 验收后才推进主包 latest。
- [ ] beta 使用 next，不修改 latest；稳定 candidate 不覆盖 beta next。构建、上传或验收失败保留旧 latest，本工单阶段不盲目重试部分发布。
- [ ] 通过公开发布入口和隔离本地 registry，验证真实上传、依赖安装、Session 运行、通道状态及失败不推进标签。
- [ ] 补齐 GitHub Release 的 tarball 身份和实际验证信息；不能把先前创建 Release 当成 npm 成功。
- [ ] 提供 npm scope、首次包建立、OIDC/Trusted Publisher 和发布权限的准确配置步骤，版本要求实施时核实；不执行未经明确指示的首个正式 npm 发布。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 24–25、43、45–50、53、56–58。07 提供经当前 CI 验证的 Release PR/tag 入口，并继承 06 的完整安装门槛。

## Comments

- 2026-10-07：拆分已确认。真实 npm 身份验证和正式发布属于外部配置后的明确操作，本地 registry 证明发布行为而不写真实 npm。
