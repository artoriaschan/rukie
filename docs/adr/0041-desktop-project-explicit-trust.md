---
status: accepted
---

# 桌面端 Project 通过显式确认授予精确目录信任

## 问题

多目录 Project 需要确定 Session 的归属、未来会话的主目录，以及项目可执行配置的信任来源。旧 Project 登记并不表示用户确认过 hooks、MCP 和 allow 规则。

## 决定

Project 在应用 SQLite registry 中保存有序且非空的真实目录列表、主目录和显式信任状态；沿用 [ADR-0035](0035-desktop-isolated-sqlite-storage.md) 的应用组织信息归属。旧单目录记录读取为未信任 Project。

创建必须先通过界面信任确认，wire `project.create` 只接受 `trusted: true`。已有未信任 Project 打开或新建 Session 前补确认；拒绝仍可运行 Session，但不授予项目级配置。用户确认后 `project.trust` 持久化信任。服务端在打开 Session 时，将已信任 Project 的全部目录派生到 Agent Core 的用户 settings，不写回数据库 settings。已打开且未信任的 Session 在下次空闲执行时关闭并恢复，以加载新授予的配置；活跃 Run 不被中断。

[ADR-0014](0014-permission-rules-and-project-trust.md) 的精确路径匹配继续有效，不继承父目录信任。目录比较采用真实路径；一个目录只属于一个 Project，嵌套但不相等的目录可以分别登记。应用数据根及子目录不能登记。主目录重复选择复用已有 Project；其他交集返回冲突 Project 名。

切换主目录不改变 Project 名称与旧 Session cwd，只影响新 Session。旧 Session 按原 cwd 打开，所属 Project 的其余目录按 [ADR-0039](0039-session-additional-directories.md) 提供附加指令；hooks、MCP 和 settings 仍只从 cwd 加载。

## 备选方案

父目录信任继承与旧 Project 自动信任：规格已排除，避免未确认的可执行配置静默生效。把派生信任写入用户 settings：会产生应用组织信息与 settings 两个来源，故不采用。

## 影响

所有 UI 入口共享确认流程；取消创建不发送命令。目录选择、主目录与信任状态同步更新 wire、registry 与 UI。原生 picker 的 IPC 授权边界保持有效。公开行为与交付状态见[工单 03](../../.scratch/project-directories/issues/03-multi-directory-projects.md)。
