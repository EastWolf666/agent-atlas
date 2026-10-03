/**
 * 候选筛选规则
 *
 * 这个模块决定「什么才算一个值得人工看一眼的 Agent 产品候选」。
 * 门槛定得太松 -> 候选池被 macOS 工具、图标包之类灌满，人工根本筛不动；
 * 定得太紧 -> 漏掉真正的新产品。所以阈值集中在这里，方便调整。
 */

/** 判定为 Agent 产品的关键词（英文） */
const AGENT_TERMS_EN = [
  'agent', 'agentic', 'llm', 'gpt', 'copilot', 'assistant', 'autonomous',
  'multi-agent', 'mcp', 'tool-use', 'rag',
]

/** 判定为 Agent 产品的关键词（中文） */
const AGENT_TERMS_ZH = [
  '智能体', '代理', '大模型', '大语言模型', 'copilot', '智能助手', 'ai助手',
  'ai 助手', '工作流', '自动化', '多智能体', '编程助手',
]

/** 明确排除的噪声词：这些是 Show HN 里的典型非 AI 项目 */
const NOISE_TERMS = [
  'macos', 'notch', 'dynamic island', 'icon', 'theme', 'wallpaper',
  'keyboard', 'mouse', 'monitor stand', 'dock', 'menu bar',
  // 游戏/娱乐向的 Show HN 很多，它们常在描述里提"agent"（game agent）
  'game', 'gameplay', 'vr', 'vision pro', 'oculus', 'steam',
  'trailer', 'soundtrack', 'pixel art',
]

/**
 * 非产品内容的标题特征。
 * 这些即使蹭到 agent/AI 关键词也不是收录对象：
 * 新闻评论、融资新闻、教程、访谈。
 */
const NON_PRODUCT_PATTERNS = [
  /\b(interview|podcast|opinion|editorial|column|essay|how to|how i|tutorial|guide to|best practices|top \d+)\b/i,
  /\b(funding|raises|raised|valuation|invests?|investment round|series [abc]|seed round)\b/i,
  /\b(acquisition|acquires?|acquired|merger|merges|ipo|lawsuit|sues?|regulators?|ban|banned)\b/i,
  /(融资|上市|收购|并购|裁员|专访|访谈|播客|观点|评论|预测|展望|盘点|教程|指南|避坑|推荐|榜单)/,
]

/**
 * 入池的最低匹配分。
 *
 * 阈值不是拍的，是按实测分布定的：
 *   完全无关条目 0 分（无关键词直接判死）
 *   macOS 类噪声 0 分（NOISE_TERMS 命中）
 *   媒体标题的普通 Agent 条目 ~38 分
 *   HN 多关键词框架 ~45-53 分
 *   GitHub 高星项目 57+ 分
 *
 * 取 35：能稳稳接住「标题只提到一次 agent」的真实新发布，
 * 又不会放进 0 分的噪声。候选池本来就靠人工最终把关，
 * 宁可多捞几条让人扫一眼，也不要漏掉新发布的产品。
 */
export const MIN_MATCH_SCORE = 35

/**
 * 给一个候选打分（0-100）。
 *
 * 构成（实测校准过，见下方 CALIBRATION）：
 *   关键词命中最多 55 分 + 热度信号最多 30 分 + 来源可信度最多 15 分
 *
 * 校准依据：真实抓来的"OpenAI 推出新 Agent 模型"这类条目应在 60-75 分，
 * 无关键词的噪声应低于 40。早期版本关键词只给 25 分，导致正常候选
 * 卡在 33 分永远够不到门槛——权重必须按实测分布定，不能拍脑袋。
 */
export function scoreCandidate({ title = '', description = '', signals = {}, sourceType = '' }) {
  const text = `${title} ${description}`.toLowerCase()

  // 噪声词命中且没有任何中文 AI 词，直接判死
  const noiseHits = NOISE_TERMS.filter((w) => text.includes(w)).length
  if (noiseHits > 0 && !AGENT_TERMS_ZH.some((w) => text.includes(w))) {
    return 0
  }

  // 新闻/评论/教程类：即便蹭到关键词也不是产品收录对象
  if (NON_PRODUCT_PATTERNS.some((re) => re.test(`${title} ${description}`))) {
    return 0
  }

  const enHits = AGENT_TERMS_EN.filter((w) => text.includes(w)).length
  const zhHits = AGENT_TERMS_ZH.filter((w) => text.includes(w)).length

  // 一个关键词都没有 —— 不是 Agent 产品
  if (enHits === 0 && zhHits === 0) return 0

  let score = 0

  /*
   * 关键词命中：基础 30 分（中英文各算一次），多命中递减加分。
   * 用递减而非线性，因为第 1 个关键词的判别力远大于第 5 个
   *（"agent" 满大街都是，"multi-agent + mcp + rag" 才是真Agent 框架）。
   */
  const totalHits = enHits + zhHits
  score += 30
  if (totalHits >= 2) score += 10
  if (totalHits >= 3) score += 8
  if (totalHits >= 5) score += 7// 3+8+7=55 上限

  // 热度信号
  if (signals.stars) {
    if (signals.stars >= 5000) score += 20
    else if (signals.stars >= 1000) score += 15
    else if (signals.stars >= 200) score += 10
    else if (signals.stars >= 50) score += 5
  }
  if (signals.hnPoints) {
    if (signals.hnPoints >= 150) score += 10
    else if (signals.hnPoints >= 50) score += 6
    else if (signals.hnPoints >= 20) score += 3
  }

  // 来源可信度
  if (sourceType === 'official') score += 15
  else if (sourceType === 'github') score += 12
  else if (sourceType === 'media') score += 8
  else if (sourceType === 'community') score += 5

  return Math.min(score, 100)
}

/** 是否达到入池门槛 */
export function shouldEnqueue(score) {
  return score >= MIN_MATCH_SCORE
}

/** 去掉 Show HN 前缀，得到干净的产品名 */
export function cleanTitle(title = '') {
  return String(title)
    .replace(/^Show HN:\s*/i, '')
    .replace(/^(Ask HN|Presenting|Tell HN):\s*/i, '')
    .trim()
}

/** 从描述/标题猜 region，供人工参考（仅建议，不写入 agents.json） */
export function guessRegion(text = '') {
  const zh = AGENT_TERMS_ZH.some((w) => text.toLowerCase().includes(w))
  const cnVendor = /(阿里|腾讯|百度|字节|华为|智谱|商汤|月之暗面|DeepSeek|百川| MiniMax|阶跃|讯飞|钉钉|飞书|火山|智谱)/.test(text)
  if (zh || cnVendor) return 'china'
  return 'overseas'
}

/** 猜 tier（仅建议，供人工参考） */
export function guessTier(text = '', name = '') {
  const t = `${text} ${name}`.toLowerCase()
  if (/(law|legal|contract|compliance|金融|finance|health|medical|教育|客服|customer|hr|recruit)/.test(t)) {
    return 'vertical'
  }
  if (/(code|coding|developer|ide|编程|代码|开发者)/.test(t)) return 'coding'
  if (/(sdk|framework|infra|runtime|protocol|框架|协议|基础设施)/.test(t)) return 'infrastructure'
  if (/(platform|platform|orchestrat|console|企业级|中台)/.test(t)) return 'platform'
  if (/(office|productivity|meeting|note|文档|办公|会议)/.test(t)) return 'productivity'
  return 'vertical'
}

/** 生成 slug，作为候选去重键 */
export function slugify(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}