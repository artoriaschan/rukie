# 05：`--isolated` 验收模式与文档

Status: ready-for-agent

Blocked by: 01, 02, 03

**What to build:** 按 [spec](../spec.md#--isolated-验收模式) 为代理 agent-browser 验收提供一次性环境，并把验收入口写入规则文档。

- [ ] `--isolated`：配置根与数据根在本次运行的临时目录，退出时删除；后端 `memory`；不访问系统钥匙串
- [ ] 启动只监听 loopback 的 OpenAI 兼容 fake 端点，复用 `scripts/release/tests/provider-protocol.ts` 的协议回包；握手后经 `modelServices.save` 预置指向它的供应商与模型
- [ ] 测试覆盖临时目录清理、fake 供应商预置、对话收到固定回复、退出后端口与目录释放
- [ ] AGENTS.md 与 [testing.md](../../../docs/testing.md#原生验收授权边界) 中“mock DesktopHost / 模拟 DesktopHost”改为 `dev:desktop:web --isolated`；`test:desktop` 的 mock 边界不变
- [ ] spec 的 ADR Coverage 与最终实现复核后关闭 spec
