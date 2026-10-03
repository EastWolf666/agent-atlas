# 贡献指南

感谢参与。Agent 领域变化快，维持数据准确需要持续投入。

## 添加一个新条目

编辑 `src/data/agents.json`，向数组中追加一个对象。

### 字段结构

```jsonc
{
  "id": "kebab-case-英文唯一标识",   // 必须唯一，用 kebab-case
  "name": "产品官方名",
  "nameZh": "中文名",                 // 可选
  "vendor": "厂商名",
  "region": "overseas | china",       // 按厂商归属判断，与产品语言无关
  "tier": "infrastructure | coding | productivity | platform | vertical",
  "verticalDomain": "法律 | 医疗 | ...",  // 仅 tier=vertical 时填
  "status": "active | preview | maintenance | acquired | discontinued",
  "autonomyLevel": 1到5的整数,
  "autonomyReason": "为什么评这个等级",  // 必填，见下方要求
  "tagline": "一句话定位，≤30字",
  "description": "150-300字，见下方要求",
  "highlights": ["2-4条，每条≤20字"],
  "limitations": ["2-4条，每条≤25字"],
  "bestFor": "什么情况下该选它",
  "deployment": ["web|app|cli|ide|api|saas|private"],
  "pricingModel": "free|freemium|subscription|usage|open_source|enterprise",
  "pricingNote": "具体价格；未公开则写「未公开」",
  "contextWindow": "如 1M / 200K / 未公开",
  "modalities": ["text|image|audio|video|3d"],
  "openSource": true,
  "prominence": 1到10的整数,          // 相对知名度，用于图谱气泡大小
  "officialUrl": "官方网址",
  "sources": [{
    "title": "来源标题",
    "url": "网址",
    "type": "official|media|community|research",
    "date": "2026-09"                 // 精确到月
  }],
  "dataConfidence": "high|medium|low",
  "lastVerified": "2026-09"           // 精确到月
}
```

## 硬性要求

### 1. 自主性评级必须能对照标准

评级**不是主观印象**。每条都要能回答：这个产品在同一句指令、不同输入下，工具调用序列会不会不同？任务能跑多久？有没有自我验证循环？

反例：「这个产品很强很智能，所以给 L5」——这是错的。**企业平台大多只有 L2**，它们的价值在治理而不在自主性。

`autonomyReason` 字段是必填的，写清楚判断依据。

### 2. description 必须回答「它具体干了什么活」

❌ 反例：
> 强大的 AI 办公助手，广泛应用于办公场景。

✅ 正例：
> 读取用户上传的合同文档，提取条款并标注偏离标准模板的异常项，生成带引用的审查报告。局限：跨境交易规则覆盖不全，最终判断须律师复核。

原则：
- 第一句说**做什么**，不是「是什么」
- 中间写擅长什么、有独特设计的地方
- **结尾必须写局限**

**形容词不算信息。** 「领先的」「强大的」「智能的」这类词一律删掉。

### 3. limitations 不能省

这是本站最有价值的部分之一。用户需要知道产品**在哪里会出问题**，否则这份清单就是营销文案汇编。

如果某个产品确实找不到明显局限，写明具体的适用边界（例：「仅支持英文」「不提供API」）。

### 4. 来源至少一条，优先官方

每条数据至少 1 个 `official` 类型的来源。找不到官方信息的，`dataConfidence` 标 `medium` 或 `low`。

**不要编造**。价格未公开就写「未公开」，搜不到就降低可信度标注。宁可诚实标注不确定，也不要填充看起来专业但没依据的内容。

### 5. 停更产品照收，但必须标状态

这个赛道两年内的淘汰率接近一半。**已停止、仅维护、被并购的产品都要收录并标注**——「哪些死了」本身是有价值的信息。

对应 `status` 字段：

| 值 | 含义 |
|---|---|
| `active` | 持续维护或迭代中 |
| `preview` | 已发布但未正式 GA |
| `maintenance` | 仅修复安全问题 |
| `acquired` | 公司或产品被收购 |
| `discontinued` | 已明确停止运营 |

## 校验

提交前请运行：

```bash
npm run typecheck   # 类型检查
npm run build       # 构建，同时验证 JSON 格式
```

## 提交

```bash
git checkout -b add-your-agent
# 编辑 src/data/agents.json
npm run build
git add src/data/agents.json
git commit -m "feat: 添加 XXX Agent 数据"
git push origin add-your-agent
```

然后开PR。

## 判定 region 的常见误区

按**厂商归属**判断，不是按产品语言或主要用户群。

- 腾讯、阿里、字节、百度、智谱、月之暗面等中国厂商的产品 → `china`（即使有海外版）
- 国外厂商的产品 → `overseas`

## 找不到官方价格怎么办

写「未公开」，并把 `dataConfidence` 降级。**不要用「约」「大约」来掩盖不知道。**
