# 09: 按当前 C16 清理高级配置表单

Status: claimed

Blocked by: 08

**What to build:** 对照用户当前 rukie.pen C16，移除添加/编辑模型弹窗中设计源不存在的智能配置、额外能力/兼容、参数映射及重置入口。保留设计中已有的自动压缩、运行参数与价格卡片，标题和说明同步设计；修改已有模型不丢失未呈现的配置字段。

- [ ] 通过 Pencil MCP 核对当前 C16 与公开表单，记录应保留及额外字段
- [ ] 仅修正该表单呈现，继续复用已有 beUI，删除过时前端状态与文案，保留持久化合同
- [ ] focused red/green 覆盖展开后的字段集合及编辑保存保留配置；静态验证一次
- [ ] 实际 Chromium/mock 验收仅检查受影响高级配置 Light/Dark/窄屏，不启动 Electron
- [ ] 独立评审、ADR Coverage 及证据完成后与 spec 同时关闭；复用已通过验证，不重复整套

## Implementation evidence

由新的 model_advanced_pencil09_fresh 子代理在独立工作树实施。最新用户要求与当前 C16 覆盖历史表单中智能配置、兼容/映射和重置入口的呈现要求；不改变已有模型持久化字段的合同。08 关闭后 spec 保持 claimed；初次 check:scratch 因本票尚未登记而失败，登记后仅复验 tracker，不重复代码测试。

## Implementation evidence

独立新代理 model_advanced_pencil09_fresh 从 `86893fec` 建立 fix/model-advanced-pencil worktree，合入 integration `3564dd65`。通过 Pencil MCP 读取当前 C16/L00I9 与完整展开内容 H7daEr：保留自动压缩阈值、Temperature、最大输出 Token、最大工具迭代次数、四项价格与价格来源；移除设计稿不存在的智能配置、额外模型能力、兼容开关、JSON 映射与重置。标题/摘要同步当前稿。旧票据 05 的呈现要求由最新用户要求覆盖，宿主/配置合同不变，编辑保存保留已有 compat/thinkingLevelMap。保留 beUI Button/Input/Checkbox/Radio/Select/Modal 来源，不安装新组件。

公开 DOM 回归先确认旧标题不能匹配当前设计要求；随后加入字段清单、无额外交互、卡片几何与保存元数据断言。同步已有测试消费者，移除已不存在的映射滚动和模板自动填写测试。禁用字段的可访问解释保留为 sr-only，不额外插入设计稿没有的可见说明行。旧测试首次运行发现说明 id 在移除旧区域时缺失，已在原多模态区域恢复。验证细节保存在外部 rukie-advanced-pencil-evidence。

Focused browser file 13/13 passed in 10.79s. 后续仅验证推理等级开关与高级卡片几何的一个 affected case：1/1 passed（最终 1.27s），复用其余 12 项证据，不重复整套桌面验收。check:dev 当前代码通过；首次 static 发现遗留 setMapping，下一次 Knip 发现失去唯一调用方的 Textarea，均按所属层清理，没有修改后端或依赖。

实际 Chromium/mock browser 验收 Light/Dark 1280×900 与 420×900，通过原生外观无关的展开区域核对与截图；额外交互 0、窄屏 dialog 388px 无横向溢出，console 无错误，应用资源 200（隔离 fixture favicon 404）。最后只修正高级区域 border-box 的4px宽度偏差；公开 case 和该区域截图更新确认内容604→608px、两列各296px、三卡均189px、radius16，不重复完整保存/交互流程。最终截图 dark-expanded/light-expanded/dark-narrow/light-narrow 位于外部证据目录。两个自有浏览器/fixture会话均关闭并删除自有 QA 文件，用户 root 预览不动。

ADR Coverage: 本票只调整既有模型表单呈现及保存路径中的冗余 UI 状态，宿主边界/持久化 schema/凭据合同不变，沿用 ADR-0029 和 ADR-0035，无新增 ADR。票据/spec 保持 claimed 等待独立评审与 parent closure。
