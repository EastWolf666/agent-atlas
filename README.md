# Agent Atlas

> 全球 AI Agent 应用图谱 —— 按**能力自主性**与**应用领域**双维度探索 80 个国内外 Agent 产品。

[![License: MIT](https://img.shields.io/badge/License-MIT-indigo.svg)](LICENSE)
[![数据](https://img.shields.io/badge/数据-2026--10-teal.svg)](src/data/agents.json)
[![类型](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

---

## 这是什么

关于 AI Agent 的信息现在是散的：博客榜单、公众号清单、英文 market map 各自一套口径，时效互相矛盾。想搞清楚「国内外有哪些 Agent 产品」「我的场景该选哪个」要翻十几个来源。

Agent Atlas 把这些信息**按明确维度组织起来**，并且：

- **以国内为主** —— 80 个产品中国内 48 条、海外 32 条（约 6:4）。国内外的产品形态、定价与自主性水位差异明显，混在一起看会得出错误结论
- **双维图谱** —— 自主性等级（L1-L5）× 应用领域，80 个产品各就其位。放不下，说明分类框架有问题
- **并排对比** —— 勾选任意 2-4 个产品，生成差异高亮的对比表
- **数据可追溯** —— 每条数据标注来源链接、采集时间，区分「厂商官方」与「第三方评测」

## 快速开始

```bash
git clone https://github.com/EastWolf666/agent-atlas.git
cd agent-atlas
npm install
npm run dev      # 开发服务器
npm run build    # 构建到 dist/
npm run preview  # 预览构建结果
```

## 核心概念

### 自主性等级（L1-L5）

这是本站的主轴。评级**必须能对照下表**，不允许凭感觉给高分：

| 等级 | 名称 | 判定标准 | 典型例子 |
|---|---|---|---|
| **L1** | 单次工具调用 | 单次调用即返回，无自主决策 | 调一次 API |
| **L2** | 多步固定流程 | 多步但流程由人预先编排，路径确定 | 固定模板报告生成 |
| **L3** | 动态规划 | 自主拆解目标并动态决定步骤，失败会重试 | 「调研这个主题并整理成表格」 |
| **L4** | 长程自治 + 自检 | 能跑数十分钟以上任务，主动检查并修正产出 | 跨文件实现功能并跑测试修到通过 |
| **L5** | 多Agent 协作 | 能观察到子任务并行派发与跨 Agent 结果交接 | 研究员+写作+审核并行流水线 |

每条数据都附有 `autonomyReason`，说明为什么评这个等级。

**有意思的发现**：8 个企业平台里 7 个只有 L2。它们的价值在治理、权限与合规，不在自主性。选平台看的是「管得住」，不是「聪明」。

### 分类（Tier）

| Tier | 定位 |
|---|---|
| 基础设施 | 模型、编排框架、协议——其他所有类型的基础 |
| 开发工具 | 开发者日常使用的编程 Agent，竞争最激烈的赛道 |
| 办公生产力 | 面向个人与小团队，交付可验收成果物 |
| 企业平台 | 组织级部署、治理与分发 |
| 垂直行业 | 单一行业深度应用，准确性与合规性优先 |

### 数据可信度

每条数据标注 `dataConfidence`：

- **high** —— 来自官网、官方文档或公告
- **medium** —— 来自技术媒体、行业分析或实测
- **low** —— 仅有推测或单一来源，需自行验证

## 项目结构

```
src/
├── data/
│   ├── agents.json          # 主数据（80 条）
│   └── meta.json            # 分类定义、评级标准、洞察
├── components/
│   ├── Overview/            # 首屏仪表盘 + 双维图谱
│   ├── Grid/                # 卡片网格 + 筛选器
│   ├── Detail/              # 详情面板
│   ├── Compare/             # 对比视图
│   └── bits.tsx             # 通用小组件
├── hooks/useAtlas.ts        # 筛选、对比、主题状态
├── lib/agents.ts            # 分类工具与搜索
└── types.ts
```

## 技术栈

- Vite 6 + React 18 + TypeScript 5.7
- Tailwind CSS 3（CSS 变量承载主题色）
- 自研 SVG 图谱，无图表库依赖
- 纯静态，无后端、无数据库、无 API key

Bundle 体积：gzip 后约 110 KB。

## 快捷键

| 键| 作用 |
|---|---|
| `/` | 聚焦搜索框 |
| `Esc` | 关闭详情/对比面板 |

筛选条件会同步到 URL，可直接分享特定视图。

## 部署

站点是纯静态产物，同一份`dist/` 可部署到多个平台。区别只在资源基础路径，由 `BASE_PATH` 决定：

```bash
BASE_PATH=/ npm run build# Cloudflare Pages 等根路径托管
BASE_PATH=/agent-atlas/ npm run build      # GitHub Pages（仓库名即子路径）
```

`BASE_PATH` 不设时默认为 `/`。**切换平台时必须重新构建**，否则资源 404。

### GitHub Pages

推送到 `main` 后由 `.github/workflows/deploy.yml` 自动构建部署，无需手动操作。
仓库 Settings → Pages → Source 选 `GitHub Actions`。

访问地址：`https://<用户名>.github.io/agent-atlas/`

### Cloudflare Pages

两种方式，任选其一：

**方式一：连接 Git 仓库（推荐）**

Dashboard → Workers & Pages → Create → Pages → Connect to Git，选取本仓库后填写：

| 配置项 | 值 |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| 环境变量 | `BASE_PATH` = `/` |

每次推送 `main` 自动重新部署。

**方式二：命令行直接上传**

```bash
npx wrangler login
npx wrangler pages deploy dist --project-name=agent-atlas
```

访问地址：`https://agent-atlas.pages.dev`

## 贡献新条目

见 [CONTRIBUTING.md](CONTRIBUTING.md)。简而言之：编辑 `src/data/agents.json`，字段结构和评级标准见 `src/types.ts` 与 `meta.json`。

## 免责声明

本站为独立研究索引，与任何厂商无隶属关系。**Agent 领域迭代极快**，产品状态、价格、定价策略变化频繁。数据为人工整理的研究快照，每条均标注采集时间，使用前请以各产品官方信息为准。

收录已停止运营、仅维护或被并购的产品，是为了呈现赛道演进的真实轨迹——「哪些死了」本身就是有价值的信息。

## License

MIT
