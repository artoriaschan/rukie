# 14: 编辑器、终端、diff、虚拟列表的专用库

Type: research

Blocked by: None

Status: needs-triage

## Question

MVP 主界面（[09](09-prototype-main-window.md#answer)）需要：长 Transcript 的虚拟列表（可变行高、流式追加、底部跟随、跳转 Turn）、工具输出与命令输出的展示、文件 diff（仓库已有 `diff` 8.0.4 计算）、代码块高亮（tech-stack 已定 shiki）。各角色在 React 19 + Tailwind 4 下选哪个维护中的库、精确版本、体积与可访问性？MVP 是否真的需要代码编辑器与交互式终端，还是只读展示即可？
