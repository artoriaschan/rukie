---
status: accepted
---

# 桌面端使用应用专属 SQLite 存储，与终端配置和 Session 隔离

## 问题

[ADR-0032](0032-desktop-shares-jsonl-store.md) 让桌面端与 TUI、Headless CLI 共用用户目录中的 JSONL Session、配置与凭据。用户要求桌面应用独立管理项目、Session、置顶、供应商配置与凭证，工具调用完整输出存入数据库，附件和文件历史可以单独存文件。共用配置还会使桌面端隐式采用终端的供应商凭证与信任决定。

## 决定

开发版的配置共享范围由 [ADR-0036](0036-shared-development-configuration.md) 部分替代；正式应用与终端隔离规则继续有效。浏览器形态的凭证加密与模型服务通道由 [ADR-0037](0037-browser-host-sidecar-capabilities.md) 部分替代；Electron 的 safeStorage、preload IPC 与 management token 通道继续有效。

### 数据归属与隔离

本决定整份替代 ADR-0032，部分替代 [ADR-0019](0019-mcp-oauth-credential-ownership.md) 的桌面凭据落盘方式和 [ADR-0034](0034-desktop-cookie-free-startup.md) 中由 Core 默认用户目录保存桌面配置的规则。ADR-0019 的 OAuth 生命周期、服务器身份隔离与项目信任继续有效；ADR-0034 的 Cookie-free 和关闭未使用 Cookie Encryption 规则继续有效。[ADR-0024](0024-adopt-pi-durable-harness.md) 的原生执行、事务、恢复、任务 ownership 与 replay 语义继续有效，终端默认 JSONL 不变。

Electron main 确定应用专属数据根，生产使用 `app.getPath("userData")` 下的业务数据子目录，开发与测试必须显式使用隔离数据根；启动 sidecar 时通过私有启动通道传入。目录不在 `.app` 安装包内，不读写终端的 `~/.rukie`。真实 OS home 与应用数据根分别传递；工具及权限的 `~/` 展开仍指向真实 home，不把数据根伪装为 homeDir。

桌面端的用户级配置、供应商、凭据、项目信任、权限、hooks、MCP、skills、subagent 定义、用户规则、模型能力缓存和文件历史均归该数据根，不扫描 OS home 中 `.rukie`、`.claude` 或 `.agents`。选中项目的规则、skills、hooks、agents 与 MCP 输入仍按现有项目信任规则加载，项目不能定义供应商凭证或自行获得桌面信任。目录变更不自动导入、迁移或回退到旧桌面/TUI 数据，旧文件保持原样。

### 数据库与文件

应用数据库 `app.sqlite` 保存项目、Session 索引与置顶、偏好、桌面配置、供应商和模型定义、凭证密文及能力缓存。每个独立打开的根 Session/Harness 使用 `sessions/<id>/session.sqlite`，通过 pi-durable 原生 SQLite Storage 保存 Transcript、documents、tasks、提交事实与工具完整输出。上游 Storage 的 Session scope 是单个 Harness 的空间，多个独立 Harness 不直接复用同一套表；同一根 Session 的子代理继续使用该 Harness 内的 Conversation 和任务 ownership，不额外创建独立数据库或改变恢复关系。索引是可从 Session 已提交元数据核对的发现信息，不能成为第二套执行事实；创建时先建立 Session 存储再登记索引，启动协调仅检查本数据根，不触发恢复执行。

所有业务 SQLite 使用 WAL 与 `synchronous=FULL`。工具 stdout/stderr、流式输出和后台 Job 输出分块有序追加，保留现有模型截断与读取游标语义；已提交的块才构成恢复保证。正常结束与关闭须排空输出写入，再提交引用这些输出的最终事实，写入失败不能返回成功。崩溃可能丢失未提交缓冲，不承诺任意外部命令副作用的 exactly-once。桌面端不以临时日志文件作为完整输出的权威记录或恢复引用。

附件、文件历史和用户维护的规则/skills/agents 内容保存在数据根下的文件中，数据库持有需要持久化的引用与元信息。相对引用不得越出数据根，常规孤立文件清理只移除不再被引用的文件；保存附件先完成文件写入再提交引用，孤立文件清理不得删除仍被历史分支引用的内容。应用数据的完整备份需要数据库一致快照及其引用文件，直接复制一个活动数据库文件不构成完整备份。本轮不新增备份产品功能。

### 进程与执行所有权

Bun sidecar 是业务数据库的唯一写入进程，Electron main 拥有应用启动与 safeStorage，renderer 只调用受限接口。Core 保留执行与存储能力，server 组合桌面配置及 SQLite adapters；不在 server 重写 Harness。使用锁定的 pi-durable 便携 SqliteDatabase 接口适配 `bun:sqlite`，验证事务排队、回滚和关闭；不能假定 Node adapter 在 Bun 中具备相同契约。

同一 Session 保留跨进程单写者保证，sidecar 重启或第二实例不能重复取得执行权；WAL 本身不代表执行者独占。create、resume、list、busy 时的只读 snapshot、子代理、恢复和清理均走选定存储实现。启动时的模型目录和历史订阅只读取展示所需的非敏感配置与已提交快照，不解密 Hooks、MCP 或供应商凭证；已打开 Session 保持实时订阅，用户明确执行命令才打开未加载的 Session。历史展示的 busy 状态通过独立 host mutex 的即时事务探测并立即回滚，不写数据库或创建 Session；这是当时的占用观察，执行命令仍须重新获得 lease。只读路径仅观察已提交一致状态，不取得执行 lease、不修复存储、不启动任务、不执行 schema migration；不能直接用会迁移数据库的 Storage.open 作为只读入口。现有 JSONL 专用读入口必须一起调整。

根 Session 永久删除取得同一写者租约后移除其完整存储与该根 Session 的附件、文件历史；子代理共用根存储，一并移除。删除前验证全部目标处于规范数据根内，拒绝符号链接重定向；占用或校验失败不删除文件。存储目录、存储文件和协调目录/文件的内部符号链接重定向（包括悬空链接）在打开数据库前拒绝，数据根本身的规范路径别名可以共用。写者协调文件位于数据根 `.session-leases/`，以规范存储目录的哈希作为身份，create、resume、只写标题、busy 探测与删除共用该协议。协调文件没有 Session 内容，永久保留以使删除后的等待者仍锁住同一 inode；只保留目录内 mutex 或在持锁时删除它会让另一进程锁住新 inode。现有存储的存在性必须在取得租约后重新检查，等待中的 Resume 不得重建已删除的 Session。新协议不与旧目录内 mutex 互锁，切换前关闭旧宿主；不增加旧协议兼容或存储迁移。

### 配置与凭证

供应商认证只读取桌面凭证库，不自动读取终端 API Key 环境变量。工具子进程保留正常系统环境，不自动注入桌面凭证；这不承诺工具无法访问其权限允许的本机环境或文件。桌面环境变量认证与工具进程环境是两项不同的契约。

API Key、OAuth token、OAuth client_secret 及持久化的授权临时秘密（如 codeVerifier），以及 MCP 配置中的 Authorization/header 认证秘密均经 Electron main 的 safeStorage 加密，sidecar 只持久化密文。认证需要明文时通过私有、受限的 main/sidecar 通道按凭证身份提供给指定执行用途，不暴露任意解密接口给 renderer，不通过会话 WebSocket、日志或模型上下文传递凭证。renderer 录入的新密钥经受信任 preload IPC 交给 main；列表仅返回脱敏状态，编辑可保留原密钥或替换。用户在供应商详情主动点击显示时，renderer 经受信任主 frame IPC 请求该供应商的 API Key；main 验证精确供应商身份后，经独立 management token 通道读取 vault。该受限展示不开放任意凭证解密，不读取 OAuth/MCP/hook 秘密；普通启动和列表不解密。明文仅在当前详情的临时内存中展示，隐藏、切换供应商、保存或退出时清除，并丢弃已取消或过期请求的返回值；展示值不自动转为替换凭证。

加密不可用、系统授权被取消或解密失败时，不明文落盘，也不回退到终端凭证。保留现有密文，失败返回可重试/重新配置的状态；删除与替换在数据库事务中保持配置和凭证一致。macOS 的 safeStorage 可能显式访问钥匙串，不把 mock keychain 作为生产验收。跨机器复制后凭证可能需要重新录入。

供应商录入沿用 `rukie.pen` 的 M17、C10–C17、P01–P08 模型服务流程，覆盖供应商目录、地址/API 格式/API Key、模型添加编辑、重命名及删除确认，具体字段与交互来源归[存储调整规格](../../.scratch/desktop-storage/spec.md#模型服务录入)。既有主窗口布局保持不变，新增设置入口与模型服务页面按 DESIGN.md 实施。无凭证时可以打开应用和查看旧会话，发送需先配置可用模型。

## 备选方案

- 继续共用 JSONL 与终端用户配置：不满足桌面/TUI 的独立数据和凭证要求。
- 全应用单一 SQLite 文件：需要给上游单 Session scope 增加命名空间，扩大适配与恢复风险；选择应用索引库加每 Session 库。
- 把工具大输出继续写日志文件：用户明确要求工具调用输出存入数据库，文件只承担附件、历史和用户内容。
- SQLite `synchronous=NORMAL`：进程崩溃后恢复成本低，但最新提交在断电时的保证弱于 FULL；选择 FULL 并测量代表性流式写入成本。
- 把应用数据根直接作为 homeDir：会改变工具与权限路径的 `~/` 含义，不能完成正确的配置隔离。
- 凭证明文入库或环境变量兜底：破坏已确认的加密与隔离规则。

## 影响

桌面端与终端不能直接接力同一个 Session；两者在同一项目工作也各自拥有会话、信任与配置。Core 的 Frontend 无关执行接口保留，增加实际存储与配置来源的接缝。模型录入成为桌面首次使用的必要能力，已配置供应商和模型在重启后保留；删除配置不能破坏历史 Transcript，后续执行缺少有效模型时要求重新选择。

当前源码已实现上述 SQLite、独立配置与输出、系统加密通道和模型服务流程。逐项验证、真实系统加密和打包验收状态归[存储调整规格及工单](../../.scratch/desktop-storage/spec.md)；源码实现不代表已发布或生产验收完成。

### 开发环境隔离

`dev:desktop` 固定使用 checkout 内 `.desktop-dev` 的独立业务数据、Electron userData、session/cache 与构建路径，并保留真实工具 home。开发名称为 `rukie-desktop-development`，bundle identity 为 `dev.rukie.desktop.development`，在 ready 前设置名称与路径；单实例锁使用独立 userData，开发不会驱动正式应用的现有窗口。当前源码每次重新构建，稳定缓存的开发 bundle 与正式打包产物分开，Cookie Encryption 继续关闭，不以 mock keychain 代替实际凭证行为。

[Electron 41.0.3 的 macOS 初始化实现](https://github.com/electron/electron/blob/v41.0.3/shell/browser/electron_browser_main_parts.cc#L469-L510) 在 main 执行后将 Keychain service 设置为 `Browser::GetName() + " Safe Storage"`，account 为同一 app name。因此开发的 manifest、pre-ready name 与 bundle identity 都与正式版分离；仅设置不同 userData 不能达到这个目的。显式开发凭证操作使用自己的系统身份，失败或取消继续遵守现有凭证合同；此源代码证据不代替独立授权的真实系统钥匙串验收。使用和退出流程由[桌面 README](../../packages/desktop/README.md#桌面开发调试)维护。

### 模型名称与自动推理选择

模型 ID 是请求与配置身份，显示名称是独立的可选展示元数据，保存和修改互不回填。桌面默认推理选择包含 `automatic`，会话明确选择优先；恢复已有会话保持其已提交选择。`automatic` 表示请求不指定推理等级、开关或预算，让供应商采用自己的默认行为，与明确关闭不同。

锁定 Harness 的原生 AgentDoc 仍保持七种等级；`automatic` 由会话的可回退、按分支复制的模型选择 document 保存，原生 `off` 仅承担 Harness 类型载体。Core 的模型请求边界通过原生 ProviderDoc 的独立会话身份读取已提交产品选择，在 pi-ai 的 `onPayload` 中移除推理参数；Generation 的流式调用与 Compaction 的完整调用共用该边界。明确等级仍走原有协议映射，回退和恢复不把自动选择改成关闭或全局默认；不替换原生执行、任务或提交机制。标题等独立辅助请求维持自己的模型合同。

### 模型高级配置

桌面模型的高级字段作为可选配置保存；留空使用现有默认行为。自动压缩阈值为上下文占用百分比（1–100），根 Session 将其转换为原生 Harness 的 reserveTokens，并关闭提前后台压缩。原生摘要预算与 reserveTokens 耦合，Session 专用 completeSimple 请求边界保留原默认策略的独立摘要预算并受模型输出上限约束，避免 99–100% 阈值产生过小或为零的摘要预算；普通生成预算保持不变。原生压缩策略属于整个 Harness；子代理仍沿用根 Session 策略，不宣称其不同模型阈值独立生效。本轮不替换或扩展锁定 Harness 的压缩执行机制。

Temperature 通过 pi-ai 请求选项传入，明确的辅助请求选项优先；四项价格为 USD/百万 Token，映射模型 cost 供原生 Usage 计算，价格来源只保存元数据。最大工具迭代按每次 Run 计数：一条已提交模型回复的整批工具算一轮，达到上限后下一次请求不提供工具，允许模型总结。计数从原生 Run 输入的最早提交 entry 起按当前 Conversation 的未投影 Transcript 重建，恢复不重复计轮，压缩不清零，子代理与父 Conversation 分开。供应商违反无工具请求继续返回工具时通过原生 abort 结束，不执行额外工具，也不伪称总结成功。
