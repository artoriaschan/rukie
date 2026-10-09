# 08：tag 驱动完整发布路径

Status: resolved
Blocked by: 07

## What to build

维护者通过产品版本 tag 或人工指定已有 tag，完成校验、arm64 验收、平台包及主包发布。稳定版从 candidate 的 registry 安装验收通过后成为 latest，beta 则进入 next。

## Acceptance criteria

- [x] 产品 tag 和人工指定已有 tag 触发发布，检出准确 commit，校验版本、tag 规范、可达性和产物身份；任意分支或不匹配版本不能发布。
- [x] 人工触发不绕过完整检查与 arm64 安装验收，所有平台通过后才进入有写权限的发布阶段。
- [x] 发布消费同一次已验证的 tarball 与清单，上传前核对身份；写 registry 阶段不重新构建、pack 或生成 manifest。
- [x] 发布任务串行，不取消已经写 registry 的旧任务；明确区分构建/验收权限和 npm OIDC 写入权限。
- [x] 先发布平台包，再发布精确依赖这些版本的主包；显式指定所有发布标签，不提前改变 latest。
- [x] 稳定主包先进入 candidate，从 registry 安装精确版本完成命令和代表性 Session 验收后才推进主包 latest。
- [x] beta 使用 next，不修改 latest；稳定 candidate 不覆盖 beta next。构建、上传或验收失败保留旧 latest，本工单阶段不盲目重试部分发布。
- [x] 通过公开发布入口和隔离本地 registry，验证真实上传、依赖安装、Session 运行、通道状态及失败不推进标签。
- [x] 补齐 GitHub Release 的 tarball 身份和实际验证信息；不能把先前创建 Release 当成 npm 成功。
- [x] 提供 npm scope、首次包建立、OIDC/Trusted Publisher 和发布权限的准确配置步骤，版本要求实施时核实；不执行未经明确指示的首个正式 npm 发布。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 24–25、43、45–50、53、56–58。07 提供经当前 CI 验证的 Release PR/tag 入口，并继承 06 的完整安装门槛。

## Comments

- 2026-10-09：首版只支持 macOS arm64，双架构要求改为 arm64，见父规格 Out of Scope。
- 2026-10-07：拆分已确认。真实 npm 身份验证和正式发布属于外部配置后的明确操作，本地 registry 证明发布行为而不写真实 npm。

- 2026-10-09：新增 tag/manual publication workflow，人工运行要求 workflow ref 与输入 tag 相同，精确 commit、产品版本和 origin/main ancestry 校验；read-only verify job 复用原始 artifacts 运行完整 source check 与全部 arm64 安装门槛。全局串行且 cancel-in-progress:false，contents-write 保存 assets 与 id-token-write npm job 分离；正式 publisher 精确绑定 GitHub SHA/ref/repository，不以 npm token 回退。
- 2026-10-09：在任何 npm PUT 前保存两包 tarball、metadata 和原始验收 audit；通过可信 GitHub API 核对具体 run/attempt 和已成功的 read-only job，即使整个 workflow 尚在执行。重复运行保留原始 audit，另写 current witness；拒绝 partial/conflicting assets、缺少原始资产的已有 registry 版本与 incomplete immutable Release。immutable Releases disabled 是外部设置前提，不改变已发布 Release 流程。
- 2026-10-09：真实 npm11.21.0/Node24.15.0 对隔离 loopback registry 上传平台后主包，验证 SHA256/SHA512 实际字节和精确 optional dependency；独立 fresh cache 安装、--help/--version、真实 loopback fake-provider Session 后才推进稳定 latest。beta 使用 next，上传前拦截更高 next，稳定版不改 next；继承 npm_config_* 大小写变量被清除，npm12.1 在上传前拒绝。现有精确版本仍停止并要求09内容核对恢复，不盲目重发。
- 2026-10-09：公开 npm/Session、tag、YAML、GitHub assets API TDD 从缺失模块/不完整入口失败开始，最终11 pass、74 assertions、22.04s。必要真实 CLI/下载/安装/Session 成本主要4.6–5.0s/成功场景、失败 main上传2.34s、两次 asset校验约2s；没有固定等待。先前 stage-only npm view 在缺少 latest 时无 JSON，实际测试重现后改为精确 dist-tags endpoint。隔离 beta 源码的实际 build/upload/install/Session probe 证实 next=0.1.0-beta.1、latest absent（本地 honest dirty artifact，不冒充正式 clean身份）；同一公开 publication 测试套件在 beta 源码及产物上另行5 pass、18 assertions、17.04s，正常 CI beta 也复用该套件。
- 2026-10-09：actionlint1.7.12、check:dev（format/lint/types/Knip/tracker/docs/import boundaries）、focused scripts types/lint 和 diff checks 通过。复用06已验收实际 tarball，未重复 aggregate check；根代理在09完成后一次完整验证。发布文档涵盖 scope与首次正式 bootstrap、两包各自 Trusted Publisher direct publish/dist-tag 权限、配置后两天内首次真实自动发布激活、tag-ref manual入口及未验证的外部状态。
- 2026-10-09：ADR coverage 复用 ADR-0023 npm 分发和 ADR-0012 单产品边界；Session、pi-durable 与 Yoga 来源例外不变，无需新 ADR。未执行真实 npm/GitHub 写入、读取真实 token 或宣称 OIDC/provenance/CI 已运行；本地 API fixture 的 example/rukie 身份仅为合成证据。09负责已有版本字节相等重用、部分发布/未知结果恢复、通道回滚和扩展故障矩阵。
