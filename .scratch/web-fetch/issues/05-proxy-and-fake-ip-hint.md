# 05: 代理与 fake-IP 提示

**What to build:** 在需要代理的网络里，web_fetch 遵循 `HTTP(S)_PROXY` / `NO_PROXY` 正常工作，写成私网 IP 的 URL 仍被拒绝。在 fake-IP / TUN 代理环境下，域名被解析到 `198.18.x.x` 而被 SSRF 拦下时，错误信息明确告诉用户（经模型转告）去设置 `HTTPS_PROXY` / `HTTP_PROXY`，而不是只给一个费解的"私网地址被拒"。详见 [web fetch spec](../spec.md) 的"代理"和"fake-IP / TUN 提示"两节。

**Blocked by:** 01 最小安全 web_fetch

**Status:** ready-for-agent

- [ ] 读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`（大小写均可），判定需要走代理时用 undici `EnvHttpProxyAgent`，跳过 DNS 校验与钉 IP
- [ ] 走代理时，host 是私网 IP 字面量的 URL 仍被拒绝
- [ ] 不新增代理设置项
- [ ] **fake-IP 提示**：域名（非 IP 字面量）解析出的地址落在 `198.18.0.0/15`、且没有走代理时，SSRF 拒绝的错误信息除拒绝原因外，还写出被拒的 host 与地址，并说明"本机 DNS 可能被 fake-IP / TUN 代理接管，请设置 `HTTPS_PROXY` / `HTTP_PROXY` 指向该代理后重试"；IP 字面量不附此提示，其他私网网段也不附
- [ ] 工具 description 提一句：需要代理的网络请设置上述环境变量
- [ ] e2e 覆盖：`HTTP_PROXY` 指向本地假代理时请求经过代理；代理下私网 IP 字面量被拒；`resolve` 返回 `198.18.0.17` 且无代理时，错误含 host、地址和代理提示；`resolve` 返回 `10.0.0.1` 时错误不含该提示；设置代理后同一 URL 成功
