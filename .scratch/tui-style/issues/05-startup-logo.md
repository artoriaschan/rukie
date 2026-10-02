# 05: 启动 logo

**What to build:** `neant` 启动时 scrollback 的第一项是带横向渐变的 NEANT 点阵大字（5 行），下面一行 subtle 色的 `model · cwd`。大字的画法从 dsh-TUI 拷贝（`src/components/bigfont.ts`、`splashFonts.ts` 中的 `bold` 一套字体、`Spinner/spinnerUtils.ts` 的 `interpolateColor`），文件头注明来源路径（做法同 ADR-0005）；改写为按格输出 `{ ch, color: "#rrggbb" }`，去掉扫光动画相关参数，只保留 `logoFrom → logoTo` 渐变，渲染时相邻同色字符合并为一段。logo 为占位，日后替换只动 logo 区域。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 拷贝代码文件头注明 dsh-TUI 来源路径，无扫光 / 动画 / 随机字体代码
- [ ] 测试：首个与末个着色格分别为 `logoFrom`、`logoTo`，相邻同色合并为同一段
- [ ] resume 时 logo 仍只出现一次且在最前
- [ ] `bun run check` 全绿（knip 无未用导出）
- [ ] 手动运行 `neant` 确认渐变显示
