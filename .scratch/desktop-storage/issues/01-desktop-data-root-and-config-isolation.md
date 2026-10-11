# 01: 桌面数据根与配置隔离

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Status: resolved

- [x] Electron 确定生产业务数据根、开发/测试显式覆盖；私有传给 sidecar，真实 OS home 独立保留，禁止伪造 homeDir
- [x] 盘点 settings/trust/permissions/hooks/MCP/credentials/skills/agents/用户规则/能力缓存/文件历史的全部读写与清理，接入桌面来源；终端默认实现保持不变
- [x] 保留项目输入和现有 trust 规则；禁用 OS home 隐式发现、旧数据导入及共享路径 fallback
- [x] 公有配置入口验证哨兵隔离、真实 ~/ 路径展开、同一项目跨 Frontend 独立信任；同步当前使用文档

## Implementation Evidence

独立分支 `feat/desktop-storage-01` 基于 integration `feat/desktop-storage` 的 `a447d45f`。公开 seam 已由规格授权：配置入口、真实 `createSession`/fake model、工具与权限路径。配置哨兵先失败（误读终端 model/trust/allow），Session skill 哨兵先失败，桌面环境 key 认证先失败，开发缺失数据根先失败；各 slice 修正后通过。票据保持 claimed，等待主代理 review 与 integration 最终验收。

### 来源盘点与接线

| 能力                                 | 当前接线与后续后端接缝                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron 与 server                   | main 生产 `userData/data`；开发/测试显式绝对 `dataRoot`；私有 sidecar env 传根及 `userInfo().homedir`。server 不共享路径兜底，registry/workspace 在根内。                                                                    |
| settings/trust/permissions/hooks     | `config/paths.ts` 独立真实 home 与用户来源；`loadSettings` 选 `dataRoot/settings.json`，项目合并和信任规则不变；Session Hook/权限的工具 home 仍真实。03 可替换应用配置读取，保留项目合并边界。                               |
| MCP                                  | `mcp/index.ts` 选根内 `mcp.json`，启动、Run、管理 reconnect 都传 root；项目 `.mcp.json` 保留 trust gate。03 应接数据库 MCP/header 配置及加密 OAuth store。                                                                   |
| credentials/model auth               | `config/index.ts` 的 desktop 默认解析不访问环境认证；显式 `model/models` 注入沿现有 seam。默认 desktop catalog 为空。`mcp/credentials.ts` desktop load 不读旧文件、save 明确失败、clear 不写明文；03/05 接实际加密认证来源。 |
| skills/agents/用户规则               | root 下 `skills/`、`agents/`、`rules/AGENTS.md`；不扫描 OS home 的三种 namespace；项目 namespace 的优先级与代理 Hook trust 规则保留，父子 reminder 都传 root。                                                               |
| 能力缓存                             | `withToolCapabilityDetection` 增加 ownership 参数并按选中根分隔缓存；终端路径不变。03 应将 desktop 缓存 adapter 替换为 app.sqlite，05 的模型来源须复用检测 wrapper。                                                         |
| Session create/list/read-only/resume | 所有路径传同一 root；当前隔离 JSONL `durable-sessions/` 为01接线，02 替换 SQLite Store，禁止读取旧根。server busy snapshot 用同一根。                                                                                        |
| 文件历史及清理                       | root 下 `file-history/`，工具最终路径仍按真实 home 展开。`checkpoint/cleanup.ts` 对显式应用根禁用仅按年龄删除，以保护其他 Session/历史分支引用；06 接引用核对后的重复安全 orphan cleanup。终端30天规则不变。                 |

公开行为覆盖：独立 trust、终端环境 key 不能认证、home rule/skills/agents/MCP 哨兵不可见、真实 `~/` 写入与权限 deny、应用历史备份、desktop/terminal 同项目的 Session 不枚举/不争 lease、另一应用 owner busy 只读、生产根与真实 OS home 私有传递、缺失开发根拒绝启动。README 与 MCP 当前参考同步；未改变 React DOM/layout，无需本票 GUI 手工 browser 验证。

### Verification

- focused Bun config/server/checkpoint/skills/reminders/MCP：181 pass，0 fail，11 files，6.76s。新增 Session 两个行为场景均低于1秒。
- 最后清理修正：`bun test packages/agent/tests/e2e/desktop-data.test.ts packages/agent/tests/e2e/checkpoint-cleanup.test.ts`：10 pass，0 fail，476ms；新增隔离/权限/历史保留分别96.91/43.56/7.94ms。
- `bunx --no playwright install --only-shell chromium` 成功；`bun run test:desktop`：22 files、80 tests 全通过，9.70s。main 使用真实假 sidecar进程，5 tests、395ms。
- `bun run check:dev`：通过格式/lint/types/Knip/tracker/docs/边界/test-policy/字体检查；首次格式和中间类型错误已修正后重新通过。
- 本票没有运行 aggregate `check`、CI、真实 safeStorage 或打包验收；这些归integration/06。没有push/PR/merge外部操作。

### ADR Coverage

本票实现 ADR-0035 的来源与真实home隔离；沿用 ADR-0014/0019 项目信任及 MCP 身份合同，终端行为不变。SQLite、加密库与引用清理仍归02/03/06，不将本票配置文件接线描述为完整SQLite交付，无需新增ADR。

Final closure: integrated implementation, independent review and applicable local verification complete. Unified browser and genuine packaged acceptance are recorded in [06](06-integration-and-packaged-acceptance.md); spec/tickets close together after that gate. Prior aggregate environment failures remain recorded separately from passing focused follow-up. Final documentation commit CI remains pending until observed on the PR.
