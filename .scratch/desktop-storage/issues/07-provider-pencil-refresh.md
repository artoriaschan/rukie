# 07: 更新供应商页面与模型弹窗

Status: resolved

Blocked by: 05

**What to build:** 按用户维护的 rukie.pen 当前 P01–P08 和组件更新供应商界面及添加/编辑模型弹窗；新增供应商仅提供自定义入口，移除界面中的预设供应商；滚动条采用 A13 自定义样式，优先组合已有 beUI 组件。

- [x] 经 Pencil MCP 核对 P01–P08、相关 C 组件和 A13，记录当前尺寸与状态
- [x] 编辑前记录浏览器布局基线，更新授权的供应商与模型弹窗布局，保持聊天区域不变
- [x] 添加供应商仅自定义，协议选择、凭据保留/替换/删除及模型配置合同保持一致
- [x] 自定义滚动条验证滚轮、拖拽、键盘、长内容和窄屏，避免原生滚动条重复显示
- [x] focused/browser/static、Light/Dark/窄屏人工浏览器验证及独立评审通过；不启动真实 Electron
- [x] 核对 ADR Coverage，关闭本票和 spec；以适用本地结果交付，无需等待 CI

## Implementation evidence

新代理 provider_pencil_refresh_new 独立实现本票，从 integration `8d68c1cc` 建立独立工作树/分支，完成后由新 merger 整合。源设计仅通过 Pencil MCP 读取，不修改设计文件。组件来源、布局测量与实际本地验证结果待完成后填写。

最终实现 `92122528`，统一评审修复 `1c6672f2`：新实现、merger、Standards/Spec、统一修复及复评均由独立新代理执行。当前 P01–P08/C10–C17/A13 只读经 Pencil MCP 核对，供应商面板 560px、224px rail、16px detail、30px input；添加供应商仅自定义 298×44，无预设入口。672×704 模型弹窗分离基本信息、推理、多模态，高级默认收起，取消/保存实际间距 8px；受支持模型保存合同不变，不支持的新设计字段禁用并解释。新增 beUI RadioGroup 名称与方向键、Tab、Enter/Space，同步唯一其他 ApprovalCard 消费者；已有 beUI Button/Input/Select/Checkbox/Switch/Tooltip 继续复用。

beUI 无 ScrollArea 对应角色，shadcn/Radix 现有依赖提供视口，Radix 最小滑块 18px 不满足 A13，因此直接组合仓库现有 TranscriptScrollbar 比例/拖拽/键盘能力，透明 8px 轨道、4px 滑块、最小 24px、仅溢出显示，原生滚动条隐藏；新增可选名称/样式不改变聊天默认行为，无新依赖。DESIGN.md 与技术栈同步组件来源和最新几何。

基线 model-services/shell 20 pass（9.20s）；实现相关 model-services/shell/transcript 38 pass（10.35s）；评审修复相关 model-services/registry/conversation-dock/shell 28 pass（10.35s）。复现并修正 custom tile 56px、Switch 30px、help 无键盘入口、radio 无组名称，后续实际 footer gap434px→8px、Light 继承 Dark hover→设置局部 token 的最小 red/green 保留。最终 root `bun run test:desktop` 25 files / 100 pass（11.21s），`bun run check:dev` 全通过；独立 Standards 与最终 Spec 复评零遗留问题，根补核最后 Light 局部 token diff，无新架构取舍。

最终 agent-browser Chromium/mock 验收包含 Light/Dark、420px 窄屏、自定义入口、模型弹窗折叠/展开、键盘帮助/推理、真实拖拽、滚轮、Home/End、超长参数映射和底端对齐，最终截图与测量保留在外部证据目录。初始缓存推断已被后续实际 footer specificity/Light token 根因纠正，最终图以修复后刷新版本为准；早期截图不作最终通过证据。浏览器会话/临时 Vite/QA 入口已关闭并清理，没有启动真实 Electron、访问钥匙串、使用真实凭据或 Session。适用本地通过即交付，不等待 CI，也不合并 main。

ADR Coverage：沿用 ADR-0029 的浏览器/host 分层与 ADR-0035 的配置/凭据边界；本次仅局部呈现、既有组件可访问性和滚动条组合，不改变持久化、执行、授权或协议，无需新 ADR。证据包括 implementation.md、review-fix.md、两轴 review 与 final review、root-desktop.log/root-checkdev.log 和 final-* 截图；07 与 spec 在本变更中一起 resolved。
