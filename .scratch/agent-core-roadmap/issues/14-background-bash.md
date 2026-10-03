# 14: 后台 bash

Type: grilling
Status: open
Blocked by: 02

## Question

长时间运行的进程（dev server、watch）怎么让模型启动、读取输出、杀掉？

需定：工具形态（bash 加 `background` 参数 + 读取 / 终止工具，还是独立 shell 会话工具）；输出缓冲上限与增量读取；进程生命周期与 session 的关系（run 结束、退出 TUI、resume 时进程如何处理，是否按地基 B 记录）；新输出是否作为 reminder 推给模型；TUI 呈现（后台任务列表）。
