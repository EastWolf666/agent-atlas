/**
 * RSS 聚合 —— 国内候选 + 描述素材来源
 *
 * 源的选择是实测的结果（2026-10）：
 *   量子位qbitai.com/feed  ✅ 可用，但**必须带 User-Agent**，否则返回空 body
 *   TechCrunch AI         ✅ 20条/次
 *   Google AI (301跳转)   ✅ 需跟随重定向到 blog.google/innovation-and-ai/technology/ai/rss/
 *   机器之心 / 36氪        ❌ 端点返回 200 但 0 条 item，不可用
 *   国内大厂公众号          ❌ 微信封闭无 RSS
 *
 * RSS 只产出候选与来源线索，**不自动写 description** ——
 * 摘要是媒体视角的概述，跟我们需要的「这是什么、怎么用、有什么限制」不是一回事。
 */

import { fetchText } from '../http.mjs'
import { scoreCandidate, shouldEnqueue } from '../filter.mjs'

const FEEDS = [
  { key: 'qbitai', url: 'https://www.qbitai.com/feed', regionHint: 'china', name: '量子位' },
  {
    key: 'techcrunch',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    regionHint: 'overseas',
    name: 'TechCrunch AI',
  },
  {
    key: 'googleai',
    url: 'https://blog.google/innovation-and-ai/technology/ai/rss/',
    regionHint: 'overseas',
    name: 'Google AI',
    /*
     * 已知不稳定：部分网络环境（含本项目的沙箱）连不上 blog.google，
     * 会返回连接层失败。实测 curl 直接返回 HTTP 000——
     * 不是 404也不是超时，是 TCP 层面就不通。
     *
     * 保留它的理由：能连上的环境（多数 CI runner）它是稳定的海外一手源。
     * fetchFromRSS 已有「单源失败不中断」的保护，失败只记日志。
     */
    optional: true,
  },
]

/**
 * 媒体稿的标题是新闻标题，不是产品名——
 * "ChatGPT can now virtually try on clothes" / "Watch the winning trailer"
 * 这类标题里连 AI 都不是，却在关键词上蹭到了分。
 *
 * 所以媒体源加一道额外闸：只保留**明确在讲某个产品/模型/平台**的标题。
 * 判断依据是标题里出现「动作动词 + 产品名」或版本号这类发布信号。
 * 宁可漏掉几条，也不往候选池灌「某公司融资 450万美元」这种噪音——
 * 候选池一旦被灌满垃圾，就再也没人会去看了。
 */
const RELEASE_PATTERNS = [
  // 英文发布信号
  /\b(launch|launches|launched|releases|released|introduc\w+|announc\w+|unveil\w+|rolls out|now available|adds|upgrades)\b/i,
  /\bv?\d+(\.\d+)*\s*(is|now|comes|lands)/i,
  // 中文发布信号
  /(发布|推出|上线|开放|亮相|正式|首个|首个|新版|升级|开源|宣布|上线了)/,
]

/** 明确的非产品新闻，用来挡住蹭词的 */
const NEWS_NOISE_PATTERNS = [
  /\b(interview|podcast|opinion|editorial|funding|raises|valuation|acquisition|acquires|invests|lawsuit|regulat\w+|interview)\b/i,
  /(融资|上市|收购|裁员|专访|访谈|播客|观点|评论|预测|展望|盘点)/,
]

function isReleaseHeadline(title = '', description = '') {
  const text = `${title} ${description}`
  if (NEWS_NOISE_PATTERNS.some((re) => re.test(text))) return false
  return RELEASE_PATTERNS.some((re) => re.test(text))
}

/**
 * 抓所有 RSS 源。单个源失败不影响其它源。
 * @param {string} since ISO 时间戳
 */
export async function fetchFromRSS(since, { failures = [] } = {}) {
  const all = []
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url)
      const items = parseRSS(xml)
      const kept = []
      for (const it of items) {
        const dateISO = it.pubDate ? new Date(it.pubDate).toISOString() : null
        // 只保留水位线之后发布的
        if (dateISO && dateISO < since) continue

        /*
         * 双重闸门：先要求是「产品发布类」标题，再要求关键词命中。
         * 顺序很重要——先过发布信号，能避免为一条无关新闻去解析它的摘要。
         */
        if (!isReleaseHeadline(it.title, it.description)) continue

        const score = scoreCandidate({
          title: it.title,
          description: it.description ?? '',
          signals: {},
          sourceType: 'media',
        })
        if (!shouldEnqueue(score)) continue

        kept.push({
          slugSource: `rss:${feed.key}:${hash(it.link)}`,
          name: it.title.slice(0, 80),
          url: it.link,
          /*
           * 不因「媒体标题不是产品名」降权：候选池最终由人工把关，
           * 降权只会让真发布被提前丢掉。标题质量问题用 needsManualReview 标记，
           * 让筛选界面能提示，而不是悄悄沉底。
           */
          score,
          needsManualReview: true,
          date: (it.pubDate ?? '').slice(0, 7),
          regionHint: feed.regionHint,
          sourceName: feed.name,
          summary: stripHtml(it.description ?? '').slice(0, 240),
        })
      }
      console.log(`  ${feed.name}: ${items.length} 条 → 保留 ${kept.length}`)
      all.push(...kept)
    } catch (e) {
      // optional 源失败是预期内的事，日志措辞区分开，免得每次都被当成故障排查
      if (feed.optional) {
        console.log(`  ${feed.name}: 跳过（当前网络不可达，非故障）`)
      } else {
        console.warn(`  ${feed.name} 抓取失败（已跳过）: ${e.message}`)
        failures.push(feed.key)
      }
    }
  }
  return all
}

/** 极简 RSS/Atom 解析：只取 title/link/pubDate/description，避免引入 XML 库 */
function parseRSS(xml) {
  const items = []

  // RSS 2.0: <item>...</item>
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    const item = {
      title: decode(stripTags(pick(block, 'title'))),
      link: decode(stripTags(pick(block, 'link'))),
      pubDate: decode(stripTags(pick(block, 'pubDate'))),
      description: stripTags(pick(block, 'description')),
    }
    if (item.title && item.link) items.push(item)
  }

  // Atom: <entry>...</entry>
  if (!items.length) {
    for (const block of xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''
      const item = {
        title: decode(stripTags(pick(block, 'title'))),
        link: decode(href),
        pubDate: decode(stripTags(pick(block, 'updated')) || stripTags(pick(block, 'published'))),
        description: stripTags(pick(block, 'summary') || pick(block, 'content')),
      }
      if (item.title && item.link) items.push(item)
    }
  }

  return items
}

function pick(block, tag) {
  return block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? ''
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripHtml(s) {
  return stripTags(s)
}

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** 稳定 hash，用作去重键 */
function hash(s = '') {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}