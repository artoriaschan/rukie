# 02: 搬入固定版本 dsh ink 与 Bun runtime

Status: ready-for-agent
Blocked by: 01
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

整体替换 `packages/coding-agent/src/ink/` 渲染管线，来源固定为 `3c89ea516e4f7d2777efe979200016528722a0b4`；Yoga 放在 ink 所拥有的目录。保留 design-system 的产品组合代码供 03 改接；删除旧 renderer 路径，不以兼容 facade 保留旧 host API。当前票完成时只交付新 runtime，应用层完成由 05 和 06 负责。

- [ ] 搬入 spike 验证过的源文件、最小内部依赖替代；完整 source provenance 和逐项差异登记在 ink/README.md
- [ ] 将所有直接 npm 依赖精确固定并更新根 Bun lockfile、docs/tech-stack.md；sharp 实际可解码/缩放，sixel 使用真实 Bun worker
- [ ] stdout fd 缺省不再回退 fd=1；注入流的退出恢复走同一流；waitUntilExit 在退出前后调用都完成，保留运行错误拒绝语义
- [ ] App context 提供 stdout/renderer，使 selection/search/AlternateScreen 绑定自己的注入根；验证两个独立根不串流或共用状态
- [ ] 以新原语及 hooks 组成 ink/index.ts，renderSync 与 async render 保持明确的新 API；不保留旧 render/fullscreen/env/InputEvent facade
- [ ] ink 整体 Oxlint/Knip 豁免，但 ADR-0012 依赖边界仍通过可解析 reexport/dynamic import 的检查强制；支持文件全部 ink 内部拥有
- [ ] 正式搬入后移除 prototype 重复源码，迁移保留公共行为 tests 与 manifest/port evidence
- [ ] 从公开 render + 注入 xterm 验证 Box/Text/ScrollBox/useInput、alternate screen、退出/raw mode、worker消息/退出；用 completion/frame/process signals 同步
