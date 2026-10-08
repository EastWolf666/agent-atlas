# Agent Atlas — 开发需求说明书

> **版本** v2.0
> **日期** 2026-10-09
> **状态** 🟢 已上线，持续迭代
> **项目代号** agent-atlas
>
> v2.0 变更：Agent 页已上线；新增 AI 大模型标签页（OpenRouter 数据自动更新）；新增 AI 国产替代标签页（人工维护）。

---

## 一、项目定位

一句话：**做一个能"逛"的全球 AI Agent 应用图谱**——不是静态的产品清单，而是一张可筛选、可对比、可探索的交互地图。

### 1.1 为什么要做

现在网上关于 Agent 的信息是散的：博客榜单、公众号清单、英文 market map 各自一套，口径混乱、时效不明。想了解"海外有哪些 Agent 产品""国内在做什么""我该选哪个"要翻十几个来源。

**核心洞察**：这个领域的信息不是"缺少内容"，而是"缺少组织方式"。所以本项目的价值不在于收录多少，而在于**组织维度清晰 + 可对比 + 可追溯**。

### 1.2 目标用户

| 用户 | 需求 | 使用方式 |
|---|---|---|
| 技术选型者 | 判断该用哪个 Agent | 按维度筛选 + 并排对比 |
| 产品/战略人员 | 摸清赛道格局与玩家 | 图谱视图 + 行业分布 |
| 求职者/研究者 | 了解领域全貌 | 全文检索 + 阅读详情 |
| 投资人 | 观察赛道热度 | 融资与规模数据筛选 |

### 1.3 差异化设计（核心）

**不做"另一个清单"，做三件别人没做的事：**

1. **双维度图谱** — 不只按"国内/国外"平铺，而是用**能力自主性**（L1 工具调用 → L5 自主规划）× **场景领域**（编程/办公/企业平台/垂直行业/基础设施）建二维矩阵，每个产品落在一个格子里。放不下，说明这个分类框架有问题。
2. **跨维度对比** — 勾选任意 2-4 个产品，生成并排对比表（能力、部署形态、价格模��、上下文、模态、开源情况）。**这是清单类网站做不了的事。**
3. **数据可追溯** — 每条数据标注来源链接与采集时间，明确区分「厂商官方数据」和「第三方评测」。

---

## 二、数据模型

### 2.1 核心实体：Agent 条目

```jsonc
{
  "id": "claude-code",
  "name": "Claude Code",
  "vendor": "Anthropic",
  "region": "overseas",          // overseas | china
  "category": "coding",          // 见 2.2 分类体系
  "autonomyLevel": 4,            // L1-L5，见 2.3
  "tagline": "终端里的资深工程师，长上下文强",
  "description": "（150-300 字，详见 2.4）",
  "highlights": ["长上下文", "自主重构", "工具调用准确率高"],
  "limitations": ["偶发任务截断", "复杂指令需拆分"],
  "deployment": ["cli", "web"],  // web|cli|ide|app|api|private|saas
  "pricingModel": "subscription", // subscription|usage|free|open_source|enterprise
  "pricingNote": "Pro $20/mo，Max $100/mo，Ultra $200/mo",
  "contextWindow": "1M",
  "modalities": ["text", "image"], // text|image|audio|video|3d
  "openSource": false,
  "officialUrl": "https://...",
  "sources": [
    { "title": "官网定价页", "url": "https://...", "type": "official", "date": "2026-09" }
  ],
  "dataConfidence": "high",       // high=官方确认 | medium=可信二手 | low=推测
  "lastVerified": "2026-09-28"
}
```

### 2.2 分类体系（三层，覆盖全赛道）

**按能力层级分（Tier）**

| Tier | 定位 | 代表产品 |
|---|---|---|
| **基础设施** | 模型、编排框架、协议 | MCP、LangGraph、Claude Agent SDK、OpenAI Agents SDK |
| **开发工具** | 开发者日常使用的 Agent | Claude Code、Codex、Cursor、Copilot、Trae、华为云码道 |
| **办公/生产力** | 通用办公场景 | WorkBuddy、Manus、ChatGPT Agent、飞书 Aily、钉钉 AI |
| **企业平台** | 组织级部署与治理 | Copilot Studio、Agentforce、Vertex AI Agent Builder、腾讯云 ADP、阿里云百炼 |
| **垂直行业** | 单一行业深度应用 | Harvey（法律）、Suki（医疗）、Sierra（客服）、DeepMiner（数据分析）、司马诸葛（知识管理） |

**按落地形态分（Form）**

消费级工具 / 开发者工具 / 企业平台 / 私有化部署 / 行业解决方案

**按自主性分（Autonomy）**

| 级别 | 定义 | 典型特征 |
|---|---|---|
| L1 | 单次工具调用 | 调一次 API 返回结果 |
| L2 | 多步固定流程 | 预设编排，路径固定 |
| L3 | 动态规划 | 自主拆解任务，步骤可变量 |
| L4 | 长程自治 + 自检 | 长任务、反复校验、失败自我修正 |
| L5 | 多 Agent 协作 | 分工协作、互相校验、跨系统执行 |

### 2.3 自主性评级标准（避免主观标注）

每条数据必须能对照下表打钩，不能凭感觉：

- **L1**：单次调用即返回，无自主决策
- **L2**：可执行多步，但流程由人预先编排，路径确定
- **L3**：自主拆解目标并动态决定步骤，失败会重试
- **L4**：可运行数十分钟以上的任务，主动检查并修正自己的产出
- **L5**：多个 Agent 分工协作，可并行处理子任务并汇总

### 2.4 描述撰写标准

**统一模板：定位一句话 + 它能干什么（具体到任务）+ 它擅长什么 + 它的局限。**

反例（❌）："强大的 AI 编程助手，广泛应用于软件开发领域。"
正例（✅）："终端里的资深工程师，擅长大规模重构与复杂系统维护，长上下文表现突出。局限在于偶发长任务截断，复杂指令需要人工拆分。"

**原则**：每条描述必须回答「**它具体替你干了什么活**」，而不是「它是什么」。形容词不算信息。

---

## 三、功能需求

### 3.1 首屏 — 概览仪表盘

- **标题区**：项目名 + 一句话定位 + 数据更新时间 + 条目总数
- **统计卡片**（4 张）：收录产品数 / 覆盖品类数 / 国内 vs 海外比例 / 数据更新时间
- **能力 × 领域双维图谱**：交互式散点矩阵，气泡大小=收录产品的相对知名度
  - 悬停显示产品名，点击进入详情
  - 图例可切换 Tier / Form / Autonomy 三种着色方式
- **趋势要点**：3-5 条从数据中提炼的观察（如"编程类已占满 L4-L5 区间"）

### 3.2 主视图 — Agent 卡片网格

**筛选器（多维可组合）**
- 关键词搜索（中英双语，搜名称/厂商/能力标签）
- 地区：全部 / 海外 / 国内
- Tier：5 个分类多选
- 自主性：L1-L5 滑块区间
- 形态：消费级 / 开发者 / 平台 / 私有化 / 行业
- 模态：文本 / 图像 / 音频 / 视频 / 3D
- 价格模式：免费 / 订阅 / 按量 / 开源 / 企业定制
- 开源：仅看开源

**卡片内容**
- 产品名 + 厂商 + 地区标签
- Tagline（定位一句话）
- Tier + 自主性等级徽章
- 2-3 个核心标签
- 来源可信度标识

**已选状态**：卡片可勾选进入对比（顶部显示"已选 N 个"）

### 3.3 详情面板（点击卡片）

- 完整描述、亮点、局限
- 全部结构化字段（部署形态、上下文、模态、价格、开源）
- 「自主性评级依据」— 说明为什么评这个等级
- 数据来源链接列表 + 采集时间
- 可信度标识（有官方来源 / 仅二手信息）
- 相关产品推荐（同 Tier 或同厂商）

### 3.4 对比视图 ⭐ 核心差异化

- 最多并排对比 4 个产品
- 逐行对比：定位、区域、Tier、自主性、部署形态、上下文、模态、价格模式、开源、数据可信度
- **差异高亮**：自动标出各行中取值不同的项
- 「推荐场景」字段：根据产品特性自动生成"什么情况下该选它"

### 3.5 全局能力

- 主题切换（浅色 / 深色）
- 数据健康度面板：多少条有官方来源、多少条待核实
- 键盘快捷键：`/` 聚焦搜索，`Esc` 关闭面板
- 移动端适配（≥375px）
- 打印友好（Ctrl+P 可直接导出 PDF 存档）
- URL 状态同步（筛选条件反映在地址栏，可分享特定视图）

---

## 四、内容规划

### 4.1 首期收录目标

| 分类 | 数量 | 覆盖重点 |
|---|---|---|
| 基础设施 | 8-10 | MCP、LangGraph、CrewAI、AutoGen、OpenAI Agents SDK、Claude Agent SDK |
| 开发工具 | 12-15 | Claude Code、Codex、Cursor、Copilot、Devin、Trae、华为云码道、通义灵码、文心快码 |
| 办公生产力 | 12-15 | WorkBuddy、Manus、ChatGPT Agent、Gemini Agent、飞书 Aily、钉钉 AI、豆包、腾讯元器、纳米AI |
| 企业平台 | 10-12 | Copilot Studio、Agentforce、Bedrock AgentCore、Vertex AI Agent Builder、腾讯云 ADP、阿里云百炼、百度千帆、实在Agent |
| 垂直行业 | 15-20 | 客服（美洽、Sierra）、法律（Harvey、Luminance）、医疗（Suki、Ambience）、金融（JPMorgan IndexGPT）、知识管理（司马诸葛、DeepMiner） |
| **合计** | **60-80** | 国内外大致 6:4 |

### 4.2 每条内容的产出标准

- 描述：**150-300 字**，按统一模板撰写
- 信息来源：**至少 1 个官方来源**（官网/官方文档/官方博客）
- 采集时间：精确到月
- 定价：必须是最新的官方定价，无公开价格则明确写"未公开"
- 禁止：形容词堆砌、无信息量的营销话术、未标注来源的推测

---

## 五、技术方案

### 5.1 技术选型

| 项| 选择 | 理由 |
|---|---|---|
| 框架 | **Vite + React 18 + TypeScript** | 生态成熟、构建快、类型安全 |
| 样式 | **Tailwind CSS** | 快速迭代，暗色主题易实现 |
| 数据 | **静态 JSON + 加载时 fetch** | 数据与代码解耦，便于后续更新 |
| 图表/图谱 | **自研 SVG + Canvas** | 避免引入重型库，bundle 保持轻量 |
| 部署 | **GitHub Pages** | 免费、无需服务器、便于迭代 |
| 搜索 | **客户端模糊匹配** | 数据量小，无需后端 |

**明确不引入**：后端服务、数据库、任何需要 API key 的服务。目标是"clone 下来 npm i && npm run dev 就能跑"。

### 5.2 项目结构

```
agent-atlas/
├── src/
│   ├── data/
│   │   ├── agents.json          # 主数据（结构见 2.1）
│   │   └── meta.json            # 分类定义、Tier 描述、Autonomy 标准
│   ├── components/
│   │   ├── Overview/            # 首屏仪表盘
│   │   │   ├── StatCards.tsx
│   │   │   ├── AtlasMatrix.tsx  # 双维图谱
│   │   │   └── Insights.tsx
│   │   ├── Grid/                # 卡片网格
│   │   │   ├── AgentCard.tsx
│   │   │   └── FilterPanel.tsx
│   │   ├── Detail/              # 详情面板
│   │   └── Compare/             # 对比视图
│   ├── hooks/                   # useFilter / useSearch / useCompare
│   ├── lib/                     # 分类工具、搜索、排序
│   └── styles/
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
├── CONTRIBUTING.md             # 说明如何新增一条数据
└── LICENSE                     # MIT
```

### 5.3 性能要求

- 首屏 LCP < 1.5s（本地）/ 加载 < 3s（GitHub Pages）
- Lighthouse Performance ≥ 90
- Bundle 总体积 < 500KB（gzip 后）
- 筛选/搜索响应 < 16ms（60fps 交互）
- 移动端可用，无横向滚动

---

## 六、开发里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| **M1** | 项目初始化、Tailwind 配置、暗色/亮色主题、数据结构定义 | 1 天 |
| **M2** | 数据采集与撰写（60-80 条），这是**最耗时**的部分 | 3-5 天 |
| **M3** | 概览仪表盘 + 统计卡片 + 双维图谱 | 2 天 |
| **M4** | 卡片网格 + 多维筛选 + 搜索 | 2 天 |
| **M5** | 详情面板 + 对比视图 | 2 天 |
| **M6** | 响应式适配、无障碍、SEO、README | 1 天 |
| **M7** | 浏览器实测、自查、修复 | 1 天 |
| | **合计** | **12-14 天** |

**关键路径**：M2 数据采集占约 1/3 工作量，且无法压缩——内容质量决定这个项目有没有价值。

---

## 七、待你确认的问题

1. **数据口径**：是否收录已停更/已倒闭的产品？我倾向收录但在详情页标注状态，因为"哪些死了"本身是有价值的信息。

2. **收录规模**：首期 60-80 条是我的保守估计。如果你想做"全量"（200+），工期会拉长到 3-4 周，且后续维护压力更大。建议先做 60 条验证形态，之后增量补充。

3. **是否加入实时数据**：如接入 GitHub Star 数、融资信息。这需要外部 API 和密钥，会破坏"纯静态零依赖"的原则。我建议首期不做。

4. **域名与仓库名**：仓库名我用 `agent-atlas` 可以吗？有无更想要的命名？

5. **GitHub 账号**：需要你提供 GitHub 用户名（token 我在沙箱里无法代你登录，需要你自己执行授权步骤）。发布前会先给你本地预览确认。

---

## 八、明确不做的事（避免范围蔓延）

- ❌ 用户注册/登录
- ❌ 后端数据库
- ❌ 评论/投稿功能
- ❌ 实时抓取外部数据
- ❌ AI 问答助手（会引入 API key 和成本，违背静态原则）
- ❌ 移动端 App

---

## 九、预期效果

一个访客打开这个页面，30 秒内能回答三个问题：
1. **这个领域有哪些玩家？** → 首屏图谱
2. **我的场景该选哪个？** → 筛选 + 对比
3. **这东西靠得住吗？** → 来源标注 + 局限说明

---

## 十、AI 大模型标签页（新增 v2.0）

### 10.1 需求背景

Agent 产品底层依赖大模型，但模型选型信息（价格、上下文、模态、跑分）散落在各厂商定价页和第三方评测中。用户需要一个能横向对比的模型数据页，与 Agent 页形成「产品 → 底座」的上下文明。

### 10.2 数据来源与更新

- **数据源**：OpenRouter 公开 API（`https://openrouter.ai/api/v1/models`），免鉴权、字段完整、覆盖国内外主流可调用模型。
- **更新方式**：每日定时任务自动全量抓取，脚本 `scripts/fetch-models.mjs` 独立运行，失败不影响 Agent 数据落盘。
- **数据语义**：全量替换。每次抓取后与上一版做 diff，只比对 `priceInput`、`priceOutput`、`contextWindow`、`releasedAt` 等客观字段；description 文案抖动不计入变更。
- **熔断规则**：抓到 0 条或数量跌超 20% 立即 abort，不写盘。
- **调价高亮**：价格变更单独输出并按涨跌幅排序，避免混在「字段变更 N 条」中被淹没。

### 10.3 数据模型

见 `src/types-model.ts` 与 `src/data/models.json`。核心字段：

| 字段 | 说明 |
|---|---|
| id / name / vendor / vendorSlug | 模型标识与厂商 |
| region | overseas / china |
| contextWindow / maxOutputTokens | 上下文与输出上限 |
| priceInput / priceOutput / priceCacheRead | 每百万 token 价格（美元） |
| inputModalities / outputModalities / isMultimodal | 模态支持 |
| openWeights / openWeightsUrl | 是否开源权重 |
| releasedAt / knowledgeCutoff | 发布时间与知识截止 |
| supportsReasoning / reasoningMandatory | 推理能力 |
| scores.intelligence / coding / agentic | 第三方评测指数（Artificial Analysis） |
| autoAdmitted / autoAdmittedAt / verifiedBy | 待核实机制 |

### 10.4 页面设计

- **标题区**：AI 大模型选型对比 + 数据更新时间 + 统计 chips。
- **统计概览**：收录模型数 / 国内模型 / 开源权重 / 完全免费。
- **控制栏**：搜索框 + 卡片/表格视图切换 + 地区/模态/开源/免费/批处理/路由器筛选 chips。
- **排序条**：8 个可排序列（名称、厂商、上下文、输入价、输出价、智能指数、Agent 指数、发布时间）。
- **卡片视图**：模型名、厂商、地区、上下文、价格、模态。
- **表格视图**：10 列对齐，支持点击行打开详情浮层。
- **详情浮层**：官网链接、关键指标、模态支持、跑分、开源权重、溯源。

### 10.5 待核实机制

沿用 Agent 页的「自动收录 · 待核实」思路：
- 模型数据全部来自 OpenRouter 聚合，未经厂商官方确认。
- 页面显示「自动收录 · 待核实」徽章，详情浮层明确说明价格/上下文/跑分请以厂商官方为准。
- 人工核实台账存 `data/models-verified.json`，不直接改 400KB 的 `models.json`。
- CLI：`npm run verify:model -- add <modelId> [核实人]`。

---

## 十一、AI 国产替代标签页（新增 v2.0）

### 11.1 需求背景

基于「国际主流 AI 工具的中国替代」信息图，将 9 个功能场景下的国际工具与国产替代选项结构化呈现，帮助用户在面对海外工具不可用、不合规或成本过高时，快速找到对应的国产方案。

### 11.2 数据来源与更新

- **数据来源**：人工整理自信息图与公开官网信息，无稳定公开 API。
- **更新方式**：手动维护 `src/data/alternatives.json`。
- **免责口径**：页面与数据中需明确标注「替代≠能力等价，具体功能、定价与可用性请以厂商官网为准」。

### 11.3 数据模型

见 `src/types-alternative.ts` 与 `src/data/alternatives.json`。核心字段：

| 字段 | 说明 |
|---|---|
| id / name / vendor | 工具标识与出品方 |
| region | overseas / china |
| category | chat / image / video / music / office / coding / design / learning / search |
| tagline | 一句话定位 |
| description | 2-4 句详情 |
| officialUrl | 官方网站 |
| pricingModel | free / freemium / subscription / usage / enterprise |
| pricingNote | 人话定价说明 |
| platforms | web / ios / android / windows / macos / linux / api |
| highlights | 核心卖点 2-4 条 |
| replaces | 国产条目指向海外工具 id 列表；海外条目为空数组 |
| lastVerified | 核对日期（YYYY-MM 或 YYYY-MM-DD） |

### 11.4 替代关系语义

- 扁平列表 + `replaces` 引用，不按场景嵌套分组。
- 国产条目 `replaces` 非空，必须指向真实存在的海外工具 id。
- 海外条目 `replaces` 必须为空。
- 每个海外 id 至少被一个国产条目引用，保证配对完整。

### 11.5 9 个功能场景

| 场景 | 国际工具示例 | 国产替代示例 |
|---|---|---|
| AI 对话与助手 | ChatGPT、Claude、Gemini | DeepSeek、Kimi、豆包 |
| AI 生图 | Midjourney、DALL·E、Ideogram | PixPix、即梦、通义万象 |
| AI 视频生成 | Sora、Runway、Pika | 可灵 AI、即梦、海螺 AI |
| AI 音乐生成 | Suno、Udio、Soundraw | 天工音乐、网易天音、天工 SkyMusic |
| AI 办公与效率 | Notion AI、Microsoft 365 Copilot、Grammarly | 钉钉 AI 助理、飞书妙记、有道文档 AI |
| AI 编程与开发 | GitHub Copilot、Replit、Tabnine | 通义灵码、CodeGeeX、腾讯云 CodeBuddy |
| AI 设计与 PPT | Canva AI、Beautiful.ai、Tome | 美图设计室、稿定 AI、Kimi PPT |
| AI 学习与教育 | Khanmigo、QuizBot、Photomath | 作业帮 AI、学而思九章、网易有道词典 AI |
| AI 搜索与研究 | Perplexity、You.com、Brave AI | 秘塔 AI 搜索、天工 AI 搜索、夸克 AI 浏览器 |

### 11.6 页面设计

- **标题区**：AI 国产替代方案地图 + 数据更新时间 + 统计 chips + 待核实徽章。
- **统计概览**：收录工具 / 国产替代 / 国际主流 / 完全免费。
- **控制栏**：搜索框 + 卡片/表格视图切换 + 场景单选 chips + 地区三态 chips。
- **卡片视图**：工具名、厂商、地区、tagline、替代对象、场景、定价模式。
- **表格视图**：名称、厂商、场景、替代对象、定价、平台、核实时间。
- **详情浮层**：官网按钮、免责声明、描述、核心卖点、关键指标、替代关系跳转、溯源。

### 11.7 校验规则

`scripts/lib/alternatives-schema.mjs` 负责校验：
- 必填字段、id 唯一且 slug 规范、枚举白名单、URL 格式。
- `replaces` 引用完整性：国产条目指向的 id 必须存在且 region 为 overseas。
- 每个海外 id 至少被一个国产条目引用。
- `meta.total` 与 `items.length` 一致。

---

**审核意见栏**（请在此处填写）
- 需求是否完整：
- 需调整的部分：
- 需增删的功能：
- 是否同意开工：是 / 否
