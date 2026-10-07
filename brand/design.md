# Rukie 角色头像

TUI 头部使用用户认可的二次元女性角色头像，以 `rukie-character-design.png` 为原型。银紫发、双细辫、紫色眼睛、粉色 `>` 发饰与高领外套构成角色特征；品牌主题色为 `#E85693`。`rukie-avatar.png` 是当前高清透明头像，`rukie-app-icon.png` 是同一角色的桌面应用图标。目录只保留这版角色的物料与生成工具。

## 高清呈现

参考 dsh-TUI `3c89ea516e4f7d2777efe979200016528722a0b4` 的 `maidPortrait.tsx` 与 `LogoV2.tsx`：优先通过终端图像协议展示完整 PNG，字符头像只用于能力不可用时的回退。Rukie 复用现有 `ink/Image` 和 Kitty 能力探测；支持 Kitty 的终端直接显示 `rukie-avatar.png`，保留原始分辨率、完整配色和透明边缘。该 PNG 使用 imagegen 生成，提示词要求沿用角色原型，绘制银紫发、双细辫、粉色发饰与高领外套的高清透明头像。

确认图像能力后才加载 PNG，每个进程缓存一次；缺失或 PNG 头部无效的素材保留字符头像。高清图与字符头像共用 40 列 × 14 行的布局空间，图片按照终端报告的字符尺寸等比缩放并居中，切换时不移动右侧文字。高清头像为静态图，不播放字符动画。图片预览打开时暂停头部图像，关闭后恢复，保持同一布局空间。滚动裁剪、resize 删除重绘和退出清理由现有图像渲染器负责。

dsh-TUI 还支持 Sixel；Rukie 当前图像渲染器只支持 Kitty。Sixel-only、tmux/screen 和未确认图像能力的终端使用字符回退。

## 字符回退

头像以 40 × 28 色板像素存储，每两个纵向像素用一个 `▀` / `▄` 字符与前景、背景色显示，实际占 40 列 × 14 行。字符回退沿用同一角色的轮廓与配色，并对眼睛反光与发饰做了逐像素整理，使低分辨率下的特征清晰。空白像素采用终端默认背景，字符回退不读取 PNG，也不依赖图片协议。

字符头像包含标准、眨眼、轻点头三个姿态。进入欢迎页时播放约 1.92 秒的出场动画，随后间隔眨眼和点头；首次开始工作后固定为标准姿态。窗口不足 76 列或 20 行时隐藏头像并停止动画，保留名称与模型、可选思考强度、工作目录。其余界面的主题配色由现有主题控制。

## 素材与实现

- `frames.json`：终端头像的权威色板与三个姿态网格，可直接编辑。
- `render.py`：读取网格，生成 TypeScript、ANSI、PNG 与 HTML 预览，只使用 Python 标准库。
- `standard.ansi`、`blink.ansi`、`nod.ansi`：三个姿态的实际 ANSI 文本。
- `standard.png`：同一网格生成的放大静态对照图。
- `preview.html`：解释实际 ANSI 字符与颜色的离线预览。

产品实现位于 `packages/coding-agent/src/tui/components/logo/`：`avatar-frames.ts` 为生成的色板与网格，`avatar.tsx` 负责字符回退的半块渲染与动画，`avatar-portrait.ts` 负责高清素材加载，`logo.tsx` 负责图像能力分流及名称和信息布局。修改 `frames.json` 后执行：

```sh
rtk proxy python3 brand/render.py
rtk proxy bunx --no -- oxfmt packages/coding-agent/src/tui/components/logo/avatar-frames.ts
rtk proxy cat brand/standard.ansi
```

生成脚本验证网格尺寸和色板字符；头部测试通过 `@xterm/headless` 验证实际渲染的品牌色、眼部前景与背景色、外围默认背景、元数据布局、resize、动画停止与定时器清理。高清头像测试核对上传的 PNG 尺寸、原始字节、元数据布局、resize 删除与重绘、退出资源清理；图像渲染器测试覆盖滚动裁剪。动画测试使用虚拟时间。不同终端字体的视觉效果仍需在实际终端检查。

## 桌面应用图标

`rukie-app-icon.png` 是 1024 × 1024 RGBA 桌面应用图标：角色脸部特写置于 `#E85693` 圆角底板上，板外透明，保留银紫发、紫色眼睛与粉色 `>` 发饰。图标使用 imagegen 根据当前高清头像生成，提示词要求简化细碎线条、保持角色身份、提高 32/64 像素下的辨识度，不包含文字。

- `rukie-app-icon.icns`：macOS 图标包，包含 16、32、64、128、256、512、1024 像素表示。
- `rukie-app-icon.ico`：Windows 图标包，包含 16、24、32、48、64、128、256 像素表示。
- `export-icons.py`：通过 macOS 自带 `sips` 与 `iconutil` 导出平台图标；Python 标准库封装 ICO 内的 PNG 表示，不添加图像依赖。

重新导出：

```sh
rtk proxy python3 brand/export-icons.py
```

当前仓库没有 desktop 包或打包配置；这些文件可用于后续打包，尚未接入应用安装包。`rukie-character-design.png` 保留当前角色设计稿，`rukie-avatar.png` 继续由 TUI 头部使用；字符回退的 `frames.json`、ANSI、PNG 对照图与预览仍属于同一版角色。
