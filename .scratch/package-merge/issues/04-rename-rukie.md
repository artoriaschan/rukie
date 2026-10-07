# 04: 项目改名 Rukie

Status: ready-for-agent
Blocked by: 03

**What to build:** 把项目从 Neant 改名为 Rukie，只做文本替换和必要的资源补充，不改结构。见 [spec](../spec.md) 的"改名 Rukie"。

- [ ] 包作用域 `@neant/*` 改为 `@rukie/*`，根包名与 bin 改为 `rukie`，同步 bun.lock 与 lint 规则中的包名
- [ ] `~/.neant` 改为 `~/.rukie`，项目 `.neant/` 改为 `.rukie/`（settings、mcp、AGENTS.md、agents、sessions、file-history、input-history）；不读取旧名
- [ ] `NEANT_*` 环境变量改为 `RUKIE_*`，包括 hook 的 `RUKIE_PROJECT_DIR` 与测试变量
- [ ] MCP OAuth `client_name` 改为 `Rukie`；验证 resume 与 MCP 连接
- [ ] zh 与 en 文案、CONTEXT.md 标题与首句、AGENTS.md、docs、brand/design.md 改名
- [ ] Logo 显示 `RUKIE`；`splash-font.ts` 补 `U` 字形，沿用现有 5 行粗体格式；终端断言覆盖新 Logo
- [ ] 未关闭的 `.scratch` 工单与 spec 改名；resolved 记录不动
- [ ] `env -u NO_COLOR bun run check` 通过
- [ ] 交付说明写明用户需手动执行：`mv ~/.neant ~/.rukie`；各项目执行 `mv .neant .rukie`；更新自写 hook 脚本中的环境变量；改仓库目录名与 git remote；迁移 `~/.claude/projects/` 下的 memory 目录
