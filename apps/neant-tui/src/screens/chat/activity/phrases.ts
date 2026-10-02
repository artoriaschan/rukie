/**
 * BSD 3-Clause License
 *
 * Copyright (c) 2026, chimney (ccch1mneyyy)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Adapted from dsh-working-activity/src/phrases.ts, version 0.5.1.
 */

export function mixSlot(seed: number, slot: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(slot | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export const THINKING_PHRASES: readonly string[] = [
  "嗯…让我捋捋",
  "盘一下盘一下",
  "大脑转起来了",
  "思考.gif",
  "给我一秒",
  "脑子在冒烟",
  "想呢想呢",
  "别催别催",
  "啾，让我想想",
  "让我琢磨下",
  "嗯…等一下哦",
  "正在盘逻辑",
  "小脑瓜动一下",
  "嗯？哦…",
  "让我理理",
  "翻翻脑子",
  "回想中",
  "等一下下",
  "让我嗅嗅",
  "脑内风暴中",
  "嗯…让我品品",
  "滴滴滴思考中",
  "稍等，在想",
  "盘明白了么",
  "挠头…",
  "让子弹飞一会",
  "让我脑补一下",
  "加载中",
  "你说 我在听",
  "噢…是这样",
  "让我嚼一嚼",
  "嗯…有点意思",
  "搓搓手想想",
  "等下，在想",
  "让我康康",
  "想好了告诉你",
  "脑子转圈圈",
  "嗯…让我反应下",
  "等下下嘛",
  "思路加载中",
  "琢磨中",
  "嗯…让我拆一下",
  "盘，都可以盘",
  "让我嗅探一下",
  "脑内跑火车",
  "嗯…让我缓一下",
  "滴滴，想呢",
  "思索.jpg",
  "嗯…有点东西",
  "让我品",
  "小跑一下思路",
  "等下，有画面了",
  "让我咀嚼",
  "嗯…发会儿呆",
  "思考泡泡",
  "脑电波传输中",
  "嗯…转转",
  "等下，盘好了",
  "让我回味",
  "滴滴滴",
  "思考的鱼",
  "嗯…让我摸一下",
  "脑子在煮咖啡",
  "等下，我打个腹稿",
  "嗯…重启一下",
  "让我挠墙",
  "嗯，来了来了",
  "脑子冒泡泡",
  "嗯…有点烫",
  "思考猫猫",
  "让我咕噜一下",
  "嗯…盘它",
  "等下，我闪个思路",
  "脑子在蹦迪",
  "嗯…",
  "让我想想",
  "盘一下",
  "啾",
  "lol",
  "hm",
  "oh",
  "ok",
  "um",
  "heh",
  "uh",
  "nah",
  "mm",
  "wow",
  "nice",
  "rgrg",
  "okk",
  "hhh",
  "emm",
  "emmm",
  "CPU烧了",
  "让我打个log看看",
  "先跑一下试试",
  "定位一下",
  "排查一下",
  "看看日志",
  "抓个包看看",
  "loading 99%",
  "让我捋一下逻辑",
  "嗯…让我偷想一下",
];

export const THINKING_TIERS: readonly {
  /** Minimum thinking ms for this tier. */
  readonly atMs: number;
  readonly pool: readonly string[];
}[] = [
  {
    atMs: 30_000,
    pool: [
      "嗯，让我细想想",
      "30秒了，还在盘",
      "等下，快好了",
      "别急，就快出结果了",
      "让我再捋一捋",
      "嗯…思路没断",
      "30秒，快了",
      "等等，有眉目了",
      "有点久…",
      "转圈圈…",
      "马上马上",
      "快了快了",
      "别走，就快好了",
      "在盘了呢",
      "还在定位",
      "快复现了",
    ],
  },
  {
    atMs: 60_000,
    pool: [
      "1分钟，还在想",
      "这题有点东西",
      "让我再钻研下",
      "嗯…问题不简单",
      "1分钟，别走开",
      "盘得有点深",
      "脑细胞在燃烧",
      "等等，快盘清了",
      "还在努力…",
      "这个有点绕…",
      "烧脑中…",
      "别走，快了",
      "一分钟了，再等等",
      "这题值得盘",
      "还在排查",
      "这个有点复杂",
    ],
  },
  {
    atMs: 300_000,
    pool: [
      "5分钟，大工程",
      "这把我得认真",
      "确实有点绕",
      "等等，我在修仙",
      "快好了，真的",
      "盘了一大圈",
      "别慌，在收尾",
      "给我一首歌的时间",
      "还没放弃…",
      "这题真的硬…",
      "我给跪了…",
      "憋大招中",
      "5分钟了，等值了",
      "快了，真快了",
      "这个需求很简单",
      "能跑就别动",
      "PM说这个很急",
      "先上线再说",
    ],
  },
];

export const WAITING_PHRASES: readonly string[] = [
  "呼叫模型…",
  "模型在路上了",
  "等它开口…",
  "稍等，它有点慢",
  "模型加载中",
  "嗯…等它一下",
  "它在组织语言",
  "等等我嘛",
  "模型醒了么",
  "等它伸懒腰",
  "它打了个哈欠",
  "模型：来了来了",
  "等它出字",
  "别急，在等",
  "它磨蹭呢",
  "模型说等一下",
  "等它滴一声",
  "模型在咕噜",
  "等它反应过来",
  "嗯…等它",
  "模型在喝水",
  "它说再等一下",
  "等它喘口气",
  "模型：快了快了",
  "别急别急",
  "来了来了",
  "等它跑完",
  "还在排队",
  "马上出结果",
  "等它热身",
  "模型在酝酿",
  "它翻了个身",
  "模型：马上",
  "等它开机",
  "它卡了一下",
  "模型在冥想",
  "等它眨个眼",
  "它说稍等",
  "模型在查资料",
  "等它缓一缓",
  "模型在数数",
  "等它回神",
  "它终于动了",
];

export const ACTION_MAP: readonly {
  readonly test: RegExp;
  readonly actions: readonly string[];
}[] = [
  {
    test: /^(read|read_file|cat)$/i,
    actions: [
      "翻翻文档",
      "让我康康",
      "读一下",
      "看一眼",
      "翻阅中",
      "读读看",
      "翻翻",
      "看看",
      "瞄一眼",
      "康康",
      "翻一页",
      "翻翻看",
    ],
  },
  {
    test: /^(write|write_file|create_file)$/i,
    actions: [
      "写写写",
      "下笔中",
      "码字呢",
      "写一段",
      "记录一下",
      "改改再写",
      "写一下",
      "记下来",
      "落笔",
      "开写",
      "存个文件",
    ],
  },
  {
    test: /^(edit|edit_file|str_replace|apply_patch|search_replace)$/i,
    actions: [
      "改改",
      "修修补补",
      "润色一下",
      "编辑中",
      "调整调整",
      "改一改",
      "修一下",
      "改两行",
      "调一下",
      "补一刀",
      "动动手指",
    ],
  },
  {
    test: /^(bash|shell|run|exec|powershell|cmd)$/i,
    actions: [
      "跑个命令",
      "bash一下",
      "敲敲指令",
      "命令行走起",
      "执行一下",
      "敲回车",
      "跑一下",
      "敲个命令",
      "跑命令",
      "使唤终端",
      "跑个腿",
    ],
  },
  {
    test: /^(grep|rg|search|search_in_files|ffgrep)$/i,
    actions: [
      "搜搜东西",
      "grep 一下",
      "找找匹配",
      "关键词走你",
      "过滤中",
      "搜搜看",
      "搜搜",
      "找找",
      "搜一下",
      "扫一眼",
      "挖一挖",
    ],
  },
  {
    test: /^(find|glob|fffind)$/i,
    actions: ["找找文件", "找一下", "寻宝中", "找啊找", "文件在哪", "查找中", "摸一下", "搜搜目录"],
  },
  {
    test: /^(ls|list_dir|list)$/i,
    actions: [
      "列个清单",
      "看看目录",
      "ls 看一眼",
      "瞄一下文件",
      "目录走起",
      "列出来",
      "列一下",
      "瞟一眼",
      "翻翻",
    ],
  },
  {
    test: /^(web_search|search_web|brave|tavily|exa|search-layer)$/i,
    actions: [
      "网上搜搜",
      "搜一下",
      "网络冲浪",
      "查找资料",
      "上网瞄瞄",
      "上网搜搜",
      "查查",
      "搜一圈",
      "打听一下",
    ],
  },
  {
    test: /^(web_fetch|fetch|fetch_content|get_search_content|batch_web_fetch)$/i,
    actions: [
      "抓个页面",
      "拉取一下",
      "fetch 中",
      "扒拉网页",
      "取点内容",
      "抓取资料",
      "扒一下",
      "拉一下",
      "打开看看",
    ],
  },
  {
    test: /^(mcp)/i,
    actions: [
      "mcp 连一下",
      "调个服务",
      "接个工具",
      "mcp 走你",
      "调接口",
      "连一下",
      "调个工具",
      "喊外援",
      "接一下",
      "问问插件",
    ],
  },
  {
    test: /^(recall)$/i,
    actions: ["回想一下", "回忆中", "提取记忆", "想起啥了", "记起来", "翻翻记忆", "想想之前"],
  },
  {
    test: /^(subagent|agent|task)$/i,
    actions: [
      "派个小弟",
      "小助手出动",
      "支个 agent",
      "让小弟跑腿",
      "代理干活",
      "子任务起飞",
      "分个任务",
      "交给小弟",
      "派出去",
    ],
  },
  {
    test: /^(todo|manage_todo_list)$/i,
    actions: [
      "列个待办",
      "写个清单",
      "todo 安排",
      "记一下",
      "待办走起",
      "清单一下",
      "记个待办",
      "划个清单",
      "打个勾",
    ],
  },
  {
    test: /^(browser|chrome|playwright|agent_browser|chrome_devtools)/i,
    actions: [
      "开个浏览器",
      "浏览器跑腿",
      "网页操作",
      "浏览器干活",
      "开网页",
      "开浏览器",
      "点点页面",
      "开个页面",
    ],
  },
  {
    test: /^(git|gh|github)/i,
    actions: ["git 操作", "提交一下", "版本控制", "git 走你", "提交代码", "管个仓库", "git 一下"],
  },
  {
    test: /^(notebook|jupyter)/i,
    actions: ["笔记本记下", "写个笔记", "记个笔记", "本子写写", "记录东西", "跑个 cell"],
  },
  {
    test: /^(ctx_execute|ctx_execute_file|ctx_batch_execute)$/i,
    actions: [
      "上下文执行",
      "跑上下文",
      "ctx 执行",
      "执行一下",
      "上下文操作",
      "运行中",
      "跑段代码",
      "算一下",
      "后台跑一下",
    ],
  },
  {
    test: /^(ctx_search|ctx_index|ctx_fetch_and_index)$/i,
    actions: [
      "搜上下文",
      "上下文搜搜",
      "ctx 查找",
      "找找上下文",
      "搜一下历史",
      "找找记录",
      "翻知识库",
      "查索引",
      "搜一下笔记",
    ],
  },
  {
    test: /^(ctx_stats|ctx_doctor|ctx_upgrade|ctx_purge|ctx_insight)$/i,
    actions: [
      "统计一下",
      "上下文统计",
      "ctx 状态",
      "看个状态",
      "统计中",
      "看看数目",
      "看看状态",
      "诊断一下",
      "查一下",
    ],
  },
  {
    test: /^(ask_user_question|ask)$/i,
    actions: [
      "提问中",
      "问一个问题",
      "ask 一下",
      "请教一下",
      "问问看",
      "问一问",
      "问你个事",
      "确认一下",
      "问问你",
    ],
  },
  {
    test: /^(goal_complete|goal_blocked)$/i,
    actions: [
      "定个目标",
      "设定目标",
      "goal 设置",
      "目标走起",
      "规划一下",
      "目标确认",
      "标记目标",
      "更新进度",
      "打个勾",
    ],
  },
  { test: /^(todo_write)$/i, actions: ["记个待办", "划个清单", "打个勾"] },
];

export const FALLBACK_ACTIONS: readonly string[] = [
  "干活",
  "调用",
  "整一下",
  "搞一下",
  "动动手",
  "备选方案",
  "换条路",
];

export const FAIL_PHRASES: readonly string[] = [
  "翻车了",
  "哎呀",
  "掉了",
  "没跑通",
  "摔了一跤",
  "再来一次",
  "这不对",
  "出岔子了",
  "不灵了",
  "坏消息",
  "权限不对？",
  "连不上？",
  "404了",
  "不太对",
  "有点问题",
  "再看看",
  "没接住",
  "漏了",
  "我本地能跑啊",
  "昨天还能跑",
  "重启试试",
  "清一下缓存",
  "删了重装",
  "你刷新一下",
  "环境问题",
  "少了个分号",
  "拼错了",
  "没保存",
  "又不是不能用",
  "绷不住了",
  "难绷",
  "卒",
  "裂开",
  "血压上来了",
  "缓存害我",
  "再给我一次机会",
  "这波大意了",
  "手滑",
  "回滚重来",
  "换个姿势",
  "重试一次",
];

export const DONE_PHRASES: readonly string[] = [
  "交差！",
  "搞定，下一个",
  "好了，收工",
  "完成啦",
  "交作业",
  "结束，完美",
  "完工咯",
  "搞定啦",
  "任务完成",
  "好了，歇会儿",
  "搞定",
  "收工",
  "妥了",
  "完事",
  "交差",
  "齐活",
  "拿下",
  "收工！",
  "搞定收工",
  "收！",
  "完事！",
  "下一题",
  "能跑！",
  "没报错",
  "过了",
  "上线！",
  "稳了",
  "6",
  "完工！",
  "完美收场",
  "这波不亏",
  "一次过",
  "收工摸鱼",
  "漂亮",
  "全绿",
  "干净利落",
  "手到擒来",
  "水到渠成",
  "下班！",
  "歇口气",
  "交接完成",
  "工单关闭",
  "收尾完毕",
  "在我机器上能跑",
];

export const NIGHT_PHRASES: readonly string[] = [
  "修仙中…",
  "深夜冒泡",
  "你也是夜猫子呀",
  "月亮不睡我不睡",
  "夜里脑子慢，谅解",
  "晚安？还早呢",
  "深夜盘东西",
  "熬夜冠军上线",
  "困了，但能行",
  "过了零点照样肝",
  "夜猫子出没",
  "深夜档营业",
  "星星都睡了",
  "凌晨还在盘",
  "深夜上线",
  "凌晨部署",
  "通宵了",
];

export const RARE_PHRASES: readonly string[] = [
  "SSR！稀有彩蛋",
  "UR 掉落",
  "金色传说！",
  "爆装备了",
  "ssr 彩蛋出现",
  "lol 中奖了",
  "这把 ez",
  "GG！闪耀",
  "稀有掉落确认",
  "wow，出橙了",
  "彩蛋砸脸",
  "我承认，被帅到了",
  "天选时刻",
  "五星好评掉落",
  "你发现了隐藏款",
  "触发隐藏对话",
  "稀有帧",
  "恭喜，这是稀有货",
  "lol 你赚了",
  "gg ez 彩蛋",
  "欧气爆棚",
  "这把不亏",
  "真·金色传说",
  "彩蛋蹦出来了",
  "sssr 隐藏",
  "你解锁了稀有",
  "SSR！",
  "UR！",
  "金色传说",
  "gg",
  "ez",
  "暴击了",
  "wink ~",
  "你发现我了",
  "欧皇降临",
  "隐藏款！",
  "稀有度 MAX",
  "一次过！",
  "没bug",
  "完美运行",
  "测试全绿",
  "这波在大气层",
];

export const RARE_CHANCE = 1 / 150;

export const WEEKEND_PHRASES: readonly string[] = [
  "周末摸鱼中",
  "周末也在！",
  "放假也陪你",
  "周末不关机",
  "周末偷着盘",
  "周末也在卷？",
  "卷王你好",
  "还在加班…",
  "周末限定皮肤",
  "周六也营业",
  "周日也接单",
  "周末不放假",
  "摸鱼限定版",
  "周末模式 ON",
  "周末hotfix",
  "周末在修bug",
  "周末上线",
];

export const HOLIDAY_PHRASES: Readonly<Record<string, readonly string[]>> = {
  "01-01": [
    "新年快乐！",
    "元旦快乐",
    "新的一年，新的 bug",
    "新年第一盘",
    "开工大吉",
    "新年第一行代码",
  ],
  "02-14": ["情人节也在敲代码", "代码才是真爱", "今天不约会？", "bug 也是 love", "键盘就是玫瑰"],
  "04-01": ["愚人节快乐", "这个 bug 是假的吧", "小心假报错", "今天谁骗我", "❌ 骗你的，没报错"],
  "05-01": ["劳动节还在卷", "劳动最光荣", "打工人打工魂", "卷王放假了？"],
  "06-01": ["儿童节快乐", "谁还不是个宝宝", "今天代码要写得可爱", "🍭 宝宝模式"],
  "10-31": ["万圣节快乐", "不给糖就捣蛋", "🎃 南瓜来了", "👻 代码也会吓人"],
  "12-24": ["平安夜快乐", "圣诞老人来了", "🎄 今晚写代码有礼物", "平安夜也在盘"],
  "12-25": ["圣诞快乐", "Merry Christmas", "🎅 圣诞也陪你", "圣诞限定彩蛋", "🎄 麋鹿送代码"],
  "12-31": ["跨年夜", "新年倒计时", "今年最后一盘", "🍾 准备跨年", "明年见！"],
};

export const LUNAR_NEW_YEAR_PHRASES: readonly string[] = [
  "🧧 春节快乐！",
  "过年还在写代码",
  "红包拿来",
  "新春快乐",
  "拜年了",
  "过年好",
  "代码也拜个年",
  "🐉 龙年大吉",
  "年夜饭写代码",
  "年味盘起来",
];

const LUNAR_NEW_YEAR_DAYS: Readonly<Record<string, true>> = {
  "2025-01-29": true,
  "2025-01-30": true,
  "2025-01-31": true,
  "2025-02-01": true,
  "2025-02-02": true,
  "2025-02-03": true,
  "2025-02-04": true,
  "2026-02-17": true,
  "2026-02-18": true,
  "2026-02-19": true,
  "2026-02-20": true,
  "2026-02-21": true,
  "2026-02-22": true,
  "2026-02-23": true,
  "2027-02-06": true,
  "2027-02-07": true,
  "2027-02-08": true,
  "2027-02-09": true,
  "2027-02-10": true,
  "2027-02-11": true,
  "2027-02-12": true,
  "2028-01-26": true,
  "2028-01-27": true,
  "2028-01-28": true,
  "2028-01-29": true,
  "2028-01-30": true,
  "2028-01-31": true,
  "2028-02-01": true,
  "2029-02-13": true,
  "2029-02-14": true,
  "2029-02-15": true,
  "2029-02-16": true,
  "2029-02-17": true,
  "2029-02-18": true,
  "2029-02-19": true,
  "2030-02-03": true,
  "2030-02-04": true,
  "2030-02-05": true,
  "2030-02-06": true,
  "2030-02-07": true,
  "2030-02-08": true,
  "2030-02-09": true,
};

export const CONTINUE_PHRASES: readonly string[] = [
  "再来，again！",
  "接着盘",
  "继续整",
  "again！走起",
  "接着刚才的",
  "续上，继续",
  "再续一秒",
  "继续继续",
  "继续…",
  "好，接着来…",
  "again",
  "没断片",
  "在修了在修了",
  "马上好",
  "还差一点",
  "快好了",
];

export const COMPACTION_START_PHRASES: readonly string[] = ["收拾一下上下文…", "整理背包中…"];

export const COMPACT_PHRASES: readonly string[] = [
  "压缩了一下",
  "瘦了个身",
  "腾出地方了",
  "整理了下记忆",
  "减负成功",
  "释放了一波",
  "清爽多了",
  "瘦身完毕",
  "好多了",
  "整理好了",
  "清了一下缓存",
  "重启了一下",
  "GC了一下",
  "释放了一波内存",
];

export const APPROVAL_PHRASES: readonly string[] = [
  "在等你点头",
  "等你批准呢——看一眼？",
  "模型在等你决定",
];

export const TOOL_OPENING_PHRASES: readonly string[] = [
  "想好了，上手",
  "琢磨完了，动手",
  "思路有了，开干",
  "盘明白了，开工",
  "脑内预演完毕",
  "想清楚了，来",
];

export function fmtDuration(ms: number): string {
  if (ms < 1000) return "0s";
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

/** One deterministic phrase per slot; adjacent slots cannot repeat. */
export function pickPhraseAt(pool: readonly string[], seed: number, slot: number): string {
  if (pool.length === 0) throw new Error("pickPhraseAt requires a non-empty pool");
  return pool[((mixSlot(seed, 0) % pool.length) + slot) % pool.length]!;
}

export function pickPhrase(pool: readonly string[], random: () => number): string {
  return pool[Math.floor(random() * pool.length)]!;
}

export function thinkingPhrase(
  elapsedMs: number,
  seed: number,
  slot: number,
  night: boolean,
): string {
  const tier = THINKING_TIERS.findLast((tier) => elapsedMs >= tier.atMs);
  const pool = tier?.pool ?? (night ? [...THINKING_PHRASES, ...NIGHT_PHRASES] : THINKING_PHRASES);
  return pickPhraseAt(pool, seed, slot);
}

export function holidayPhrase(date: Date, seed: number, slot: number): string | undefined {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const pool = LUNAR_NEW_YEAR_DAYS[`${date.getFullYear()}-${mmdd}`]
    ? LUNAR_NEW_YEAR_PHRASES
    : HOLIDAY_PHRASES[mmdd];
  return pool ? pickPhraseAt(pool, seed, slot) : undefined;
}
