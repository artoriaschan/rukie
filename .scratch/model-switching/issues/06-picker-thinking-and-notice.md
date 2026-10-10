# 06: 档位条、合并提示与状态栏

Status: in-progress

Blocked by: 01, 04

**What to build:** 面板底部加档位条，内容为焦点模型的 `thinkingLevels`。←/→ 只调整草稿，按 Enter 时用 `setModelSelection` 让模型和档位一起生效，按 Esc 放弃。只改档位也算一次切换。根据返回值生成合并提示（名称和 spec、档位、降档说明）。状态栏的档位改为来自 `session.thinkingLevel`。Run 进行中输入 `/model` 时给出提示。见 spec 用户故事 7–13。

- [ ] 终端断言：←/→ 调整档位后按 Enter，状态栏显示新档位，提示合并为一条
- [ ] 终端断言：`reasoning: false` 的模型档位条显示为不可用；切到不支持当前档位的模型时，提示里说明降档
- [ ] 终端断言：Esc 放弃草稿；`/model <spec>` 只切模型
- [ ] 终端断言：Run 进行中输入 `/model` 时出现提示，面板不打开

## Claim

Owner: fresh implementer issue_06; worktree `/tmp/rukie-model-switching-06`, branch `feat/model-switching-06`. Confirmed integration `feat/model-switching` is an ancestor of initial HEAD `f16c72ed`. Tests use the spec-authorized app/headless terminal and view projection seams.
