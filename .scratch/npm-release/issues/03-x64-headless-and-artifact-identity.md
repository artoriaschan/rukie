# 03：Intel Mac 安装包运行同一套 Headless 验收

Status: ready-for-agent
Blocked by: 02

## What to build

Intel Mac 用户安装相同主包后获得 x64 平台可执行文件和 ripgrep，完成与 Apple Silicon 一致的 Headless 行为。维护者得到版本一致、身份明确的双架构发布产物。

## Acceptance criteria

- [ ] 增加 x64 平台包与构建，主包精确依赖两种 macOS 平台包，os/cpu 选择与二进制架构一致。
- [ ] 复用 arm64 的构建、打包与安装验收路径，不复制 Frontend/Session 业务实现。
- [ ] x64 平台携带正确架构的 ripgrep；交叉编译不误用构建宿主的二进制或路径。
- [ ] 在匹配架构的 x64 runtime 上，从 tarball 安装并运行相同 Headless 场景，包括工具、resume、中断、IO 和无外部 Bun。
- [ ] arm64 保持通过，两个平台的版本、包结构和可见命令行为一致；交叉编译成功不替代运行验收。
- [ ] 产物清单记录主包与平台包的名称、版本、commit、构建工具版本及 tarball 校验信息，能用于后续完整性核对。
- [ ] 验证主包平台依赖与清单对应关系，错误架构、版本漂移或资源缺失产生可诊断失败。
- [ ] 使用说明列明首版 macOS 双架构范围，准确区分本地验证、匹配 runtime 验证和待配置的外部 CI。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 2、21、26、28、31、33、43、47。02 是可复用的 arm64 安装路径和测试基线。

## Comments

- 2026-10-07：拆分已确认。未真实执行的架构不得记录为验收通过。
