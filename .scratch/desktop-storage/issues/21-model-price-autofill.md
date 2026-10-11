# 21: 模型美元价格自动填充

Status: ready-for-agent

Blocked by: 20

用户要求从 https://llmprice.cn/ 获取模型美元价格并自动填充高级设置。已实读站点当前HTML（父代理外部证据/tmp/rukie-llmprice-index.html），站点使用LiteLLM Cost Map原始USD/token，页面显示人民币换算。使用同一数据源的原始美元价格，转换为现有USD/百万Token，不使用网页人民币结果或固定汇率。

- [ ] 核查数据源、模型/provider身份、input/output/cache字段及价格分层/缺失，记录真实来源
- [ ] 按模型ID及可确定provider/endpoint精确匹配，唯一可靠结果自动填充未手动设置价格与来源；不关联模型名称，不模糊猜价、不覆盖手动值，歧义/未匹配/失败可见且保留表单
- [ ] 使用已有宿主/网络边界，远端JSON作为unknown限量/超时/校验，匹配请求不带APIKey，不暴露任意URLfetch；处理快速切换/关闭/迟到结果
- [ ] 触发语义保持稳定：添加模型ID确认或失焦时取价、打开现有模型缺价格时取价，手动修改仍支持；不能每击键请求或保存过时结果
- [ ] 最小public focused验证换算/缺价/歧义/错误及输入自动填充保存/重开，局部静态+一次Chromium/mock Light/Dark/窄屏，禁止真实Electron/Keychain/包级/全量/CI
- [ ] 同步必要契约/文档/ADRcoverage，新两轴与freshmerger集成关闭ticket/spec

本票使用现有beUI组件和高级设置价格区，不增加未授权布局。数据源：llmprice首页列明 https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json；原站加载jsdelivr/rawGitHub及backup，不必复制多重fallback。当前源码1596等父已核对，不视为未来稳定API，需清晰记录来源与失败处理。
