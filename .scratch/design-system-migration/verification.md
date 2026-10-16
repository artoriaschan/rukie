# Design system migration 验证记录

本记录以仓库路径和提交标识保存可复核结论；原始命令日志、截图与运行环境记录由本次交付会话保留。状态、PR 和评审闭环见[规格](spec.md)及[各票](issues/08-feature-surface-conformance.md)。文档更新、交接和快进集成不重复运行已有效的行为证据。

## 来源与复用

| 票  | 来源提交 | 已获得证据与复用边界                                                                                                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | c404c333 | DESIGN、术语和 ui README 规范补齐；docs:update、check:docs155篇、格式及tracker通过；纯文档未运行产品验收。                                                                                             |
| 02  | a59f348d | theme语义角色；受影响测试和静态检查通过；原desktop348通过/10失败26.96s，随后5文件72例通过20.22s，未重新运行完整包；90组实际Light/Dark对比度通过；最终隔离Chromium Light/Dark/420三类截图及无错误网络。 |
| 03  | 1bb8bffe | settings角色与字号；受影响设置测试20.47s、类型/lint/Knip及docs通过；36组对比度、Light/Dark/420/18px设置验收。                                                                                          |
| 04  | 484ef194 | Button/Input/Select/Popover/Dialog与菜单原语；原desktop359通过/4失败22.80s；后续实际增量包括shell22例、布局2个settings例1.21s、审批例、低高度弹窗2例1.93s，未重新运行363例的完整包；最终Chromium通过。 |
| 07  | 69980a23 | Trace公开生命周期、读者选择、流式输出和虚拟回收；原desktop370通过、1失败，原因未确认；后续32个受影响Trace例及24个Transcript/Project配对例通过；真实Core工具/权限与Light/Dark/420验收通过。             |
| 06  | c619e427 | 前端Appearance与最小nativeTheme宿主同步；公开偏好/系统媒体/Radio交互与mock原生IPC通过；最终Chromium系统跟随、刷新保留、Light/Dark/420/18px通过。真实Electron外观未验收。                               |
| 05  | 77c87701 | 删除未用组件、迁移产品Button及窄侧栏焦点；受影响App/组件、类型/lint/Knip和文档通过；最终Chromium导航/Session/Project/窄侧栏通过。发现分支文字宽度0，交由08修复。                                       |

## 保留的失败与限制

- 07原desktop包运行是370通过/1失败，不能由后续focused通过改写为包运行通过。Project菜单原始证据显示先打开后关闭；旧记录“Shift+F10命中错误目标”的解释已撤回。单独6例、配对24例及观测探针通过，触发原因仍未确认，未据此更改生产菜单或削弱断言。
- 01远端TUI分片失败与01文档差异无因果证据；未在本迁移中扩展到TUI修复。远端CI状态由各PR的实际最新提交checks报告。
- 02首次localhost解析到无关IPv6开发实例，最初截图无效，使用IPv4解析约束后重新生成并确认源码路径；保留无关进程。
- 07外部旧fixture向标题请求返回工具，产生标题生成警告；实际Run继续。08新fixture协议验证41项通过，仍需真实Core/浏览器证据，协议验证不能代替产品验收。
- 原生Electron、钥匙串与OS目录选择器未启动。416px Trust的公开Chromium mock-host流程覆盖几何、信任与取消；最终真实侧车手工路径不能越过原生目录选择器边界。

## 08 当前证据

基线77c87701；实现与测试范围见[授权差异表](issues/08-feature-surface-conformance.md)。公开接缝为现有App/组件Chromium测试和导出的checkUiTypography函数。

- 先失败：分支文字在1280/en及420/zh均实测0px；Goal直接删除而缺少确认弹窗，3失败/13跳过16.04s。CSS门禁8通过/7失败，新增声明检查后15通过66ms。
- 修复：分支Tooltip wrapper承接50%上限，按钮占满自身容器；保留40px条和288/320px菜单。Goal复用既有GoalConfirmation/MorphingModal，只在确认后发送clear；原启用模式弹窗保留；错误、忙碌、取消、authoritative Goal状态消失与焦点均经App公开验证。
- 首轮49例40通过/9失败，包含本次误将黑色token前缀替换成transparent造成的布局失败；已恢复原始token。此失败保留，后续布局通过不能改写原运行结果。后续132例124通过/8失败集中于本次字号角色变化的旧断言与新18px字段测试；按拥有者和授权表处理。
- 最新受影响5文件84例81通过/3失败，Goal14例、Composer12例、Project目录11例通过；3个剩余失败属于设置文字几何和搜索动画采样。后续4文件61例60通过/1失败，搜索160ms实际WebAnimation与0.98→1无平移采样、Summary18px和Question18px通过；最后设置单例通过1.55s，复用其余41例已通过证据。
- Citations公开探针确认inline/external/nested可操作链接已为pointer，普通信息行非pointer，Enter正确跳转；1通过/4跳过605ms，无需生产修复。
- 命名层级保持原数值；具名搜索壳20px、内角11px及局部留白角色保持原几何。CSS门禁拒绝px/rem/clamp/calc/raw UI字号及带literal fallback的font-size，允许类型角色；忽略注释、字符串与custom token定义并报告原行号。

## 最终静态和浏览器验收

- 单次 `bun run check:dev` 全通过：155篇文档、470个测试/fixture policy、格式/lint/tsc/Knip/tracker/边界/CSS typography。其后仅单选Interaction数字提示改为真实选中Check，保留28px槽和绑定；先失败1例696ms，4文件28例通过1.79s，1→选中Check12px单例通过622ms；增量格式/lint/tsc/Knip/policy/typography通过。新增透明行/736px内容/r16 composer几何3例2.22s、导航2例1.64s通过。没有第二次check:dev、desktop或check。
- 最终隔离Chromium逐行覆盖壳层、导航、对话/Preview Rail、模型、权限/上下文、搜索、Project、新聊天、Worktree、Goal、Plan/Interaction。Light1280、Dark1280、Dark420/18截图与实测。宽屏Transcript736/composer752/100/r16，模型332/280、窄详情332，权限376/上下文348，Search520/r20，Project320/480/520/448，Worktree448，Goal40/448/body20v24h，Interaction752/r16、Plan body248、Summary300均有实测或公开browser断言。精确671/672模型及main959/960 Plan断点通过。Trust416仅真实Chromium mock-host公开流程，未越过原生picker边界。
- 真实临时Git根05982fd建立独立工作树，Core运行两项bash，实际成功/exit7失败结果与最终文字均可见；工具失败没有伪装成功。Goal启用28px工具模式后使用held模型流：Escape取消保留Goal并返回Trash，Pause发布paused；confirm clear移除bar并在实际状态/响应后返回输入焦点；释放当前stream后无下一Goal轮次。当前Run与自动续跑语义保持原样。实际Worktree删除后出现空状态。
- 首次Plan live仅显示prompt/运行0.1秒而缺失评审/preview，reload+Search重新订阅恢复真实pending Plan，批准后真实continuation结束。独立fresh只读诊断确认Core/client/store/server Plan owners无迁移差异，原因仍未分类；保留初次失败，不称live通过。后续为数字提示修复进行的另一个fresh Plan在0.4秒live出现，保持独立成功记录；实际键1选中12px Check、随后批准完成。fresh Question live立即显示，多选Space/指针及提交完成；另一次decline也结束。
- 30个通过真实wire创建的临时Session激活导航/搜索滚动。导航轨8px/拇指4px实测；所有页面无横向页溢出，主要动作可达；keycaps及组合键后缀未显示。数字快捷提示在最后一次核对发现并修复，旧三张plan-review截图被plan-review-final三张替代，其余有效证据复用。
- 收集79张截图（包括3张已替代的旧数字提示截图），实际检查Light Project/Edit、Dark Search、窄分支/模型/Goal/Question及最终Plan截图；console只有Vite/React信息，errors为空，648条网络记录资源均200。一次Search media/viewport拍摄中agent-browser挂起并自动重启到about:blank；doctor8pass/0warn/0fail，重新连接同一真实sidecar完成后续，不推断产品根因。错误文案等待和过期ref/被侧栏覆盖的交互已按实际状态修正，没有把未生效点击记为通过。
- 本次命名browser已关闭；launcher46683/sidecar46688/Vite46748/provider46967均退出；63244/63250/IPv45173无监听。实际UI删除独立worktree后，确认临时Git根干净、仅根worktree并精确移除；launcher临时目录已清理。保留无关IPv6 Vite29894及其他数据。真实Electron/钥匙串/OS picker未启动。
- 票和spec保持claimed，等待fresh Standards/Spec评审及修复后一起关闭。CI待各PR实际结果，未自动合并。
