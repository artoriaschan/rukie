# 09: 点击路径打开文件操作菜单

**What to build:** 用户点击卡片头部或 diff 路径行里的路径，弹出菜单选择打开文件、在文件管理器中显示或复制路径。见 [spec](../spec.md) 的「TUI 工具卡」FileActionsPanel 部分。

Blocked by: 02

Status: resolved

- [x] 路径段带下划线，点击停止冒泡，不切换卡片展开
- [x] FileActionsPanel 三项：打开（host `openExternal`）、在文件管理器中显示（host 新增 reveal：macOS `open -R`，Linux 打开父目录）、复制路径
- [x] 路径按 Session cwd 解析
- [x] 菜单可用键盘与鼠标操作，Esc 关闭；小终端下完整显示或裁剪
- [x] zh / en 文案
- [x] TUI e2e 用 fake host 断言三项动作

## Answer

- Read/write/edit header paths and unified/split diff path rows are underlined action targets. Nested painted path hitboxes win over the card's toggle callback, preserving expansion. Edit headers use their structured diff path rather than raw edit JSON.
- FileActionsPanel resolves targets against the Session cwd, invokes existing host.openExternal/writeClipboard and the new host.reveal capability. Reveal uses open -R on macOS, xdg-open on the parent directory on Linux, and Explorer /select on Windows. Paths remain individual process arguments.
- The modal captures keys, paste and mouse input, supports arrows/Enter/numeric choices/mouse/Escape, clips labels in narrow terminals and keeps selected actions reachable when only one or two rows fit. It preserves mounted chat/detail scroll state, dismisses delayed tooltips and closes for new Session interactions/rewind. Host failures remain visible through localized notifications.
- Public red evidence: clicking the existing read header toggled the card and could not open actions (one failing test, 2.46s deadline); edit header initially exposed raw JSON (190ms failing assertion). Public green: fake hosts validate open/reveal/copy absolute paths, zh/en mouse/keyboard/Escape, input and Ctrl+O capture, underlined terminal cells, unified80/split120 paths and narrow28x6 resize. Resume/clipboard-failure coverage also reproduced and fixed an interpolation error before passing in122ms.
- Validation: merged integration05/08 (f24688b), preserving Tooltip and SplitDiffView; passed check:dev. 39 related file-actions/expansion/diff/syntax/tooltip/child-detail tests across7files passed in6.27s; new scenarios133–278ms. Root owns the final aggregate gate after all tickets integrate.
