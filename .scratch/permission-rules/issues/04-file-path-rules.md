# 04: 文件路径规则

**What to build:** 用户写 `read(~/.ssh/**)`、`edit(src/**)` 或绝对路径规则，约束文件工具（read / edit / write / glob / grep）。`~/` 展开为 home；相对路径按项目根解析；glob 和 grep 省略 `path` 时按 cwd 算。deny 和 ask 对 resolve 后与 realpath 后两个路径都匹配，任一命中即生效；allow 只认 realpath。路径不存在时，对最近一个存在的祖先取 realpath。因为只读工具的默认放行属于模式阶段，`deny: ["read(~/.ssh/**)"]` 能拦住 read。

**Blocked by:** 02

**Status:** claimed

参考：[spec](../spec.md)「Permission Rule」中的文件工具与目标路径；User Stories 4–6、24–26。

- [x] 纯函数表驱动测试：`~`、相对路径、绝对路径、glob / grep 缺省 path、尚不存在的文件
- [x] 在临时目录里真实建软链测试：项目内指向外部敏感目录的软链被 deny；项目路径的 allow 不能经软链放行外部文件
- [x] e2e：`read` 被 deny 规则拦截（ask 模式与 full-access 各一）
- [x] 文件工具以外的工具写路径 specifier 时，仍按 02 的规则报错
- [x] `tsc -b` 与全量 `bun test` 通过

## Comments

- 2026-10-04：实现完成，双轴 code-review 待执行；仍为 claimed，审查与集成后再 resolved。
- `evaluatePermissionRules` 保留规则集、工具名、已校验参数、cwd、homeDir 五输入入口。文件系统边界集中在 `resolvePermissionPath`，内部 `matchesPermissionPath` 为纯匹配内核；deny / ask 匹配 resolve 与 realpath 两种路径，allow 只匹配 realpath。
- 路径不存在时从最近可 realpath 的祖先补齐叶子；同时跟随 dangling symlink 的目标，避免尚不存在的项目外文件借项目 allow 写入。只有 ENOENT / ENOTDIR 被当作缺失路径，其他 realpath 错误直接抛出；readlink 仅对缺失或非软链情况回退。
- TDD：read 路径 deny（直接读取与软链读取，ask / full-access）先 0 pass / 2 fail 后通过；dangling symlink 回归先 26 pass / 1 fail 后 27 pass / 0 fail。
- 验证：`rtk proxy bunx tsc -b` exit 0；权限 focused 121 pass / 0 fail（6 files、377 expect）；源码冻结后 `rtk proxy env -u NO_COLOR bun run check` exit 0，852 pass / 0 fail（67 files、5045 expect、111.34s），fmt / lint / typecheck / knip 全通过。
- 范围：不修改 bash 复合匹配、配置合并与 session allow；规则 pattern 按 spec 仅 resolve，真实路径准备只针对工具目标。macOS 临时目录测试使用 canonical cwd / home，避免 `/var` 系统 alias 混入语义。
