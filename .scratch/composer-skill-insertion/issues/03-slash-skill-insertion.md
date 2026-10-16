# 03：用 `/` 插入技能（主线示踪）

Status: resolved
Blocked by: 01

**What to build:** 按 [spec](../spec.md) 的「插入列表」「技能标记」「技能数据」各节，打通第一条完整路径：用户在输入框开头输入 `/`，在输入框上方看到技能列表，选中后输入框开头出现蓝色技能标记，发送后 Agent Core 识别为 Skill Invocation。本票的列表只包含「技能」一组，内置命令由 05 加入。

- [x] Agent Core 技能列表返回 `scope`（user/project）与 `filePath`，同名时项目覆盖用户，只返回生效项
- [x] wire 新增不依赖 Session 的技能列表命令，参数为项目或会话标识，无项目时只返回用户级技能；server 校验与测试
- [x] DESIGN.md 先补技能标记与插入列表规范（颜色、间距、行高、图标、截断与收缩规则），全部使用已有角色
- [x] 列表在输入框上方、与输入框同宽；最多 10 个可选项，超出滚动并保持高亮可见；组标题「技能」，空组隐藏
- [x] 技能行：图标、名称、名称后的描述、右侧「全局」或「项目」标签；单行，描述截断并悬停显示全文；窄宽度先收描述、再截名称，右侧最后截断；按名称字母排序
- [x] 仅当输入以 `/` 开头、光标在首行且 `/` 后无空白时出现；按名称过滤，不区分大小写，前缀优先；无匹配时关闭，回车发送原文
- [x] 焦点留在输入框；上下键、回车、Tab、Esc、点击；组合框与选项的无障碍语义
- [x] 技能标记为 token 模式 TextNode：整体删除、光标不可进入、只能是第一个节点、再选替换；选中替换 `/xxx`，光标在标记后并补一个空格
- [x] 发送序列化为 `/名称 正文`，只有标记时为 `/名称`；Run 进行中作为插话提交
- [x] 每次打开列表先显示缓存再后台刷新；新会话页按选中项目取数，切换项目时刷新
- [x] 浏览器测试覆盖上述交互、窄宽度与无障碍语义，并验证发送内容被 Core 识别为技能调用

## Comments

## Implementation and verification evidence

Owner: fresh implementer `implement_03`, isolated `/tmp/rukie-composer-03`, branch `feat/composer-ticket-03`, based on integrated `62124c8a`. Status remains claimed pending integrated review and final acceptance. Applied the repository TDD, beUI, shadcn and rukie-doc workflows; approved public seams come from the spec Testing Decisions. No CodeGraph directory exists in this isolated checkout.

- Core effective catalog adds scope and absolute filePath, preserves project override and user-invocable filtering, and supports omitted cwd for user roots only. The server skills.list command resolves optional Project or Session identifiers from registry/history without opening a Session. All listSkills consumers were found; the desktop-data expectation now includes the public metadata, while TUI continues consuming name/description.
- App caches catalogs per Project/Session, refreshes on scope change and each opening, and rejects superseded refresh responses. The editor uses token-aware draft comparison and serialization so controlled rerenders preserve atomic nodes. Existing live-Run prompt submission carries the slash text as steering.
- Reused installed beUI Popover and repository ScrollArea. The custom listbox composition is required to keep focus in Lexical and expose aria-activedescendant; ordinary menu/select primitives own focus themselves. No new primitive or dependency was installed. beUI MCP catalog discovery confirmed Popover. Popover allowFlip defaults true for existing consumers; only this picker opts out and constrains height to the available space above its anchor. Existing consumers are composer context and Project hover detail.
- DESIGN.md defines the token and list roles before styling. The panel is outside normal flow. Keyboard, pointer, active-descendant, grouping, name-only filtering/prefix priority, 10-row scrolling, source labels, description title, narrow collapse, atomic deletion, token-only send, replacement, controlled edits and undo have Chromium component coverage. README contracts describe the current slash skill path; clipboard/history and builtins remain tickets 04/05.

Commands use rtk proxy. Automated Chromium uses isolated scripted wire fixtures and no native Electron, real settings or credentials.

1. Core tracer red: `bun test packages/agent/tests/e2e/skills.test.ts -t 'frontend skill catalog'` failed as expected because scope/filePath were absent (150ms). Green: 1 passed, 3 assertions, 178ms. It calls public createSession and verifies the submitted `/review inspect changes` produces the project Skill Invocation reminder. Final focused check after absolute-path normalization: 1 passed, 212ms.
2. Wire tracer red: `bun test packages/server/tests/server.test.ts -t 'skills.list works'` failed because the command was unknown (187ms). Initial green: 1 passed, 186ms; expanded final green: 1 passed, 7 assertions, 262ms. Covers no-Project/new-chat, effective Project override, existing Session scope, missing identifiers, bad types and mutually supplied identifiers. An intermediate expectation was corrected for macOS canonical /private paths.
3. Chromium tracer red: from packages/ui, `bunx --no vitest run --project ui-browser tests/components/skill-insertion.browser.test.tsx` failed because no combobox existed (15.80s). First green: 1 passed, 771ms. Expanded component cases passed; an intermediate locator needed the explicit row accessible label because narrow layout correctly hides the description.
4. `bun test packages/agent/tests/e2e/skills.test.ts packages/agent/tests/e2e/desktop-data.test.ts`: 31 passed, 189 assertions, 1.67s. No new/modified Core case exceeds one second.
5. From packages/ui, `bunx --no vitest run --project ui-browser tests/components/skill-insertion.browser.test.tsx tests/app/skill-insertion.browser.test.tsx tests/app/layout.browser.test.tsx tests/components/composer.browser.test.tsx tests/components/compact-composer.browser.test.tsx tests/components/input-focus.browser.test.tsx`: 31 passed, 3.77s. Retained exact shell geometry assertions, IME/newline/image/focus behavior and compact composer consumers.
6. Supplementary existing consumers `tests/app/skill-insertion.browser.test.tsx tests/app/project-hover.browser.test.tsx tests/app/goal-mode.browser.test.tsx tests/app/plan-mode.browser.test.tsx tests/app/shell.browser.test.tsx`: 52 passed, 1 failed, 24.71s. The failure was the search test's bare combobox locator becoming ambiguous with the new accessible composer; it now names Search chats. The analogous archive search locator is scoped to its dialog. Minimum rerun `tests/app/skill-insertion.browser.test.tsx tests/app/shell.browser.test.tsx -t 'skill|steering|search is a modal'`: 4 passed, 21 skipped, 1.77s. This covers cached-first/background refresh, new-chat Project switching and running Session steering.
7. New explicit height regression red: catalog-enabled PromptInput was 118px versus existing 94px because the empty Popover root remained in normal flow (778ms). Moved only that root out of flow. Green `tests/components/skill-insertion.browser.test.tsx tests/app/layout.browser.test.tsx`: 13 passed, 3.23s, including exact baseline height and unchanged bounds when the panel opens. Earlier undo/disabled fixture placed its Disable button under the correctly anchored overlay; moved the fixture button below the editor. Undo and disabled interaction pass (821ms focused); all six earlier component cases passed in 1.39s before the seventh geometry case was added.
8. Focused oxlint over changed production/new-test modules: exit 0. Oxfmt writes/format checks and git diff --check pass. `bun run docs:update` and `bun run check:docs`: exit 0 (157 Markdown files). Area `bunx --no tsc -b packages/ui packages/server` and `bunx --no tsc -b packages/ui` report only six pre-existing errors in packages/agent/tests/mcp/manager.test.ts (removed createMcpManager import and consequent implicit-any callbacks at lines 3,20,57,74,75,100). Ticket 06 owns that relocation; no unrelated MCP changes were made here.

Aggregate/static acceptance and final Light/Dark/narrow manual Chromium verification remain parent-coordinated. No full check, package-wide test run or manual browser acceptance was duplicated by this implementer. All new UI cases complete below one second individually; earlier 15-second failures were assertion/locator timeout bounds, not retained waits.

Handoff seams: ticket 04 can extend SkillTokenNode serialization/import and mount a clipboard plugin next to SkillPicker in PromptEditor; $serializePrompt is the existing transport serialization owner. Ticket 05 can extend the grouped SkillPicker and its editor command handler for builtins and the plus entry. Composer and PromptInput already receive scoped skills/onSkillsOpen; do not create a second catalog or editor model.

- 2026-10-16 交付关闭：实现、维护文档与两路独立评审修复已完成；主代理适用本地验证、失败聚类与增量复验、Chromium 截图及 ADR Coverage 结论见 [最终验收](../verification.md#最终交付验收--2026-10-16)。PR [#42](https://github.com/artoriaschan/rukie/pull/42) 等待最新 CI 与用户评审；resolved 不表示已合并。原中间结果与 claimed 历史记录保留。
