# 04: 文件路径规则

**What to build:** 用户写 `read(~/.ssh/**)`、`edit(src/**)` 或绝对路径规则，约束文件工具（read / edit / write / glob / grep）。`~/` 展开为 home；相对路径按项目根解析；glob 和 grep 省略 `path` 时按 cwd 算。deny 和 ask 对 resolve 后与 realpath 后两个路径都匹配，任一命中即生效；allow 只认 realpath。路径不存在时，对最近一个存在的祖先取 realpath。因为只读工具的默认放行属于模式阶段，`deny: ["read(~/.ssh/**)"]` 能拦住 read。

**Blocked by:** 02

**Status:** ready-for-agent

参考：[spec](../spec.md)「Permission Rule」中的文件工具与目标路径；User Stories 4–6、24–26。

- [ ] 纯函数表驱动测试：`~`、相对路径、绝对路径、glob / grep 缺省 path、尚不存在的文件
- [ ] 在临时目录里真实建软链测试：项目内指向外部敏感目录的软链被 deny；项目路径的 allow 不能经软链放行外部文件
- [ ] e2e：`read` 被 deny 规则拦截（ask 模式与 full-access 各一）
- [ ] 文件工具以外的工具写路径 specifier 时，仍按 02 的规则报错
- [ ] `tsc -b` 与全量 `bun test` 通过
