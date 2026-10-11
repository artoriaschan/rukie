---
status: accepted
---

# 桌面端使用应用专属 SQLite 存储，与终端配置和 Session 隔离

## 问题

[ADR-0032](0032-desktop-shares-jsonl-store.md) 让桌面端与 TUI、Headless CLI 共用用户目录中的 JSONL Session、配置与凭据。用户要求桌面应用独立管理项目、Session、置顶、供应商配置与凭证，工具调用完整输出存入数据库，附件和文件历史可以单独存文件。共用配置还会使桌面端隐式采用终端的供应商凭证与信任决定。

## 决定

### 数据归属与隔离

本决定整份替代 ADR-0032，部分替代 [ADR-0019](0019-mcp-oauth-credential-ownership.md) 的桌面凭据落盘方式和 [ADR-0034](0034-desktop-cookie-free-startup.md) 中由 Core 默认用户目录保存桌面配置的规则。ADR-0019 的 OAuth 生命周期、服务器身份隔离与项目信任继续有效；ADR-0034 的 Cookie-free 和关闭未使用 Cookie Encryption 规则继续有效。[ADR-0024](0024-adopt-pi-durable-harness.md) 的原生执行、事务、恢复、任务 ownership 与 replay 语义继续有效，终端默认 JSONL 不变。

Electron main 确定应用专属数据根，生产使用 `app.getPath("userData")` 下的业务数据子目录，开发与测试必须显式使用隔离数据根；启动 sidecar 时通过私有启动通道传入。目录不在 `.app` 安装包内，不读写终端的 `~/.rukie`。真实 OS home 与应用数据根分别传递；工具及权限的 `~/` 展开仍指向真实 home，不把数据根伪装为 homeDir。

桌面端的用户级配置、供应商、凭据、项目信任、权限、hooks、MCP、skills、subagent 定义、用户规则、模型能力缓存和文件历史均归该数据根，不扫描 OS home 中 `.rukie`、`.claude` 或 `.agents`。选中项目的规则、skills、hooks、agents 与 MCP 输入仍按现有项目信任规则加载，项目不能定义供应商凭证或自行获得桌面信任。目录变更不自动导入、迁移或回退到旧桌面/TUI 数据，旧文件保持原样。

### 数据库与文件

应用数据库 `app.sqlite` 保存项目、Session 索引与置顶、偏好、桌面配置、供应商和模型定义、凭证密文及能力缓存。每个独立打开的根 Session/Harness 使用 `sessions/<id>/session.sqlite`，通过 pi-durable 原生 SQLite Storage 保存 Transcript、documents、tasks、提交事实与工具完整输出。上游 Storage 的 Session scope 是单个 Harness 的空间，多个独立 Harness 不直接复用同一套表；同一根 Session 的子代理继续使用该 Harness 内的 Conversation 和任务 ownership，不额外创建独立数据库或改变恢复关系。索引是可从 Session 已提交元数据核对的发现信息，不能成为第二套执行事实；创建时先建立 Session 存储再登记索引，启动协调仅检查本数据根，不触发恢复执行。

所有业务 SQLite 使用 WAL 与 `synchronous=FULL`。工具 stdout/stderr、流式输出和后台 Job 输出分块有序追加，保留现有模型截断与读取游标语义；已提交的块才构成恢复保证。正常结束与关闭须排空输出写入，再提交引用这些输出的最终事实，写入失败不能返回成功。崩溃可能丢失未提交缓冲，不承诺任意外部命令副作用的 exactly-once。桌面端不以临时日志文件作为完整输出的权威记录或恢复引用。

附件、文件历史和用户维护的规则/skills/agents 内容保存在数据根下的文件中，数据库持有需要持久化的引用与元信息。相对引用不得越出数据根，删除只清理不再被引用的文件；保存附件先完成文件写入再提交引用，孤立文件清理不得删除仍被历史分支引用的内容。应用数据的完整备份需要数据库一致快照及其引用文件，直接复制一个活动数据库文件不构成完整备份。本轮不新增备份产品功能。

### 进程与执行所有权

Bun sidecar 是业务数据库的唯一写入进程，Electron main 拥有应用启动与 safeStorage，renderer 只调用受限接口。Core 保留执行与存储能力，server 组合桌面配置及 SQLite adapters；不在 server 重写 Harness。使用锁定的 pi-durable 便携 SqliteDatabase 接口适配 `bun:sqlite`，验证事务排队、回滚和关闭；不能假定 Node adapter 在 Bun 中具备相同契约。

同一 Session 保留跨进程单写者保证，sidecar 重启或第二实例不能重复取得执行权；WAL 本身不代表执行者独占。create、resume、list、busy 时的只读 snapshot、子代理、恢复和清理均走选定存储实现。只读路径仅观察已提交一致状态，不取得执行 lease、不修复存储、不启动任务、不执行 schema migration；不能直接用会迁移数据库的 Storage.open 作为只读入口。现有 JSONL 专用读入口必须一起调整。

### 配置与凭证

供应商认证只读取桌面凭证库，不自动读取终端 API Key 环境变量。工具子进程保留正常系统环境，不自动注入桌面凭证；这不承诺工具无法访问其权限允许的本机环境或文件。桌面环境变量认证与工具进程环境是两项不同的契约。

API Key、OAuth token、OAuth client_secret 及持久化的授权临时秘密（如 codeVerifier），以及 MCP 配置中的 Authorization/header 认证秘密均经 Electron main 的 safeStorage 加密，sidecar 只持久化密文。认证需要明文时通过私有、受限的 main/sidecar 通道按凭证身份提供给指定执行用途，不暴露任意解密接口给 renderer，不通过会话 WebSocket、日志或模型上下文传递凭证。renderer 录入的新密钥经受信任 preload IPC 交给 main；列表仅返回脱敏状态，编辑可保留原密钥或替换，不能读取原密钥明文。

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
