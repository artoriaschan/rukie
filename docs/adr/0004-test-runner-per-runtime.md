# 测试跑在生产代码所在的运行时上：Bun 代码用 bun:test，Electron 和渲染进程用 Vitest

运行在 Bun 上的包（agent、cli、server）用 `bun:test`，这样 Bun 专有 API 可以直接测，不必让 Vitest 跑在 Bun 上而碰到兼容问题。Electron main 和渲染进程用 Vitest 5，因为渲染进程测试需要 Vite 插件和 browser mode，main 进程则运行在 Node 上。仓库里因此有两套 runner，按目录分开。Vitest 等桌面端开工时再引入。
