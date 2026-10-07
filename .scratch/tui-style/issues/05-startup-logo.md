# 05: 启动 logo

**What to build:** `neant` 启动时 scrollback 的第一项是带横向渐变的 NEANT 点阵大字（5 行），下面一行 subtle 色的 `model · cwd`。大字的画法从 dsh-TUI 拷贝（`src/components/bigfont.ts`、`splashFonts.ts` 中的 `bold` 一套字体、`Spinner/spinnerUtils.ts` 的 `interpolateColor`），文件头注明来源路径（做法同 ADR-0005）；改写为按格输出 `{ ch, color: "#rrggbb" }`，去掉扫光动画相关参数，只保留 `logoFrom → logoTo` 渐变，渲染时相邻同色字符合并为一段。logo 为占位，日后替换只动 logo 区域。

Blocked by: 03

Status: resolved

- [x] 拷贝代码文件头注明 dsh-TUI 来源路径，无扫光 / 动画 / 随机字体代码
- [x] 测试：首个与末个着色格分别为 `logoFrom`、`logoTo`，相邻同色合并为同一段
- [x] resume 时 logo 仍只出现一次且在最前
- [x] `bun run check` 全绿（knip 无未用导出）
- [x] 手动运行 `neant` 确认渐变显示

## Comments

- 2026-10-02：新增独立 `components/logo/` 区域，移植 dsh-TUI 的 bold 字体、逐格画法与 RGB 插值；文件头注明源路径、提交 `646740f12c34546d6c195f5b7031be0dc67421a5` 及 ADR-0005 的来源风险。源字体缺少 T，按 I 的顶部和竖笔补上同风格六列 T。未引入扫光、动画或随机字体。
- `renderBigText` 输出五行 `{ ch, color }`，横向渐变排除末尾字距留白；渲染前合并每行相邻同色格。Logo 使用主题 logoFrom/logoTo，下方 model 与 cwd 使用 subtle 色。Chat 在同一 Static 中以稳定 key 将 Logo 放在回放消息之前，后续 Run 和 resume 回放不重复追加。
- 红绿测试验证五行字形、左右着色端点、已知中间插值、空格保留与同色合并；通过 render + headless terminal seam 验证自定义主题和元数据颜色。resume 验证 Logo 首项且追加 Run 后仅一份，并调整原有回放断言的起始行。实现期间多次类型检查通过。
- 最终执行 `rtk proxy env NO_COLOR= bun run check`：格式、lint、`tsc -b`、Knip 与全仓测试全部通过，239 tests / 1288 assertions，0 failures。环境继承 NO_COLOR，颜色验收显式清空，原有 NO_COLOR 专项测试保持通过。
- 手动验收：在真实 PTY 中通过 neant main 入口固定 80×24，注入受控模型，仅启动、查看 Logo 和输入区、按 Ctrl+D 退出。ANSI 读回确认五行 NEANT、左端 `#7DA1DE`、右端 `#D7E4FF`、元数据 `#5E6673`，Logo 仅一份；退出码 0，raw 模式恢复。未调用模型服务；临时 runner 与 ANSI 记录位于 /tmp，未纳入仓库。
- code-review：以实施前 HEAD `5469aa053f4ef3ab664792f7c64d07bd1d42e4fa` 为基线，对暂存实现进行 Standards 与 Spec 两个独立子代理审查，均为 0 项发现。
