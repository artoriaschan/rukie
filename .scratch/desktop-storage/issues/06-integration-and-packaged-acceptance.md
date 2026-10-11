# 06: 存储隔离集成与真实打包验收

**What to build:** 按[存储调整规格](../spec.md)和 [ADR-0035](../../../docs/adr/0035-desktop-isolated-sqlite-storage.md) 实施本票能力。

Blocked by: 02, 03, 04, 05

Status: claimed

- [ ] 集成 01–05，附件原生消息块与外置文件适配不丢图片，文件历史与分支引用、失败写入/清理同步 owning modules
- [ ] 隔离 HOME/TUI 配置和 appData，验证双端同项目独立 Session、信任/凭证/skills/MCP，桌面不写旧用户目录
- [ ] 真实 Session 输出/abort/resume/subagent/readonly/索引失败与 crash 回归；主进程单实例、sidecar shutdown/restart 与 SQLite 连接/执行 lease 清理
- [ ] 实际签名 macOS arm64 app 正常启动，真实 safeStorage/钥匙串录入重启认证、替换删除、取消失败；不用 mock keychain 代表生产成功
- [ ] 完成受影响消费者盘点、focused timings/static 和适用 aggregate 检查；共享配置/存储/Jobs 接缝有跨模块风险时先说明再跑一次全量
- [ ] 同步所有当前 README/architecture/配置例子/tech-stack 与 ADR Coverage，评审和 tracker 状态按真实实施验收更新；仅文档通过不关闭本规格

## Implementation Evidence

Dedicated issue06 worktree/branch starts at integrated 01–05 tip `15909b8b`. Public seams authorized by the spec: real Session/storage observation/restore/cleanup and Electron startup/shutdown/credential operations; TDD and rukie-doc applied. Attachment tracer initially failed because no external bytes existed; native Storage adapter now saves root-relative content hashes, fsyncs files before commits, and hydrates original image blocks for all reads. Real readonly/resume preserve image bytes/names. Checkpoint relative references survive historical branch rewind, orphan cleanup repeats safely, and a symlink escape fails before model invocation. Cleanup is lease-owned and checks every native record and historical document revision; other Sessions are not deleted by age.

Electron second-instance tracer failed before the lock was implemented; main now quits before a second window/sidecar, restores/focuses the existing window, and shares one shutdown promise through window/app close. Current owning documentation synchronized without publication claims. Tickets/spec remain claimed pending root independent review and aggregate acceptance.

Focused impacted Core/server set: 105 pass, 0 fail, 8 files, 7.14s, including real crash/unsafe child recovery, output/abort/shutdown/lease, readonly/index recovery, isolation and terminal regressions. New scenarios 25–87ms; native crash integration 318ms. Expected native poisoned-session diagnostics accompany intentional attachment admission failure. `check:dev` passed; earlier Knip unused internal export fixed. Local desktop and real browser/package acceptance still running; no aggregate/CI/PR/merge claim.

ADR Coverage: ADR-0035 implemented resource/reference and lifecycle constraints; ADR-0024 native execution/history, ADR-0017 rewind branches, ADR-0034 Cookie-free startup with explicit safeStorage, ADR-0029 host/server/Core ownership retained. Domain meanings remain unchanged and no new term or ADR is required. Standards review identified stale storage implementation descriptions: CONTEXT Checkpoint and Session Store now distinguish terminal JSONL/homeDir history from isolated desktop SQLite/relative references, and ADR-0003/ADR-0024 replacement chains now point through ADR-0032 to ADR-0035. The ticket remains CLAIMED pending genuine macOS safeStorage and final acceptance.

Unified real browser acceptance exposed two integrated defects, fixed with red public regressions: new chat displayed the catalog model but omitted that Model Selection in its command, and the client discarded `model_unavailable`; the displayed new-Session choice now matches the submitted choice and the existing zh/en actionable message is preserved. Existing Session references never auto-switch. Lease-free history now projects stored outputRef into a generic result view without instantiating tools/model/auth, retaining full-output reader after provider deletion. Focused Bash readonly output regression passes646ms; Core/server31pass3.67s; local desktop25files92tests9.02s; check:dev passes. GUI repeat confirms first-send without manual model selection creates a real Session. Signed clean source6b47a83 build validates hardened runtime/arm64/asar integrity/Cookie fuse and JIT1, app starts normally; genuine safeStorage acceptance pending locked macOS UI, no mock claim. Native UI inventory explicitly required manual unlock. Remaining browser history/reselect and finalcurrent packaged acceptance remain pending.

Browser repair repeat on `4d3cf021`: fresh displayed-default first-send creates a real Session; deleted provider and fully restarted sidecar with same SQLite data, reopened history still exposes full-output pagination. Explicit replacement provider selection continues that same history to a new reply. Browser runtime errors empty, informational Vite/React console only; no horizontal page overflow. One retry failure came from the external fake endpoint exiting and resolved after its isolated restart. Evidence and Light/Dark/420 screenshots live outside repo in the task evidence directory. Browser/Vite/sidecar/fake endpoint closed and awaited, explicitly nonproduction fixture removed.

Final runtime candidate rebuilt clean `4d3cf021ef65d71ca197626b9b8bdce5736da2d6`; artifact `package-06-final/package/mac-arm64/Rukie.app`, metadata `package-06-final/desktop-build.json`: arm64/ad-hoc hardened runtime/strict deep codesign, sidecar JIT1, asar integrity and Cookie Encryption disabled verified. Earlier build `6b47a83` reached normal `app://rukie` renderer/preload without mock-keychain flags. Native UI inventory reported locked Mac requiring human unlock; valid native encrypted-save success not established. Original app process exited137 with unknown trigger, remaining owned package processes were stopped and awaited; no leftovers. Final rebuilt app's genuine safeStorage save/restart-auth/replace/delete/failure/cancel and graceful shutdown remain required pending human unlock. No publication, CI or production encryption success claim.
