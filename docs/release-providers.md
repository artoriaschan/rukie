# npm 分发的 provider 与认证验收

本文面向维护安装包的开发者，说明模型协议与认证路径的分发边界。安装包运行 Agent Core 与锁定的 pi 适配器，保持正常用户设置和凭据归属；分发决定见 [ADR-0023](adr/0023-npm-cli-distribution.md)，当前配置入口见 [Agent Core](../packages/agent/README.md)。

## 当前支持范围

模型注册表包含 pi 的全部内置 providers，用户设置可增加 `openai-completions`、`openai-responses`、`anthropic-messages` 三种自定义协议。以下是当前锁定目录中的十个模型协议族；同一 provider 可以使用多种协议，不以一条兼容服务请求代表全部适配器。

| 协议族                    | 内置 provider 示例                                             | 安装产物的验证边界                                           |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `openai-completions`      | DeepSeek、Groq、Moonshot、NVIDIA、Together、Qwen、Xiaomi、Z.AI | 自定义兼容服务的真实 Session、工具、恢复与取消               |
| `openai-responses`        | OpenAI、Meta、xAI、GitHub Copilot、OpenCode                    | 自定义 Responses 服务的真实 Session、usage 和取消            |
| `anthropic-messages`      | Anthropic、Kimi Coding、MiniMax、Vercel AI Gateway             | 自定义 Messages 服务的真实 Session、usage 和协议失败         |
| `azure-openai-responses`  | Azure                                                          | 内置模型与正常 Azure endpoint 环境变量的本地 Session         |
| `bedrock-converse-stream` | Amazon Bedrock                                                 | 内置模型的本地 AWS 签名请求与 SDK 错误处理；不宣称成功模型流 |
| `google-generative-ai`    | Google、OpenCode                                               | 构建模块包含关系；没有执行远程模型调用                       |
| `google-vertex`           | Google Vertex AI                                               | 构建模块包含关系；没有执行远程模型调用                       |
| `mistral-conversations`   | Mistral                                                        | 构建模块包含关系；没有执行远程模型调用                       |
| `openai-codex-responses`  | OpenAI Codex                                                   | 构建模块包含关系；没有执行远程模型调用                       |
| `pi-messages`             | Radius                                                         | 构建模块包含关系；没有执行远程模型调用                       |

完整 provider 清单包括 Amazon Bedrock、Ant Ling、Anthropic、Azure、Baseten、Cerebras、Cloudflare AI Gateway、Cloudflare Workers AI、DeepSeek、Fireworks、GitHub Copilot、Google、Google Vertex AI、Groq、Hugging Face、Kimi Coding、Meta、MiniMax、MiniMax CN、Mistral、Moonshot、Moonshot CN、NVIDIA、OpenAI、OpenAI Codex、OpenCode、OpenCode Go、OpenRouter、Qwen Token Plan、Qwen Token Plan CN、Qwen Token Plan Individual、Radius、Together、Typesafe、Vercel AI Gateway、xAI、Xiaomi、Xiaomi Token Plan AMS、Xiaomi Token Plan CN、Xiaomi Token Plan SGP、Z.AI、Z.AI Coding CN。Typesafe 注册存在，但没有当前目录模型；这不形成额外的 Rukie 用户配置协议。

## 认证入口与资源

用户 provider 定义只从用户设置读取。内置 provider 使用各自标准环境变量或上游凭据链；项目设置不能重定向 provider 的凭据。安装验收使用临时 HOME、正常 `.rukie/settings.json`、伪造密钥与 loopback HTTP 服务，产品子进程 PATH 不含外部 Bun。缺少密钥时的 `no-api-key` 只证明认证解析和错误处理，不能证明惰性模型实现已加载。

Rukie 当前调用 `builtinModels()`，没有注入持久化模型 CredentialStore，也没有模型登录命令或交互界面。上游默认模型凭据存储位于内存。编译入口通过上游 `registerBunOAuthFlows()` 静态注册 Anthropic、OpenAI Codex、OpenAI ChatGPT、GitHub Copilot、OpenRouter、Kimi Coding、Meta、xAI、Radius 九条 OAuth flow，保证分发包含现有能力。这是模块包含与注册证据，不等于用户通过 Rukie 完成远程模型登录。

MCP OAuth 是现有公开用户路径：TUI 的 `/mcp login <server>`、`/mcp logout <server>`、`/mcp reconnect <server>` 通过 Session 调用 pi-mcp 的 OAuth 发现、授权、令牌和重连。安装产物验收通过本地 OAuth 服务和隔离 PATH 的浏览器命令替身，验证真实 PKCE 登录、另一个进程复用持久化令牌重连、登出与取消；四次 PTY 启动分别观察结果和终端恢复。浏览器替身只在请求前校验 loopback 授权与 callback URL，不替代产品 OAuth 流程。MCP 凭据保存在用户 HOME；Headless 没有授权 Interaction，提示在 TUI 登录，不自动打开浏览器或接受授权。配置与生命周期由 [MCP 参考](mcp.md) 拥有。

## 执行安装验收

构建生成 `release-modules.json`，记录实际 Bun 模块图中的路径，位于 npm tarball 之外。验收检查全部十个协议实现和九条模型 OAuth flow 的包含关系。该清单属于构建审计，不替代 tarball 校验和、安装运行或 registry 内容核对。

```sh
bun run release:build -- --out /tmp/rukie-release
RUKIE_RELEASE_ARTIFACTS=/tmp/rukie-release bun test scripts/release/tests/providers.test.ts
```

验收消费已经构建的 tarball，不在每种模型场景重复编译。Responses/Anthropic 的 SSE、本地 Azure 和 Bedrock SDK 均通过安装后的 `rukie` 驱动真实 Session；前两种协议检查输出、usage 与请求身份，Responses 取消同步到实际 HTTP 请求后向 launcher 发送 SIGINT，失败边界同步到真实 SDK 返回错误。已有基础安装验收继续拥有 grep、bash、Transcript 与 Session Resume。

Bedrock 本地边界使用伪造 AWS 密钥，设置 `AWS_REGION`、`AWS_ENDPOINT_URL_BEDROCK_RUNTIME`、`AWS_EC2_METADATA_DISABLED=true` 与已有上游选项 `AWS_BEDROCK_FORCE_HTTP1=1`。地区设置避免内置目录 endpoint 覆盖本地 SDK endpoint；HTTP1 选项使本地普通 HTTP fixture 接收请求。HTTP 错误与签名证明适配器和 SDK 加载，不作为成功 AWS eventstream 或 IAM 身份证据。

## 未验证边界

构建审计、安装运行、本地协议和远程身份是分别记录的证据。没有本地 endpoint 入口的协议族保持源码与构建模块证据，不发送伪造密钥到公共服务。真实模型连通性、AWS IAM、Google ADC 与远程 OAuth 登录需要独立环境和明确执行，当前本地安装验收不证明这些服务成功。验收不读取维护者实际设置或凭据，也不增加产品测试专用加载接口。
