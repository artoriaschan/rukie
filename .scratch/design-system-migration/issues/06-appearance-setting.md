# 06：外观设置（System / Light / Dark）

Status: resolved
Blocked by: 02

**What to build:** 设置导航中已有「外观」入口（`app/model-services.tsx` 的 `appearance`），但目前不可用。本 ticket 让它可用，内容只有一项：三选一的主题设置，选项为 System、Light、Dark。依据见 [spec](../spec.md) 的「外观设置」一节，以及 DESIGN.md 的「Themes and semantic colors」一节。

## 任务

- [x] 「外观」目的地沿用现有的设置壳层和导航。三选一控件按 DESIGN.md 的 Component sourcing 顺序选用已安装的原语。如果使用 Radio，要求一组 radio 共用一个可访问名称，并支持方向键切换。
- [x] 偏好存在 renderer 的 `localStorage` 中，取值为 `system`、`light`、`dark`。读取时把存储值当作 `unknown`，校验后再使用；值缺失或非法时按 `system` 处理。
- [x] `main.tsx` 在首帧绘制前给 `<html>` 应用 `.light` 或 `.dark`。选择 `system` 时持续监听 `prefers-color-scheme` 的变化。修改设置后立即生效，不需要刷新页面。
- [x] 检查 `packages/desktop/src/main/desktop.ts` 中 `BrowserWindow` 和 `nativeTheme` 的行为，判断原生标题栏、红绿灯按钮和窗口底色是否需要跟随用户选择。
  - 如果需要，在 preload 中暴露最小 host API（例如设置 `themeSource`），并更新 `DesktopHost` 类型和 preload 测试。
  - 浏览器 host 中对应的实现为空操作。
  - 真实 Electron 验收按[原生验收授权边界](../../../docs/testing.md#原生验收授权边界)另行申请授权。
- [x] zh 和 en 文案：选项名、说明文字和可访问名称。
- [x] 测试（Chromium）：
  - 三种选择都正确生效。
  - 刷新后选择保留。
  - 选择 System 时，模拟系统主题切换后界面跟随；选择 Light 或 Dark 时不跟随。
  - 存储值非法时回退到 System。
  - 键盘操作和焦点符合要求。
  - 420px 宽度下没有横向溢出。

  如果新增了 host API，补充 desktop 的 Node 测试。

- [x] 运行受影响的文件、变更文件的静态检查，并用 agent-browser 验收：在三种选择下分别截取设置页和对话页，并检查窄宽度。
- [x] 在 `packages/ui/README.md` 中补充外观偏好的说明。

## 授权差异表

| 区域       | 属性       | 旧值                  | 新值                                                        |
| ---------- | ---------- | --------------------- | ----------------------------------------------------------- |
| 设置导航   | 外观入口   | 禁用                  | 可用；窄屏保留图标入口                                      |
| 外观内容   | 控件       | 无                    | 一组本地化 System / Light / Dark Radio                      |
| Radio 原语 | 指针光标   | 按钮 computed default | 按钮、选中标记、标签均 pointer；disabled 保持 not-allowed   |
| 首帧与主题 | 解析       | 仅系统                | renderer 本地偏好，缺失/非法按系统                          |
| 原生宿主   | 主题与底色 | 系统主题、默认白底    | 枚举同步 nativeTheme，底色跟随 shell role #f7f7f7 / #0e0e0e |

其余设置壳、导航和内容几何保持 ±1px；复用已安装 beUI Radio，无依赖新增。公开测试 seam 使用 spec 已确认的 App、浏览器主题与 desktop host 边界。

## Comments

- 复用已安装 beUI Radio；一组本地化名称与三个选项，沿用设置 ScrollArea。renderer owner 在 React root 前解析 unknown 存储并应用主题；System 才响应真实 MQL，退出设置后持续跟随。
- 原生检查：hiddenInset 与红绿灯仍由 Electron 管理，新增枚举限定 setThemeSource 并先校验 sender/frame；browser host 为空操作。窗口底色按 DESIGN shell role 适配，关闭/启动失败时释放监听。无 Core、user settings、wire 或依赖变化。
- 当前 focused 证据：集成04后的外观10项通过2.73s；既有模型服务、worktree、browser host51项通过20.65s；desktop preload/main14项通过807ms。changed format/lint/types、docs、tracker、test-policy 和 typography 通过。外部 verification-06.md 保留实际失败与增量范围。
- 已无冲突集成07 `69980a23`。隔离 Chromium 完成三种偏好的设置/新聊天对话画布截图与实际刷新恢复；System 跟随实际媒体变化，强制 Light/Dark 忽略相反媒体。420px/18px 的外观入口可达、无横向溢出；方向键选择与焦点同步、Space 可用、焦点环可见。
- 浏览器发现 Radio button 的 cursor-inherit 实际为 default；公开测试 RED 两例失败后改为显式 cursor-pointer。Appearance 与 F01 的 Light/Dark 焦点/禁用增量4例通过1.82s；按钮、选中标记与标签均 pointer，disabled 仍 not-allowed。仅该 owner 与测试变更重跑静态检查，保留此前包与消费者证据。
- 最终截图 `06-{system,light,dark}-{settings,conversation}.png`、`06-420-18px-{dark,light}-settings.png` 和 `06-420-conversation.png` 及 computed JSON/日志保存在外部验收目录。控制台17条信息/debug、无 warning/error；errors 为空；649个请求全部200，@fs 路径核实为06源码。空白新聊天画布以外的 Transcript 主题/阅读证据复用02/07。
- named Chromium 已关闭，launcher exit130，Vite/launcher PID59997/59910 已退出；sidecar58628/fake provider58626端口关闭，隔离临时目录清空。无其他进程清理。
- ADR coverage：沿用 ADR-0029 的 renderer/host 边界；localStorage 与最小枚举 nativeTheme 通道仅属呈现适配，无新持久化模型或长期架构取舍，无需新增 ADR。未启动真实 Electron/钥匙串，native 视觉仍未验证；renderer 启动前的原生窗口采用系统主题。
