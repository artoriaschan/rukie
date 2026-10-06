Status: resolved
Blocked by: none

# 01: Kitty 图形公开接口与 PNG 渲染基线

提供通用 Image 原语与能力/cell 像素尺寸 hook，不依赖 Agent Core。分块探测回复在输入解析前吞掉，PNG 上传、placement、去重及卸载清理形成已验证共享基线。公开 ImageProps 包含原像素 crop 矩形，width/height 为 cell 几何；useTerminalGraphics 暴露 supported/cellWidth/cellHeight，RenderOptions.env 可注入环境。后续完整 renderer 生命周期与资源预算由 03 负责。

## Comments

2026-10-06：用户请求消息流图片 UI，既定公开 seam 为 render + 注入 terminal，参照根 AGENTS.md；集成基线 main 85d0dfa。

2026-10-06：renderer 基线提交 27262b3，merger 以 5bf5111 合入集成分支。公开 graphics focused 2 pass / 0 fail / 6 assertions，tsc -b exit 0。renderer implementer 自身 focused graphics/input/fullscreen 12 pass / 0 fail。02 与 03 从此共享基线独立继续：应用行为与底层生命周期分别拥有不同模块。
