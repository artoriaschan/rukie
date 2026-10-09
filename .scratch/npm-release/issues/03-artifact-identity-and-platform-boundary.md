# 03：发布产物身份与平台边界

Status: resolved
Blocked by: 02

## What to build

维护者得到身份明确、可核对的 arm64 发布产物；不受支持平台的用户（包括 Intel Mac）安装或运行时得到明确提示，而不是架构错误或崩溃。

## Acceptance criteria

- [x] 产物清单记录主包与平台包的名称、版本、commit、构建工具版本及 tarball 校验信息，能用于后续完整性核对。
- [x] 验证主包平台依赖与清单对应关系；错误架构、版本漂移或资源缺失产生可诊断失败。
- [x] 产物检查确认 `rukie` 与 `rg` 均为 arm64 Mach-O，`rg` 来自 `@vscode/ripgrep-darwin-arm64`，不按构建宿主 `process.arch` 选择。
- [x] launcher 在 macOS x64、Linux、Windows 上给出明确的不支持提示与非零退出码，覆盖中英文文案；主包不声明 x64 平台依赖。
- [x] 平台包的生成与验收路径以平台为参数，后续增加架构只新增平台包与验收，不改 launcher 契约或复制 Frontend/Session 业务实现。
- [x] 使用说明列明首版仅支持 macOS arm64，准确区分本地验证与待配置的外部 CI。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 21、23、26、28、31、43、47。02 是 arm64 安装路径和测试基线。macOS x64 平台包已移入父规格 Out of Scope。

## Comments

- 2026-10-09：用户决定首版只支持 macOS arm64。原「Intel Mac 安装包运行同一套 Headless 验收」改为产物身份与平台边界；x64 构建与运行验收移出本规格，待具备匹配 runtime 后另行扩展。
- 2026-10-07：拆分已确认。未真实执行的架构不得记录为验收通过。

- 2026-10-09：交付 `scripts/release/platforms.ts` 的目标描述与平台参数；当前只接受 darwin-arm64。launcher 依据精确平台依赖选择包，覆盖 macOS x64／Linux／Windows 的中英文非零错误，不新增产品测试参数。
- 2026-10-09：`release:verify`／`verifyReleaseArtifacts` 校验未知 metadata 的完整字段、工具版本、产品版本、源 commit、tarball 路径和双 digest，直接检查真实 tarball 白名单、manifest、arm64 Mach-O／权限、精确平台依赖及显式 darwin-arm64 ripgrep／sharp／libvips 内容。安装 fixture 复用同一入口；正式模式拒绝 dirty metadata 和非预期 commit，本地模式保留实际 dirty 身份。
- 2026-10-09：在 arm64 本机一次构建的工作目录产物上复用 `RUKIE_RELEASE_ARTIFACTS`，artifact 与 installed 两组共 19 测试通过（11.25 秒）；实际重打包验证 Intel 依赖、错误架构和不同 arm64 rg 被拒绝。构建约 5.45 秒、compile 237ms，metadata 的源 commit 为 1a50b776、dirty=true，只用于本地开发验收。真实平台重打包用例约 1.50 秒，必要成本是处理实际编译包；将 fixture gzip 压缩等级改为 1 后错误架构用例由 2.77 秒降至 1.49 秒，未使用固定等待。
- 2026-10-09：scripts TypeScript、相关 Oxlint、Knip、docs:update、check:docs 与格式／diff 检查通过；未运行全量 check，由 integration 最终门统一执行。外部 CI／真实 registry／远程认证未验证。
- 2026-10-09：ADR coverage 审阅沿用 ADR-0023 的平台包、身份和发布边界、ADR-0012 的共用 Frontend 入口；该票没有改变 Session 领域或 ADR-0024 harness 决定，Yoga 来源例外保持原范围。
