# 01：sidecar 加密后端显式选择

Status: resolved

**What to build:** 按 [spec](../spec.md#配置与加密) 与 [ADR-0037](../../../docs/adr/0037-browser-host-sidecar-capabilities.md#加密后端)，sidecar 进程入口通过私有启动变量显式选择 `electron`、`system-keychain` 或 `memory` 加密后端，实现后两者。

- [x] 进程入口新增后端选择变量；`electron` 需要现有 secret URL/token，`system-keychain` 需要服务名；缺失或不完整时启动失败，不推断、不回退。读取后从 `process.env` 删除，工具子进程不可见
- [x] Electron main 显式传 `electron`；正式与开发启动行为不变
- [x] `system-keychain`：经可注入的 secrets store（生产为 `Bun.secrets`）保存每个安装一把 AES-256-GCM 主密钥；密文绑定凭证身份，沿用 vault 的身份正则；首次加密时创建，读取失败或授权取消返回现有可重试错误，不新建覆盖已有主密钥
- [x] `memory`：进程内主密钥，退出即失效
- [x] 测试注入假的 secrets store，覆盖创建、复用、失败不覆盖、身份不匹配拒绝、后端缺失启动失败、私有变量不泄露到工具环境；不访问真实钥匙串
- [x] 更新 server README 的启动变量与加密说明

## 实施与验证记录

- 基线：`d75580fc`，实现分支 `feat/desktop-web-encryption`，已确认 integration 分支为 ancestor。
- 测试 seam：spec 授权的 `SecretEncryption` + 注入 secrets store、进程启动配置边界及 Electron main 启动。真实钥匙串不在自动验收范围。

- 实现：`src/startup.ts` 显式选择 `RUKIE_DESKTOP_ENCRYPTION_BACKEND`；`system-keychain` 必须提供 `RUKIE_DESKTOP_SECRET_SERVICE`。全部私有 `RUKIE_DESKTOP_*` 值捕获后删除，真实工具子进程环境测试确认不泄露。Electron main 明确选择 `electron`，保持原 secret URL/token 通道。
- 密文：AES-256-GCM 使用随机 12-byte nonce、身份 AAD、版本化密文；共享 vault 身份校验。系统 store 仅 `null` 可创建主密钥，失败和已有无效密钥均不覆盖；实例内并发首次加密共享加载，失败清除 pending 以便重试。memory 独立进程内密钥。未访问真实钥匙串。
- TDD：新增系统后端创建/复用 seam 测试先失败（缺失 export），最小实现后通过；新增启动配置 seam 测试先失败（缺失 `startup.ts`），入口接线后通过。随后补齐读失败、无效密钥、身份/密文篡改、缺失解密密钥、并发首次使用与实际进程未选择后端的覆盖。
- `rtk proxy bun test packages/server/tests/startup.test.ts packages/server/tests/storage/secrets.test.ts`：9 pass / 0 fail，716 ms；最长真实进程启动用例 401.67 ms（验证入口进程行为，无法使用 parent virtual clock）。
- `rtk proxy env -u NO_COLOR bunx --no -- vitest run --project desktop packages/desktop/tests/main.test.ts`：11 pass，519 ms；覆盖正式和开发 main 的显式后端环境。
- `rtk proxy bunx --no -- tsc -b packages/server packages/desktop`：通过（首次暴露测试 env 推断过窄，改为 `NodeJS.ProcessEnv` 后增量通过）。受影响源码与测试 `oxlint` 通过，受影响文件 `oxfmt` 完成，`git diff --check` 通过。root 协调 aggregate static / docs / desktop acceptance，本票不重复运行。
- 已在交付前 fast-forward 合入 integration tip `36cf306b`（仅 spec claim，无测试证据失效）。本票沿用 spec ADR Coverage 的 ADR-0037 显式后端和凭证所有权，不增加额外长期取舍。待 integration 最终 review / CI；真实系统钥匙串验收未运行。

## 评审修复验证

2026-10-12：两个独立 `SecretEncryption` 实例在 fake secrets store 的缺失读取 barrier 后同时首次加密，原实现可确定产生两次主密钥写入（RED，5.04 ms）；修复在有效配置根内按 service 使用空 SQLite guard，取得跨进程锁后重新读取再创建。SQLite 自动释放退出进程的锁，不依赖 PID 或过期文件回收；guard 不保存密钥，等锁最多 15 秒，失败可重试。同一 service 的消费者必须共享配置根；startup 使用 `configurationRoot ?? dataRoot`，保持现有存储默认值。

增量验证：`bun test packages/server/tests/storage/secrets.test.ts packages/server/tests/startup.test.ts scripts/tests/desktop-web.test.ts`：28 pass，0 fail，3.17 s。主密钥测试覆盖独立实例竞争（1.28 ms）、跨真实子进程提交后的重新读取（39.85 ms）、锁持有者 SIGKILL 后恢复（35.10 ms）、锁内读取失败与已写入但回包失败时重试不覆盖（1.65 ms）；全部 fake secrets store、临时目录，不访问系统钥匙串。原隔离入口整链路用例 1.20 s 为真实 sidecar/Vite/WS/Session 启动与停止成本。原包级证据复用；本次未重跑全套。

增量静态验证通过：`bunx --no tsc -b`、变更 TypeScript 文件的 `bunx --no oxlint`、全部 12 个变更文件的 `bunx --no oxfmt --check`、`bun run check:docs`（146 Markdown）、`bun run check:test-policy`（414 test/fixture）与 `git diff --check`。未重跑 aggregate check:dev，复用主代理在集成基线的证据。
