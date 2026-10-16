# 06：外观设置（System / Light / Dark）

Status: ready-for-agent
Blocked by: 02

**What to build:** 设置导航中已有「外观」入口（`app/model-services.tsx` 的 `appearance`），但目前不可用。本 ticket 让它可用，内容只有一项：三选一的主题设置，选项为 System、Light、Dark。依据见 [spec](../spec.md) 的「外观设置」一节，以及 DESIGN.md 的「Themes and semantic colors」一节。

## 任务

- [ ] 「外观」目的地沿用现有的设置壳层和导航。三选一控件按 DESIGN.md 的 Component sourcing 顺序选用已安装的原语。如果使用 Radio，要求一组 radio 共用一个可访问名称，并支持方向键切换。
- [ ] 偏好存在 renderer 的 `localStorage` 中，取值为 `system`、`light`、`dark`。读取时把存储值当作 `unknown`，校验后再使用；值缺失或非法时按 `system` 处理。
- [ ] `main.tsx` 在首帧绘制前给 `<html>` 应用 `.light` 或 `.dark`。选择 `system` 时持续监听 `prefers-color-scheme` 的变化。修改设置后立即生效，不需要刷新页面。
- [ ] 检查 `packages/desktop/src/main/desktop.ts` 中 `BrowserWindow` 和 `nativeTheme` 的行为，判断原生标题栏、红绿灯按钮和窗口底色是否需要跟随用户选择。
  - 如果需要，在 preload 中暴露最小 host API（例如设置 `themeSource`），并更新 `DesktopHost` 类型和 preload 测试。
  - 浏览器 host 中对应的实现为空操作。
  - 真实 Electron 验收按[原生验收授权边界](../../../docs/testing.md#原生验收授权边界)另行申请授权。
- [ ] zh 和 en 文案：选项名、说明文字和可访问名称。
- [ ] 测试（Chromium）：
  - 三种选择都正确生效。
  - 刷新后选择保留。
  - 选择 System 时，模拟系统主题切换后界面跟随；选择 Light 或 Dark 时不跟随。
  - 存储值非法时回退到 System。
  - 键盘操作和焦点符合要求。
  - 420px 宽度下没有横向溢出。

  如果新增了 host API，补充 desktop 的 Node 测试。

- [ ] 运行受影响的文件、变更文件的静态检查，并用 agent-browser 验收：在三种选择下分别截取设置页和对话页，并检查窄宽度。
- [ ] 在 `packages/ui/README.md` 中补充外观偏好的说明。

## Comments
