# 03：发布产物身份与平台边界

Status: ready-for-agent
Blocked by: 02

## What to build

维护者得到身份明确、可核对的 arm64 发布产物；不受支持平台的用户（包括 Intel Mac）安装或运行时得到明确提示，而不是架构错误或崩溃。

## Acceptance criteria

- [ ] 产物清单记录主包与平台包的名称、版本、commit、构建工具版本及 tarball 校验信息，能用于后续完整性核对。
- [ ] 验证主包平台依赖与清单对应关系；错误架构、版本漂移或资源缺失产生可诊断失败。
- [ ] 产物检查确认 `rukie` 与 `rg` 均为 arm64 Mach-O，`rg` 来自 `@vscode/ripgrep-darwin-arm64`，不按构建宿主 `process.arch` 选择。
- [ ] launcher 在 macOS x64、Linux、Windows 上给出明确的不支持提示与非零退出码，覆盖中英文文案；主包不声明 x64 平台依赖。
- [ ] 平台包的生成与验收路径以平台为参数，后续增加架构只新增平台包与验收，不改 launcher 契约或复制 Frontend/Session 业务实现。
- [ ] 使用说明列明首版仅支持 macOS arm64，准确区分本地验证与待配置的外部 CI。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 21、23、26、28、31、43、47。02 是 arm64 安装路径和测试基线。macOS x64 平台包已移入父规格 Out of Scope。

## Comments

- 2026-10-09：用户决定首版只支持 macOS arm64。原「Intel Mac 安装包运行同一套 Headless 验收」改为产物身份与平台边界；x64 构建与运行验收移出本规格，待具备匹配 runtime 后另行扩展。
- 2026-10-07：拆分已确认。未真实执行的架构不得记录为验收通过。
