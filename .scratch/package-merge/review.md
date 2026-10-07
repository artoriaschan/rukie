# Package merge 集成审查

集成分支：`codex/package-merge`。审查基点：`be5b1e20bf29a3468abe60eccf96b6c5a7f2ce84`；代码审查终点：`1220dc6f27a7f9465002b8e62990fb9f9441c61c`。范围由 [spec](spec.md)、[01](issues/01-move-packages.md)、[02](issues/02-unified-entry.md)、[03](issues/03-view-layer.md)、[04](issues/04-rename-rukie.md) 和 [ADR-0012](../../docs/adr/0012-single-coding-agent-package.md) 定义。

## Standards

0 个发现。独立审阅统一入口、view 抽取、图片 metadata、diff 高亮、取消流程、配置与 OAuth 改名、测试和文档，未发现新增的规范违规或需要处理的代码异味。

## Spec

0 个发现。独立核对规格、四张实施票及 ADR-0012，前期审查发现的子进程路径、历史记录保护、取消信号、lint 边界、lockfile bin 和旧 Logo 断言均已修复。

两个审查轴均无未处理发现。

## Verification

- 最终代码状态运行 `env -u NO_COLOR bun run check`：2774 pass、0 fail，227 files，15635 assertions，100.62s。完整 gate 包含格式、lint、类型、Knip、scratch 校验与测试。未在相同代码树上重复运行完整检查。
- `bun scripts/check-scratch.ts --report` 确认 package-merge spec 为 resolved、4/4 工单关闭；集成目录的 frozen install、当前 Markdown 相对目标、`git diff --check` 和工作区状态复核通过。
- `.rukie` 设置加载与旧目录忽略、Session Resume、真实本地 HTTP MCP OAuth 初次授权及重连客户端名、凭据复用、RUKIE 终端 Logo、Headless 模块加载隔离和实际安装 bin 均已验证。具体证据随各票保存。
- 269 个关闭或历史 scratch 文件保持原始内容。`CLAUDE.md` 保留相对 symlink；可执行入口以 0755 保存。

## 用户迁移

程序只读取新目录，不执行自动迁移。已有数据由用户执行 `mv ~/.neant ~/.rukie`，各项目执行 `mv .neant .rukie`；自写 hook 更新为 `RUKIE_*` 环境变量。仓库本地目录名、git remote 及对应的 `~/.claude/projects/` memory 目录由用户手动更新。
