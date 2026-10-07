# 01：产品版本与 CLI 信息入口

Status: ready-for-agent
Blocked by: None

## What to build

用户无需配置模型或启动 Session，即可通过 rukie 的 help/version 入口了解用法和准确的产品版本。维护者只维护一个 coding-agent 产品版本，应用请求中的版本信息与之保持一致。

## Acceptance criteria

- [ ] 建立初始为 0.1.0 的唯一产品版本来源；内部 workspace 包继续私有，不引入独立发布生命周期。
- [ ] help/version 在无 TTY、无 provider 凭据时退出 0，不初始化 Session、不读取或写入真实用户设置与 Sessions。
- [ ] 共用参数解析定义 help/version 与其他参数组合的确定行为，未知参数和不合法组合保留正确错误与退出状态。
- [ ] help 和相关错误同时提供中英文文案，用法与实际 Headless CLI/TUI 行为一致。
- [ ] 应用的版本输出和请求版本信息一致；Agent Core 通过内部接口获得应用版本，不反向导入 Frontend。
- [ ] 通过公开 main/命令入口覆盖输出、退出码和无 Session 副作用，并保留共用入口与动态 Frontend 加载的既有回归。
- [ ] 更新命令使用说明，记录实际测试结果及版本注入的调用方义务。

## Context

父规格：[npm 发布规格](../spec.md)。对应用户故事 7–9、21、26。架构与范围沿用父规格 ADR Coverage；不处理 Yoga。

## Comments

- 2026-10-07：用户确认九张纵向工单拆分。无前置工单，可立即开始；当前仅发布工单，未实施。
