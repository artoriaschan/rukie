# 02: 搬入固定版本 dsh ink 与 Bun runtime

Status: resolved
Blocked by: 01
Type: task

见 [spec](../spec.md) 与 [spike evidence](../spike-notes.md)。

整体替换 `packages/coding-agent/src/ink/` 渲染管线，来源固定为 `3c89ea516e4f7d2777efe979200016528722a0b4`；Yoga 放在 ink 所拥有的目录。保留 design-system 的产品组合代码供 03 改接；删除旧 renderer 路径，不以兼容 facade 保留旧 host API。当前票完成时只交付新 runtime，应用层完成由 05 和 06 负责。

- [x] 搬入 spike 验证过的源文件、最小内部依赖替代；完整 source provenance 和逐项差异登记在 ink/README.md
- [x] 将所有直接 npm 依赖精确固定并更新根 Bun lockfile、docs/tech-stack.md；sharp 实际可解码/缩放，sixel 使用真实 Bun worker
- [x] stdout fd 缺省不再回退 fd=1；注入流的退出恢复走同一流；waitUntilExit 在退出前后调用都完成，保留运行错误拒绝语义
- [x] App context 提供 stdout/renderer，使 selection/search/AlternateScreen 绑定自己的注入根；验证两个独立根不串流或共用状态
- [x] 以新原语及 hooks 组成 ink/index.ts，renderSync 与 async render 保持明确的新 API；不保留旧 render/fullscreen/env/InputEvent facade
- [x] ink 整体 Oxlint/Knip 豁免，但 ADR-0012 依赖边界仍通过可解析 reexport/dynamic import 的检查强制；支持文件全部 ink 内部拥有
- [x] 正式搬入后移除 prototype 重复源码，迁移保留公共行为 tests 与 manifest/port evidence
- [x] 从公开 render + 注入 xterm 验证 Box/Text/ScrollBox/useInput、alternate screen、退出/raw mode、worker消息/退出；用 completion/frame/process signals 同步

## 实现与验证

正式 runtime 整体替换旧管线，保留 design-system 及移动后的 text-input.tsx/text.ts 供03；上游 manifest、support 桩、真实 sharp、所有本地差异登记 ink README。AppContext 绑定根 renderer，修复 late waitUntilExit 和错误 reject。prototype 源码删除，公共 spike tests 迁入 tests/ink/runtime.test.tsx，并扩展至真实鼠标选择、双根 selection/search/输出隔离。

TDD red：旧 barrel 缺少 AlternateScreen；搬入后的 late exit 默认流子进程在5000ms失败上限被 Bun 自动清理。green：公开 runtime4 tests /29 assertions，170ms总计（帧49ms、worker30ms、默认流进程46ms、多根5ms），无固定 sleep。真实 worker/进程契约不能由父进程虚拟 clock 代替。

已运行 focused strict TypeScript：tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --skipLibCheck --target ESNext --module Preserve --moduleResolution bundler --jsx react-jsx --types bun --allowImportingTsExtensions，输入 runtime barrel/host declarations/runtime test/default-stream fixture，通过。authored 文件 Oxlint/oxfmt、git diff --check 通过。check:ink-boundaries 正向通过，临时 reexport 至 tui 和 dynamic import 至 @rukie/agent 均被拒绝后删除探针，正向重验通过。

整体 tsc -b 探针仍因待03/04/05的旧应用 API 与 tests 消费报错；没有宣称完整应用通过。Knip 探针只剩 design-system 暂未从新 barrel 导出引发 highlight.js unused，03恢复产品组合后复验。完整 aggregate 按06在最终迁移 revision运行。
