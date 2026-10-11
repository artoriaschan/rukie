# 16: 独立模型名称与设计源推理等级

Status: claimed

Blocked by: 15

用户要求模型 ID 与名称分别填写、保存与展示，禁止相互自动关联。默认推理层级菜单只展示左侧勾选的等级，名称、顺序严格一一对应；所有等级名称按当前 rukie.pen C16 固定，不进行国际化。标题、说明和其他字段保留既有国际化。

- [x] 核对 C16 当前等级与名称、现有名称存储和展示消费者
- [x] 复用 beUI Input/Select，独立字段端到端保存并展示；菜单只含勾选等级，取消选中默认等级时清理默认值
- [x] 更新 DESIGN.md 的明确等级文案例外，最小公开行为测试与一次受影响区域 Chromium/mock 验收
- [ ] 新代理两轴只读复核、关闭发现、复用验证证据集成并同步关闭 spec

验证由实施代理单一负责并记录；不重复包级或全量检查，不启动真实 Electron、访问钥匙串、等待 CI。预览和正式数据保留。ADR Coverage 由最终 diff 核对，新增模型展示元数据应沿用 ADR-0035 的配置与执行身份边界。

用户追加确认：C16 的“自动”需要可选择、保存并实际执行，语义为不指定推理等级，由供应商决定。固定顺序为关闭、自动、Minimal、Low、Medium、High、XHigh、Max；菜单自动项仅来自左侧勾选。模型名称可留空，绝不自动回填 ID；列表/选择器可单独显示 ID 以定位无名称模型。

实现：桌面独立 name 元数据；产品 Model Selection 记录 automatic，原生七层 Harness 使用 off 作为内部载体，拥有 Models 请求边界按最新持久选择删除推理参数（不把自动等同关闭）。生成与原生压缩共用边界；显式选择、恢复和 Rewind 保留合同；普通子代理继承父当前选择、fork 使用已配置选择、retained 保留自己选择。ADR-0035 记录边界，Core 不承载本地化标签。

验证 owner/evidence：`/tmp/rukie-model16-evidence/verification.md`，记录所有实际失败、原因与最小增量结果。新的 Spec/Standards 两轴只读复核发现 child product/native 同步与 runner cleanup，已集中修正，新 child payload 三例通过（18 assertions/495ms）。其他通过证据与最终静态/Chromium 验收按该记录复用；本票保持 claimed 等待父代理集成关闭。

最终本地静态：受影响 shared/agent/coding-agent/server/ui 类型检查通过；改动文件格式/lint 通过；check:docs 144 文档和 check:test-policy 407 文件通过。一次 mock Chromium 实际验收 Light/en、Dark/zh 与两色 420px，固定八标签、独立 Input、勾选-only Select、自动保存重开、无横向溢出通过；截图在 `/tmp/rukie-model16-evidence/`。浏览器无运行错误，只有临时 fixture favicon404，临时 fixture 初次缺少 maxTokens 导致正确的输入校验拒绝，修正 fixture 后最终保存通过。已关闭所属 Vite/browser 并删除临时页面，不动用户预览。

ADR Coverage：既有 ADR-0035 更新独立 name 与 automatic 的持久事实/原生载体/请求边界；沿用 ADR-0024 锁定 Harness 和 ADR-0029 GUI 原语，不新增 Harness 替代路径或 TUI 菜单，不需要新 ADR。两轴发现全部已关闭；父代理负责快进集成后统一状态关闭。

父代理截图复核发现英文 placeholder 在188×36触发器折行，已仅缩短为 Select level/选择等级；该文案文件格式/lint和一张受影响 Light/en placeholder 增量截图通过，无几何变化，其余类型/测试/多主题验收复用。
