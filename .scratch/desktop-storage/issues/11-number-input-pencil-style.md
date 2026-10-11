# 11: 模型数字输入隐藏原生增减按钮

Status: resolved

Blocked by: 10

**What to build:** 用户截图中的数字增减按钮来自 beUI Input 内部 type=number 的原生外观。按当前 Pencil，在模型弹窗范围隐藏原生按钮，保留数字输入、最小值校验和键盘调整，不改变共享 Input 或其他页面。

- [x] 在所属设置样式中隐藏上下文窗口和最大输出 Token 的原生按钮
- [x] 最小公开浏览器回归验证按钮外观、尺寸及数字/键盘合同
- [x] 仅验收受影响输入区域，复用其余默认等级与执行证据；不启动 Electron
- [x] 文档与局部格式/lint 检查、差异复核、ADR Coverage 和本地证据完成后与 spec 同步关闭

## Implementation evidence

由新的 numeric_spinner11_fresh 子代理在独立工作树实施。继续使用已安装 beUI Input，不把其内部 HTML input 当作组件来源替换；只处理浏览器原生 type=number 外观。

独立工作树 `/private/tmp/rukie-number-input-fix`，分支 `fix/model-number-inputs`，起点 d3defa71 并快进文档集成 7ee31e65。仅模型弹窗 CSS 隐藏数字输入浏览器增减按钮，保留 number/min=1、键盘 ArrowUp 和 36px 外框；不修改共享 Input 或其他页面。DESIGN.md 先登记数字呈现合同。新增一例公开 DOM 回归同时覆盖上下文窗口与最大输出 Token：原样式 appearance auto 的 red 已复现；两次测试断言自身错误（Chromium 内部伪元素不可 introspect、number matcher 值类型）在同例修正，最终 1 pass /14 skipped，命令 1.28s，完整记录归 `/tmp/rukie-number-input-evidence/verification.md`，失败历史保留。

受影响区域 Chromium/mock Light/Dark 1280×900 和 420×900 hover/focus 验收完成，两输入均 textfield/36px，无原生按钮。console 仅 Vite/React 信息；资源200，fixture favicon404。自己的浏览器/fixture已退出，用户预览未动。既有 10 的默认等级、保存、server 请求与静态证据继续有效；102 desktop 仅作为此前基线，不称最新整套通过。本票不重复文件/包/aggregate/check:dev，不启动 Electron。

ADR Coverage：局部设置 CSS，无数据、Session、凭据或包边界变更；沿用 ADR-0029/0035，无需新 ADR。父代理直接复核本票小范围差异后完成关闭与交付。

最终集成 `08adbe7a`，独立 Standards/Spec 0 项实现问题，父代理核对 scoped CSS、公开单例和截图。Spec 指出 light-narrow-tokens 图片没有露出 Token 输入，不能单凭该图片证明该字段外观；窄屏该字段结果来自操作/测量记录，公开单例同时覆盖两字段，不扩大截图证据的含义。集成仅核对 FF/祖先与 diff，未重复测试或浏览器。11/spec 同步 resolved，清理任务工作树，PR 等待用户评审，不等待 CI，未合并 main。
