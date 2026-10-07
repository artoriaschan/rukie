# 05: 代理与 fake-IP 提示

**What to build:** 在需要代理的网络里，web_fetch 遵循 `HTTP(S)_PROXY` / `NO_PROXY` 正常工作，写成私网 IP 的 URL 仍被拒绝。在 fake-IP / TUN 代理环境下，域名被解析到 `198.18.x.x` 而被 SSRF 拦下时，错误信息明确告诉用户（经模型转告）去设置 `HTTPS_PROXY` / `HTTP_PROXY`，而不是只给一个费解的"私网地址被拒"。详见 [web fetch spec](../spec.md) 的"代理"和"fake-IP / TUN 提示"两节。

Blocked by: 01 最小安全 web_fetch

Status: resolved

- [x] 读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（大小写均可），判定需要走代理时用 undici `EnvHttpProxyAgent`，跳过 DNS 校验与钉 IP
- [x] 走代理时，host 是私网 IP 字面量的 URL 仍被拒绝
- [x] 不新增代理设置项
- [x] **fake-IP 提示**：域名（非 IP 字面量）解析出的地址落在 `198.18.0.0/15`、且没有走代理时，SSRF 拒绝的错误信息除拒绝原因外，还写出被拒的 host 与地址，并说明"本机 DNS 可能被 fake-IP / TUN 代理接管，请设置 `HTTPS_PROXY` / `HTTP_PROXY` 指向该代理后重试"；IP 字面量不附此提示，其他私网网段也不附
- [x] 工具 description 提一句：需要代理的网络请设置上述环境变量
- [x] e2e 覆盖：`HTTP_PROXY` 指向本地假代理时请求经过代理；代理下私网 IP 字面量被拒；`resolve` 返回 `198.18.0.17` 且无代理时，错误含 host、地址和代理提示；`resolve` 返回 `10.0.0.1` 时错误不含该提示；设置代理后同一 URL 成功

## Answer

每个请求跳转先快照有效代理环境，以 Undici 8.11.2 的路由语义判定是否代理，并把同一快照作为 `EnvHttpProxyAgent` 的显式选项传入。小写变量即使为空也覆盖大写，HTTPS 缺省或为空时回退 HTTP；`NO_PROXY` 覆盖主机、后缀、子域通配、端口与 IPv6，直接请求仍校验并钉定 DNS 地址。私网 IP 字面量在代理下仍拒绝，没有增加设置或生产测试接口。

仅直接请求的域名解析到 `198.18.0.0/15` 时附英文 fake-IP / TUN 提示，包含 host、被拒地址以及设置 `HTTPS_PROXY / HTTP_PROXY` 后重试的建议。IP 字面量和其他私网地址不附提示。工具 description 同步说明代理环境变量。

`web-fetch-proxy.test.ts` 通过 `createSession`、fake model 与本地 HTTP / CONNECT 假代理覆盖 44 个公开行为用例，包括代理成功、HTTPS 路由、环境变量优先级、`NO_PROXY` 返回安全直接路径、IPv6、重定向重新判定、同一 fake-IP 域名配置代理后恢复。HTTPS 用本地代理明确拒绝 CONNECT，验证实际路由与本机不解析目标域名；测试不依赖公网或修改 TLS 信任。所有 Agent、TUI、Headless CLI web_fetch 用例在各 workspace 的测试 fixture 中清空并恢复代理环境，避免开发机代理影响测试。

代理环境 fixture 各自留在 Agent、TUI、Headless CLI 的测试目录内：跨 workspace 导入测试实现会违反现有 TypeScript project 的 `rootDir` / 文件列表边界（TS6059 / TS6307）。因此保留各包的小 fixture，在同包测试间复用，不新增生产导出或测试基础设施包。

## Verification

2026-10-05：先记录 HTTP 代理、`NO_PROXY` 直接校验、fake-IP 提示的失败回归，再实现并通过。合入 02 / 03 / 04 后，在无效代理环境下运行相关 8 个测试文件，217 pass / 0 fail，865 assertions：

```sh
rtk proxy env HTTP_PROXY=http://127.0.0.1:1 HTTPS_PROXY=http://127.0.0.1:2 NO_PROXY=unused.test bun test packages/agent/tests/e2e/web-fetch.test.ts packages/agent/tests/e2e/web-fetch-redirects.test.ts packages/agent/tests/e2e/web-fetch-proxy.test.ts packages/agent/tests/e2e/web-fetch-html.test.ts packages/agent/tests/e2e/web-fetch-permissions.test.ts apps/neant-tui/tests/e2e/web-fetch.test.ts apps/neant-tui/tests/e2e/permissions.test.ts apps/neant-cli/tests/e2e/cli.test.ts
rtk proxy bunx --no -- oxfmt --check
rtk proxy bunx --no -- oxlint
rtk proxy bunx --no -- tsc -b
rtk proxy bunx --no -- knip
```

四项静态检查通过。完整 `env -u NO_COLOR bun run check` 由集成分支最终验收统一执行。

### 2026-10-05 integration review fixes

- Standards 审阅修正文档与模型工具 description 的地址检查边界：直接请求校验全部 DNS 地址并钉 IP；环境代理路径由代理解析域名并约束目标，不由 Agent Core 校验其解析结果；两条路径仍拒绝非公网 IP 字面量，`NO_PROXY` 返回直接检查。代理行为保持 spec 的既定决策。
- focused 8 文件在无效外部代理环境下 218 pass / 0 fail；代理环境 fixture 保留各 workspace 自有实现，以满足 TypeScript 工程边界。静态检查通过；最终集成验收由 integration 分支统一执行。

### 最终集成验证

实现及审查修复已合入 `codex/web-fetch-integration`；全量检查与双轴复核证据见 [Spec Delivery](../spec.md#delivery)。
