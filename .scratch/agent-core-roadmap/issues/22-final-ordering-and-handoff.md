# 22: 最终排序与 handoff

Type: grilling
Status: open
Blocked by:

## Question

01–21 号能力工单已全部定完。汇总它们之间的依赖图，结合 main 上已落地的实现，给出剩余能力的实现顺序与 handoff 清单。

需定：

- 已落地、部分落地、未开始，各有哪些能力。依据 main 的 git 历史、`.scratch/<feature>/` 下的 spec 与票据状态。
- 剩余能力之间的硬依赖（地基 A/B/C 的消费者、Tool State、交互回调），以及哪些可以并行。
- 排序。按 Notes 的原则：先地基，再按学习价值，sandbox 最后（已划出范围）。
- 每项走出地图后的入口：已有 spec 的直接实施，没有 spec 的先走 `/grill-with-docs` → `/to-spec`。
- 地图收尾：确认 Destination 已达成，关闭地图。
