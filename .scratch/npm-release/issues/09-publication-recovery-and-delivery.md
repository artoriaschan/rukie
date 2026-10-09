# 09：发布恢复与交付验收

Status: resolved
Blocked by: 08

## What to build

维护者可以判断部分发布的实际状态，核对后续发缺失包或恢复验收与标签推进；遇到相同版本的内容冲突停止，并能按明确步骤回退。最终证据区分本地实现、真实 CI 和真实 npm 发布。

## Acceptance criteria

- [x] 部分平台包成功后，恢复读取 registry 中的已有内容、依赖和身份，匹配则续发缺失包，不只依据版本号存在就跳过。
- [x] 同版本内容或身份冲突时停止，要求使用新版本修复；不覆盖、不盲目重放已经发生的 registry 写入。
- [x] 主包已发布但 registry 验收或 dist-tag 推进失败时，基于原发布产物和实际状态恢复，仍使用已验证 tarball。
- [x] 较旧版本恢复不会意外倒退 latest/next；明确的人工回退有单独步骤并核对目标完整性。
- [x] 通过本地 registry 断言部分成功、完整重试、匹配与冲突、主包验收失败、标签推进失败、旧恢复和显式回退的包内容及通道状态。
- [x] 所有恢复继续保留串行、精确 tag、全部平台验收、稳定 candidate 和 beta next 的发布契约。
- [x] 维护者教程覆盖日常 Release PR、首版引导、外部配置、beta/稳定切换、失败诊断、恢复及回退；使用者文档覆盖安装、升级与支持范围。
- [x] 完成工单及整个规格的 ADR Coverage 审阅，保留 Yoga 范围例外和 CLI-only 契约，不引入未确认的架构取舍。
- [x] 最终代码状态通过必要的聚合检查并记录测试成本、产物身份和未验证条件；不重复全量验证同一状态。
- [x] 真实 GitHub CI 在外部配置可用后记录实际执行证据；外部配置不足时明确剩余条件，不将本地成功写为外部成功；正式 npm 首发仍需单独明确操作。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 50–58。08 的完整发布路径是恢复各失败阶段的前提。本工单发布时不修改或关闭父规格；实际实施完成后按仓库交付规则更新状态。

## Comments

- 2026-10-07：拆分已确认。恢复断言实际 registry 状态，不把 npm 调用日志本身当作结果。

- 2026-10-09：已实现内容核对恢复与显式 rollback。已有包同时核对安装元数据、repository、平台、精确依赖和独立下载 SHA256/SHA512；401/503 等不视为缺失。实际 npm11.21.0 在 loopback HTTP 接受 PUT/tag 写入后断开 socket 的测试通过：通过实际状态确认成功，不盲目重复写入。部分平台续发、完整重试、冲突、Session 失败、标签失败与旧版本恢复均覆盖。`rollback` 使用同一 workflow/concurrency、精确 tag 与全部只读验收，要求完整既有包，仅移动选定主包 latest/next，不重建、不打包、不上传。
- 2026-10-09：TDD 红灯通过公开发布入口复现匹配平台包恢复仍报 existing-version（2.96s）；修复后该用例通过（6.01s）。完整 recovery focused：14 tests / 51 assertions / 76.31s，实际 Node24.15.0/npm11.21.0、干净原产物 `/tmp/rukie-release-08-clean`（build SHA `0af8896341528b7dbdac22066723d995d18fa306`）。版本矩阵在独立临时 Git/source/locked-dependency 根编译三个真实版本，不修改共享产品 manifest；启动编译与打包约17s，npm 本地传输及代表性 fresh install + Session 为主要成本，协议状态用已授权 acceptance callback 避免重复 TUI。
- 2026-10-09：publication/assets/tag/CI workflow focused：18 tests / 84 assertions / 32.83s；包括 partial 恢复后的真实安装 Session。随后补充资产 uploaded-state/实际 size 和不同 runAttempt 的原审计保留验证。维护者文档已覆盖恢复、显式回退、原/当前审计与不确定状态；新增使用者安装升级指南。ADR Coverage 审阅沿用 ADR-0023 分发/身份/版本/恢复、ADR-0012 CLI-only、ADR-0013 固定来源 ink/Yoga、ADR-0024 当前 pi harness；Yoga 本次范围例外保留，无新增架构决定。
- 2026-10-09：仍保持 claimed，父规格保持开放，由主协调线程完成两轴审阅及一次最终聚合检查后统一关闭。以上是本地实际 npm 协议与安装/Session 证据，不是 GitHub hosted CI、真实 npm/OIDC/provenance 或远程 provider auth 成功。真实首发仍需明确操作及 App、npm scope/Trusted Publisher、arm64 runner、不可变 Release 关闭等外部配置。

- 2026-10-09：补充资产/current attempt focused 8 tests / 59 assertions / 9.17s；`bun run check:dev` 全部静态、文档、tracker、边界检查通过，actionlint 与 git diff --check 通过。未运行聚合测试。

- 2026-10-09：最终两轴审阅保持独立结果。Spec：一个 P1，原资产集合及普通 CI/发布 artifact 上传遗漏 `release-modules.json`，恢复跳过构建后 provider 验收 ENOENT。Standards：一个低优先级 Duplicated Code 启发式，assets CLI verify 重复原资产 equality 实现；无硬性规范违反。修复：五份原资产包含原模块清单，原/当前 audit 均以 SHA256 绑定；恢复沿用且完整 installed acceptance 通过；CLI 调用既有 equality 函数。规格 ADR table 已同步当前 ADR-0024 harness 与 07/08/09 的版本冻结、审计、恢复和 rollback 归属，保留 CLI-only/Yoga 范围。

- 2026-10-09：review fix 的 public fresh-download → complete `release:accept` 红灯：23.89s，内部 33 pass/1 ENOENT fail；绿灯：24.48s，原资产下载后 34 个完整 installed/provider/TUI/Headless/identity 案例通过，无重新构建。该回归约24s成本由真实下载、tarball验证、fresh install、PTY 与 Session 子进程产生，独立临时 HOME/项目保证隔离；仅一个代表性完整恢复验收。其余资产/hash/witness/workflow focused：13 tests / 99 assertions / 11.17s（过滤已通过的昂贵完整恢复）；`check:dev`、actionlint、git diff --check 均通过。仍未运行聚合或真实外部发布。

- 2026-10-09：主协调交付审阅完成，Standards 的一项低优先级重复实现和 Spec 的一项 P1 原始资产缺少模块清单均已修复并由两轴分别复核关闭；没有残留发现。ADR Coverage 对照最终 diff、全部 Implementation Decisions 与工单逐项核对，沿用 ADR-0001/0012/0013/0023/0024，CLI-only、授权/信任与持久化边界不变，Yoga 本次例外保留，无待确认的新架构决定。
- 2026-10-09：唯一最终聚合运行在干净代码提交 `dcc80c6716972afee05147e8008161988f587bcf`，使用 Node24.15.0/npm11.21.0/Bun1.4.2、隔离 HOME `/tmp/rukie-npm-release-final-home`，执行 `env -u NO_COLOR bun run check`，复用 `RUKIE_RELEASE_ARTIFACTS=/tmp/rukie-npm-release-final-artifacts`。全部静态检查及3324 tests / 18769 assertions / 307 files通过，0 fail；测试192.29s，总计203.78s。完整日志 `/tmp/rukie-npm-release-final-check.log`。无重复全量运行。
- 2026-10-09：最终0.1.0 darwin-arm64产物只构建一次，metadata clean，build3356ms/compile333ms；`release:verify --require-clean --commit dcc80c6716972afee05147e8008161988f587bcf` 通过。平台tgz SHA256 `f442d8d6c92deb259bb43f50fd099323d8e0930c1caa98b55ad2f796c5082161`，主包tgz SHA256 `cc5c37e279ad3f7fa7e62fc0b91ddea2dc9a427faf13666d89bd8e5286e2b1aa`；完整SHA512、资源身份和工具版本见上述目录的 `release-build.json`，模块清单保留于同目录。
- 2026-10-09：外部配置不足分支已明确记录：当前 checkout 没有 Git remote，真实 GitHub hosted CI/App、npm scope/Trusted Publisher/OIDC/provenance、远程 provider OAuth和正式首发均未执行。配置步骤归维护者发布指南，首版仅macOS arm64；正式首发仍需单独明确操作。此关闭表示实现、本地验收与文档交付完成，不表示外部服务成功。最终只补交付文档与状态，不改变已验证代码；与父规格同一提交关闭。
- 2026-10-09：交付收尾只修改文档与状态，`check:docs`、`check:scratch`、定向格式与 diff 检查通过。已核对 clean/merged ancestry 并移除01–09、02-notices及review共11个实施工作树和已合并临时分支；beta研究工作树在保存源码差异/未跟踪文件哈希快照后移除。保留集成工作树、最终产物与完整日志，未修改main或其他工作树。`local-acceptance.json` 另记录本地检查与清单/日志哈希，明确不能作为真实CI见证。
