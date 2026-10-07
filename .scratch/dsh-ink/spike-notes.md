# Bun spike evidence

Source: dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4`. Runtime: Bun 1.4.2 on macOS arm64, 2026-10-07. 独立 prototype，生产 renderer 尚未改变。

## 复现

```sh
cd .scratch/dsh-ink/prototype
rtk proxy bun install --frozen-lockfile
rtk proxy bun test spike.test.tsx
```

3 tests / 14 assertions pass，194ms 总计；frame/input/restore 50.96ms，真实 sixel worker 46.44ms，默认 process streams 子进程 56.42ms。等待仅使用 onFrame、xterm write callback、worker message/terminate 与 child.exited；5000ms 是失败上限。NodeJS stream 类型在 Bun 运行可用；注入 stdin 还须 setEncoding/read/readable、ref/unref/setRawMode/isTTY，stdout 须 write/events/columns/rows/isTTY。

## 源码及支持文件清单

原样搬入 122 ink 文件（33295 行）与 2 Yoga 文件（3296 行），源路径仍为 src/ink 与 src/native-ts/yoga-layout。唯一 ink 代码差异位于 ink.tsx 的 unmount：stdout 没有 fd 时使用注入 stdout.write，而非回退 writeSync(1)。有 fd 时保留同步恢复路径。

以下支持文件共 263 行，原样借用的 utility 不属于 renderer 桩；正式迁移全部置于 ink 内部，不能依赖 TUI/Agent Core。

| File                           | Lines | Treatment                                                         |
| ------------------------------ | ----- | ----------------------------------------------------------------- |
| `src/handoffAck.ts`            | 3     | 最小产品状态/日志/交接桩                                          |
| `src/bootstrap/state.ts`       | 3     | 最小产品状态/日志/交接桩                                          |
| `src/utils/sliceAnsi.ts`       | 96    | 上游独立 utility 原样复制                                         |
| `src/utils/fullscreen.ts`      | 1     | 最小产品状态/日志/交接桩                                          |
| `src/utils/debug.ts`           | 2     | 最小产品状态/日志/交接桩                                          |
| `src/utils/log.ts`             | 1     | 最小产品状态/日志/交接桩                                          |
| `src/utils/env.ts`             | 7     | 上游独立 utility 原样复制                                         |
| `src/utils/semver.ts`          | 24    | 上游独立 utility 原样复制                                         |
| `src/utils/earlyInput.ts`      | 1     | 最小产品状态/日志/交接桩                                          |
| `src/utils/execFileNoThrow.ts` | 85    | 上游独立 utility 原样复制                                         |
| `src/utils/crashDetail.ts`     | 2     | 最小产品状态/日志/交接桩                                          |
| `src/utils/envUtils.ts`        | 11    | 上游独立 utility 原样复制                                         |
| `src/utils/intl.ts`            | 23    | 上游独立 utility 原样复制                                         |
| `src/dsh-adapter/sharp.ts`     | 4     | 4 行真实 sharp loader；保留 native decoder，不加载 dsh host graph |

Debug 与日志桩不持久化用户文件；logError 只写 console.error 用于诊断。execFileNoThrow 保留真实进程实现，不能把 clipboard 传输桩为空。production 复制仍应由 Rukie host 明确拥有。

## 直接依赖

prototype 用下表全部精确版本安装（22 个直接依赖、安装输出 37 个 packages；含测试专用 xterm 与 TypeScript-only type-fest）。标准库 fs/events/stream/util/buffer/node:* 不新增包。`ink` 字符串仅出现在文档示例，不是需要安装的 npm 包。production 版本与仓库已锁依赖统一后登记到 tech-stack；本表是 spike 实际运行版本。

| Package                    | Version  |
| -------------------------- | -------- |
| `@alcalzone/ansi-tokenize` | `0.3.1`  |
| `@xterm/headless`          | `6.0.0`  |
| `auto-bind`                | `5.0.1`  |
| `bidi-js`                  | `1.1.0`  |
| `chalk`                    | `6.0.1`  |
| `cli-boxes`                | `4.0.1`  |
| `code-excerpt`             | `4.0.0`  |
| `emoji-regex`              | `11.0.0` |
| `get-east-asian-width`     | `1.7.0`  |
| `indent-string`            | `5.0.0`  |
| `lodash-es`                | `4.18.1` |
| `react`                    | `19.3.0` |
| `react-reconciler`         | `0.34.0` |
| `semver`                   | `7.8.5`  |
| `sharp`                    | `0.35.4` |
| `signal-exit`              | `4.1.0`  |
| `sixel`                    | `0.16.0` |
| `stack-utils`              | `2.0.6`  |
| `strip-ansi`               | `7.2.0`  |
| `supports-hyperlinks`      | `4.6.0`  |
| `type-fest`                | `5.10.0` |
| `wrap-ansi`                | `10.0.2` |

## API 与迁移成本

- ScrollBox 从 snapshot/string anchor/initialTop/onScroll 改为 ScrollBoxHandle getters、scrollToElement(DOMElement)、stickyScroll；source identity/UTF-16 reading anchor、search 和不自动 follow 策略由应用拥有。自动 wheel 路由须避免旧 global handler 再处理一次。
- useInput 回调为 `(input, key, event)`，key 使用 upArrow/return/ctrl 等 flags，paste 是 event.isPasted；鼠标通过 Box typed events。Text 无旧 clickable/selectable/softWrap props；dsh noSelect/NoSelect 与 Box 点击须重新检验实际 painted hit target。
- Image 输入 immutable decoded RGBA，transcript 1024 edge/4MiB、preview 2048 edge/8MiB，要求真实 sharp；sixel-worker 的 .js URL 在 Bun 可解析到 .ts，RGBA transfer + encode 实测通过，无需 worker 替代。
- renderSync 为同步 mount，render 为 Promise；fullscreen 用 AlternateScreen；旧 fullscreen/env 参数不存在。useSelection/useHasSelection/useSearchHighlight 的全局 stdout 与 AlternateScreen 单根 fallback 必须改为 context-bound instance，多根测试验收。
- waitUntilExit 在 unmount 后首次调用上游 lazy Promise 永不完成；spike 先订阅退出再 unmount。正式 runtime 须修复已经结束后的调用，不能把该限制传给应用。
- dsh 无 TextInput/Spinner。保留产品编辑逻辑与纯 history，组合新 Box/Text/useDeclaredCursor；旧 tui-text host 路径不可保留。

当前 TUI 85 个文件、design-system 16 个文件、renderer/TUI tests 138 个文件；约 45 个 TUI 消费文件导入 ink barrel。并非全部重写，但所有旧事件/scroll/image/host 依赖必须迁移。通用编辑器约 300 行可复用逻辑；Chat 是主要耦合点，scroll/selection/search 与 lifecycle 不能仅 props 替换。依赖图：02 runtime → 03 design-system/editor → 04 images 与 05 app 并行 → 06 parity/delivery。

## 结论与剩余范围

可行：Bun render/input/default streams、injectable xterm 与真实 sixel worker 已证明；ADR-0013 accepted，ADR-0005 superseded。spike 不代表完整应用验收；production 仍须修复 stream-context 注入、exit lazy promise，验证 selection/clipboard、reading position、graphics/clipping、small terminal、signals 与 module boundaries。06 在最终 revision 执行完整 check。prototype 临时复制用于复现实验，02 在保留必要 tests/manifest/port notes 后移除重复源。
