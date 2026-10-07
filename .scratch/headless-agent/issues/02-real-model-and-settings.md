# 02: 真实模型与配置

**What to build:** 用户在 `~/.neant/settings.json` 里配好 `model`（以及可选的自定义 provider）之后，`neant -p` 会调用真实模型。具体行为：

- 内置 provider 从标准环境变量读取 key。
- 自定义 provider 支持 Chat Completions、Responses、Anthropic Messages 三种 api，配置里只写存放 key 的环境变量名，不写明文 key。
- 项目级 `.neant/settings.json` 只能覆盖 `model` 和 `allowTools`；如果它定义了 `providers`，则忽略并给出警告。
- 可以用 `--model provider/id` 和 `--thinking` 覆盖设置。
- 配置不合法（指出是哪个文件、哪个字段）、模型缺失或 key 缺失时，给出明确报错，并返回约定的退出码。

Blocked by: 01

Status: resolved

- [x] settings 的 typebox schema 放在 `@neant/shared`，字段有 `model`、`thinking`、`providers[]`、`allowTools[]`、`trustedProjects[]`
- [x] 用户级和项目级 settings 合并时，项目级的 `providers` 被忽略并给出警告
- [x] 内置 provider 和自定义 provider 都能注册，`--model` 和 `--thinking` 参数生效
- [x] 退出码：成功为 0；运行失败或配置错误为 1；参数错误为 2
- [x] 建立 Seam 2：测试真实启动 `neant` 子进程，模型端用 `Bun.serve` 起一个假的 OpenAI 兼容（Chat Completions）服务，通过临时 home 目录里 settings 的自定义 provider 指向它；至少覆盖 text 输出、缺少模型或 key、参数错误三种情况
- [x] Seam 1 测试覆盖"项目级 settings 不能定义 provider"这一点

## Comments

- 实现说明：`loadSettings` 从 `@neant/agent` 导出，由 CLI 调用后把合并结果（叠加 `--model`/`--thinking`）传给 `createSession({ settings })`；`createSession` 用 `builtinModels()` 加上自定义 provider（`createProvider` + `envApiKeyAuth`）解析 `settings.model`，并在 Run 之前检查 key。
- 项目级 `providers` 在校验之前就被剥离，所以格式错误的 `providers` 也只会产生警告，不会让 Run 失败。
- `SessionOptions` 仍保留可选的 `model`（必须和 `streamFn` 一起传），供进程内测试注入 faux 模型，跳过 settings 解析。
- 自定义模型可选填 `reasoning`、`contextWindow`、`maxTokens`，默认值分别为 false、128k、16k。
- 内置 provider 缺 key 时，报错只写出 provider 名，不写环境变量名（pi 的 `findEnvKeys` 只返回已经设置的变量）。
- `--model` 不是 `provider/id` 格式算参数错误（退出码 2）；格式正确但模型不存在算配置错误（退出码 1）。
