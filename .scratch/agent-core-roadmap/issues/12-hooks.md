# 12: hooks

Type: grilling
Status: open
Blocked by: 03, 05, 11

## Question

工具调用前后（及其他生命周期事件）执行用户脚本的机制。

需定：事件集合（工具前后、run 开始 / 结束、用户提交 prompt、compaction 前 …）；脚本输入输出协议（stdin JSON / 退出码语义）；能否阻断、改写参数、向模型注入上下文；与权限规则在地基 C 链上的先后；配置位置与项目级 hooks 的信任问题（项目 hooks 等同执行任意代码）；超时与失败处理。
