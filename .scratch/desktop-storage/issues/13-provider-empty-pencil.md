# 13: 无供应商状态按 P01-E 复原

Status: resolved

Blocked by: 12

**What to build:** 用户授权按当前 P01-E、L-P01-E 与 C26 更新无供应商时模型服务布局。保留有供应商界面、添加自定义供应商流程、beUI 组件及存储/凭据合同。

- [x] Pencil MCP 核对 P01-E、浅色对应与 C26；建立当前布局基线并先更新 DESIGN.md
- [x] 复原空状态布局、图标、文案及添加入口，同步 zh/en
- [x] 最小公开浏览器用例验证空状态几何、主题、窄屏、添加交互及有供应商布局保持
- [x] 局部检查、一次 Chromium/mock 空状态验收、独立复核与 ADR Coverage 后关闭

## Verification scope

一份外部验证记录，由实施代理负责，父代理与评审/集成复用。已有 desktop 包级与静态证据作为基线，按实际差异补最小检查；不逐级跑单例、文件、包、全量。失败先诊断并集中修复。同原因再次失败停止重试。无真实 Electron、钥匙串或凭据验收；用户当前 Electron 窗口保持运行，不关闭或更换其数据。

## Implementation evidence

实施基于 `2e0e5887`，独立 `fix/provider-empty-pencil` worktree。当前 Pencil P01-E `E8KSe`、浅色 `z9PBq` 与 C26 `NAeL5` 经 MCP 只读核对；无供应商时整块面板替代供应商列表和详情，移除工具栏，复原 Box、标题、说明及主按钮。复用已有 beUI Button，沿用自定义供应商目录、加载失败重试和原有有供应商分支；zh/en 文案同步。未改变存储、凭据、共享组件或聊天壳。

1887 × 1210 的修改前基线：workspace x660/y100/width880，panel x660/y188/880 × 560，settings navigation x52/y44/268 × 1162。修改后单例核对这些几何及 C26 的图标 y180、标题 y232、说明 y268、144 × 28px 入口 y312；主题与 420px 添加目录/返回交互通过。既有有供应商几何用例通过，之后空分支与测试清理调整复用其有效结果。

外部验证记录 `/tmp/rukie-provider-empty13-evidence/verification.md` 保留失败、诊断、命令与增量证据。初始空状态标题缺失复现；第一次 green 中已通过有供应商几何，空状态颜色断言因 beUI 120ms 过渡尚未结算而失败，使用有界颜色谓词等待后最小单例通过（1 passed / 16 filtered，1.19s）。changed-file oxlint 与 UI project `tsc -b packages/ui` 通过。评审指出的 viewport 清理兜底已修正，最小单例补验证通过（1 passed / 16 filtered，1.22s）；Spec 无发现，Standards 清理发现已闭合。

一次 Chromium/mock 验收完成 Light/Dark 1887px 与 420px 截图，键盘 Tab 可见焦点、Enter 进入唯一自定义目录、返回恢复空状态。窄屏 scrollWidth420，无横向裁切。字体资源 200/loaded，无 JavaScript 错误；仅测试站点 favicon404。自有浏览器与 QA fixture 已关闭/移除；用户 Electron 和独立预览数据保留。未运行包级、全量、真实 Electron、打包或钥匙串验收。

ADR Coverage：仅 GUI 空状态呈现与文案，沿用 ADR-0029/ADR-0035 的前端与宿主边界，无新架构决定。独立评审、父级集成及工单关闭待完成。

最终关闭：候选 `56e59d0f` 由新的 merger 快进集成。Spec 复核零发现；Standards 的测试 viewport 异常清理发现已通过初始化前登记 onTestFinished 修正，父代理检查最终差异关闭发现，仅该单例复验 1 pass（1.22s），未重复生产浏览器或类型检查。父代理读取实际 Dark 与 Light 窄屏截图、核对验证记录，复用实施代理的布局、添加交互与有供应商几何证据。ADR Coverage 对照最终局部布局/文案差异，沿用 ADR-0029/0035，无新的存储、凭据或架构决定。13/spec 同时 resolved，本地结果交付，不等待 CI，未启动或重建 Electron；用户此前应用保留。
