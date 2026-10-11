# 04: 工具完整输出分块入库

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 02

Status: resolved

- [x] 盘点 Jobs registry spill、Bash fullOutputPath、job_output、工具结果卡和所有读取消费者；桌面完整 stdout/stderr 与后台 Job 输出按调用身份持久化
- [x] 分块有序追加并支持字节游标/按需读取；模型截断不删除完整输出；最终结果和关闭等待写入完成，失败不报告成功
- [x] 桌面去除临时日志文件的权威路径引用，公有输出读取接口适配；不改终端所需文件输出策略和既有用户可见行为
- [x] 超过内存截断阈值、流式 ordering、abort、后台输出、崩溃/恢复与同名调用 ID 复用回归；测量 FULL 批量写入成本

## Implementation Evidence

独立新子代理与 `feat/desktop-storage-04` worktree 从 integration 的 `192fb5f6` 创建，并合入03的 `d9d31e2a`。公开测试 seam 沿已确认规格：真实 `createSession` / fake model / Bash、`job_output`、完整输出字节游标、实际进程 crash/abort/close，桌面 App 的 wire 读入口。票据保持 claimed，等待主代理 code review 与06最终集成验收。

### 归属与消费者盘点

- `store/output.ts` 在根 Harness 的同一个便携 SQLite connection 上追加64KiB块，复用事务队列、WAL/FULL；不新建 app/output库、不改变native documents/tasks/ownership/replay。lease拥有最终连接关闭，native Harness先停止调度，Job pipes排空后release关闭数据库。建库失败关闭连接及lease。
- `ConversationRuntime.wrapTools` 保存Harness截断前的stream与显式result文本；两者独立引用，不重复拼接；read/grep/glob/web_fetch通过捕获接口保留自己截断之前的文本，包括HTTP错误正文，安全下载上限和read指定范围不变。引用按native task与invocation身份分隔，不以模型callId为key；根与child共用同一lease输出能力。
- Bash/Jobs在decoded stdout/stderr进入有限memory ring之前持久化，字节cursor沿既有UTF-8语义跨两流计数；每个pipe在FULL提交期间背压，限制待写缓冲。最后decoded bytes、abort和close drain后才settle；SQLite失败变成执行失败/关闭错误，不吞错报告成功。桌面不创建temp spill；终端保留temp文件、fullOutputPath、文本说明和既有job_output消费cursor。
- `Session.readToolOutput`、`readSessionToolOutput`支持按页游标，默认256KiB、上限4MiB，字符边界保持完整。历史入口在同一个只读WAL帧验证native schema及Session id/cwd，不取得lease、migration、auth或恢复执行。`job_output`保持有限模型输出并携带原完整Job引用，读取完整输出不改变模型cursor。
- shared ToolResultView各card携带可选outputRef；Core presentation从已持久化details投影。coding-agent的terminal/headless consumers继续沿原文件/细节合同，不需把数据库引用映射为文件。server `tool_output.read`只走readonly读入口，不调用find/createSession；模型不可用和另一owner busy时仍可读。
- GUI ToolRow由AppConversation经Transcript注入read callback；沿已安装beUI ToolResult/Button呈现按需分页、byte range、摘要切换、失败重试与zh/en文案。只改变授权的tool output body，既有导航/页面布局不变。新增browser测试在420px测原有trigger width、无横向overflow、键盘读取、cursor和失败保留；App通过真实WS fixture读取历史引用。

### 失败与验证

第一条300KiBSession tracer先因缺失read入口失败；Unicode cursor先产生replacement字符的red已修正。关闭活动background时先稳定复现 `SQLite database is closed`：nativeclose先关闭storage而Jobs最后才排空，修正为rootlease持有连接直到所有pipes关闭。相关terminal Job通知测试发现无条件await导致重复通知；保留非SQLite/settled collection同步边界，补SQLite pending job_output回归验证不重复通知。

- focused Session output：9pass、0fail；大输出/重启、read预截断、复用callId、Unicode/非边界cursor、真实SQLite trigger写失败、实际SIGKILL恢复无unsafe副作用重跑、background两流、foreground abort、shutdown drain、pending wait通知抑制均有公开行为断言。
- 宽的关联Bun集合：91pass、0fail、6files、14.57s；补全实际native tools/read观测：16pass、0fail、3files、1.384s。另一个115test集合暴露上述terminal通知regression，不能把该run描述为通过；修正后包含该失败文件、SQLite、输出与server的集合45pass、0fail、7files、4.00s。
- 最终合入03后的输出/Jobs/child/server集合59pass、0fail、5files、5.31s；后台fixture通过FIFO与job_output启动事件确保先进入pending collect后释放进程，移除关闭时未结算通知的竞态。
- 最后web_fetch/HTML与native tools/observation补充集合75pass、0fail、4files、4.02s。
- 合入03后server readonly wire：重启后无可用模型时发送明确返回model_unavailable，另一个公开Session持有lease时仍读原输出，负cursor拒绝；269ms。
- public Session FULL批量成本探针：4MiB实际Bash输出，64页逐字节核对，Run含FULL提交701.97ms，64次64KiB读取5.55ms；真实进程、模型和native事务一并计时，不伪称纯fsync成本。脚本与测量记录放repo外证据目录；已关闭Session/清理fixture。
- GUI focused browser2tests通过（1.41s）；local test:desktop在03前23files/81tests通过（8.87s），合入03后24files/85tests通过（8.96s）。check:dev通过format/lint/types/Knip/tracker/docs/boundaries/test-policy/typography；最终合并提交前补focused与static。

手工agent-browser Light/Dark/narrow真实浏览器验收由06在04/05全部UI集成后统一执行一次，当前不宣称已完成；本票未运行aggregate check、CI、生产safeStorage、打包或外部push/PR/merge。

### ADR Coverage

实现ADR-0035的同根Session SQLite完整输出、FULL块提交与shutdown义务；沿用ADR-0024 native执行/replay和ADR-0010 OS Job生命周期。输出引用是能力实现事实，不新增第二套领域模型或执行调度，无需新增ADR。

Final closure: integrated implementation, independent review and applicable local verification complete. Unified browser and genuine packaged acceptance are recorded in [06](06-integration-and-packaged-acceptance.md); spec/tickets close together after that gate. Prior aggregate environment failures remain recorded separately from passing focused follow-up. Final documentation commit CI remains pending until observed on the PR.
