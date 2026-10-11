# 21: 模型美元价格自动填充

Status: resolved

Blocked by: 20

用户初要求从 https://llmprice.cn/ 获取模型美元价格，最新明确指定 https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json 为权威来源并自动填充高级设置。已实读站点当前HTML（父代理外部证据/tmp/rukie-llmprice-index.html），站点使用LiteLLM Cost Map原始USD/token，页面显示人民币换算。使用同一数据源的原始美元价格，转换为现有USD/百万Token，不使用网页人民币结果或固定汇率。

- [x] 核查数据源、模型/provider身份、input/output/cache字段及价格分层/缺失，记录真实来源
- [x] 按模型ID及可确定provider/endpoint精确匹配，唯一可靠结果自动填充未手动设置价格与来源；不关联模型名称，不模糊猜价、不覆盖手动值，歧义/未匹配/失败可见且保留表单
- [x] 使用已有宿主/网络边界，远端JSON作为unknown限量/超时/校验，匹配请求不带APIKey，不暴露任意URLfetch；处理快速切换/关闭/迟到结果
- [x] 触发语义保持稳定：添加模型ID确认或失焦时取价、打开现有模型缺价格时取价，手动修改仍支持；不能每击键请求或保存过时结果
- [x] 最小public focused验证换算/缺价/歧义/错误及输入自动填充保存/重开，局部静态+一次Chromium/mock Light/Dark/窄屏，禁止真实Electron/Keychain/包级/全量/CI
- [x] 同步必要契约/文档/ADRcoverage，新两轴与freshmerger集成关闭ticket/spec

本票使用现有beUI组件和高级设置价格区，不增加未授权布局。数据源：llmprice首页列明 https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json；原站加载jsdelivr/rawGitHub及backup，不必复制多重fallback。当前源码1596等父已核对，不视为未来稳定API，需清晰记录来源与失败处理。

实施源码与局部证据已完成，待fresh两轴review与父代理集成关闭。验证记录：`/tmp/rukie-price21-evidence/verification.md`；source/换算/受限privateIPC/UI手动保护保存重开已验证，Chromium Light/Dark/420截图已保留；无真实Electron/Keychain/包级/全量/CI。

最新用户来源选择覆盖初始CDN方案：生产固定raw.githubusercontent.com原始JSON，无CDNfallback；priceSource保存GitHub文件链接、匹配键与USD单位。保存时未取价的ID先查价，进行中受同步guard保护并禁用保存，失败后可手动保存。

Fresh Spec review P1（在途/Enter 保存竞态）已集中修复并由父只读闭合；Standards 无实质发现。最新来源固定用户 GitHub 文件 raw JSON，最新 UI focused 1.85s/server 2case13ms、IPC/preload及局部静态通过；父复用证据，无再次测试。等待 fresh merger 和父关闭。

- 交付：实现 4bc608a0，新的 Spec 保存竞态 P1 已集中修正，Standards 无实现发现；父代理只读核对 source/refguard/disabled/manual 保留和证据关闭发现，fresh merger 仅快进复用验证。21/spec 同步 resolved，PR 未合并，未运行 Electron/Keychain、包级/全量/CI。
