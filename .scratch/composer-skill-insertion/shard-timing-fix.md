# 分片计时路径增量修复

负责人：本次全新实施代理；工作树 `/tmp/rukie-composer-shard-fix`，分支 `fix/composer-shard-timing-path`，基线为集成 `9d1347b4`。所有工单继续 claimed，由主代理维护统一验收与交付状态。

## 原因与变更

主代理最终 release 阶段记录 112 pass / 1 fail，166.09s；原日志 `/var/folders/ql/gqv08x1d593_4fssr6n92gq80000gn/T/rukie-composer-final-jbw9awqo/release-tests.log` 保留失败结果。失败为 workflow 分片合同测试逐一验证计时文件路径存在。票 06 将 MCP 测试 `packages/agent/tests/mcp/manager.test.ts` 重命名为 `packages/agent/tests/mcp/host.test.ts`，计时映射遗漏同步。

逐项检查当前映射，唯一不存在的路径为 manager.test.ts；`origin/main..HEAD` 的文件状态确认对应 rename。只把计时 JSON 的该路径改为 host.test.ts，原测量值 83 保留为重命名种子，没有重新测量、编造时长或删除覆盖。没有改生产源码、测试、依赖或其他计时项。

## 红绿与证据复用

- 修改前：`rtk proxy env -u NO_COLOR bun test scripts/release/tests/workflows.test.ts -t 'all four shards test'`，0 pass / 1 fail / 5 filtered，8ms；case 1.15ms，在原第 145 行路径存在断言失败。
- 修改后同一命令：1 pass / 0 fail / 5 filtered，8ms；case 1.74ms，1595 assertions。
- 仅此元数据路径使该 workflow 合同证据失效；复用父代理已有 source 与其他 release 结果。不运行完整 release、完整 check、desktop package 或手工浏览器/Electron。
- 工作树依赖用 `rtk proxy bun install --frozen-lockfile` 准备，成功（1.189s），manifest 与 lockfile 未改变。两个变更文件的 oxfmt --check 通过（164ms），git diff --check 退出 0；提交保持正常 hooks。
