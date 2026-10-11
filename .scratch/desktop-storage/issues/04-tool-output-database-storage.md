# 04: 工具完整输出分块入库

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 02

Status: claimed

- [ ] 盘点 Jobs registry spill、Bash fullOutputPath、job_output、工具结果卡和所有读取消费者；桌面完整 stdout/stderr 与后台 Job 输出按调用身份持久化
- [ ] 分块有序追加并支持字节游标/按需读取；模型截断不删除完整输出；最终结果和关闭等待写入完成，失败不报告成功
- [ ] 桌面去除临时日志文件的权威路径引用，公有输出读取接口适配；不改终端所需文件输出策略和既有用户可见行为
- [ ] 超过内存截断阈值、流式 ordering、abort、后台输出、崩溃/恢复与同名调用 ID 复用回归；测量 FULL 批量写入成本
