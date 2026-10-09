#!/usr/bin/env node
/**
 * 国产替代候选发现 —— 定时搜索「海外 AI 工具的国产替代」线索
 *
 * 跑法：npm run fetch 时由 fetch.mjs 第 8 步以子进程调用；
 *       也可单独跑：node scripts/fetch-alternatives.mjs [--dry-run]
 *
 * 为什么用 HN Algolia：
 *   - 免费免鉴权、created_at 可精确增量（复用 watermark.mjs 水位线机制）；
 *   - 「XX alternative」是 HN 上替代品讨论的固定句式，命中质量远高于泛搜新闻。
 *
 * 设计原则与 candidates.json（Agent 候选池）一致：**机器只发现、不入库**。
 *   机器能做：搜到「提到某海外工具 + 替代语义」的讨论，归档成候选线索；
 *   机器不能做：判断线索里的国产产品是否真实存在、是否值得收录进替代地图。
 *   所以产物只有一份数据/alternatives-candidates.json 候选池，由人工审核后
 *   手动加进 src/data/alternatives.json。
 *
 * 误报控制（三层，宁可漏报不可误报）：
 *   1. 必须命中已收录海外工具名（词边界正则，见 OVERSEAS_MATCHERS 特例表——
 *      "You.com" 若按裸词匹配会把一切带 you 的标题都捞进来，"D-ID" 会命中
 *      英文单词 did，这些都在特例表里用字面模式兜住）；
 *   2. 同一文本必须共现替代语义词（alternative / replacement / 平替 / 替代…）；
 *   3. 命中判定只看标题与 story_text，不看评论——评论噪声比标题高一个量级。
 *
 * 水位线：写 data/.watermark.json 的 'hn-alt' 键，与 Agent 管线的 'hn' 互不干扰。
 *   ⚠️ 本脚本必须在 fetch.mjs 的 [7/8] 写盘之后运行（现在就是这么排的）：
 *   主进程在 [7/8] 会用它内存里的副本整体覆盖水位线文件，若本脚本先推进了
 *   'hn-alt' 就会被那次覆盖抹掉，导致同一窗口反复抓。
 *
 * 熔断：
 *   - 所有请求全部失败 → exit(1)，fetch.mjs 捕获后只告警不影响主流程；
 *   - 本次 0 条新增 → 不写候选文件（保留旧池），水位线照常推进
 *     （不推进的话明天还会在同一窗口空跑）。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchJson } from './lib/http.mjs'
import { loadWatermarks, saveWatermarks, sinceFor, advanceWatermark } from './lib/watermark.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ALT_PATH = resolve(ROOT, 'src/data/alternatives.json')
const CAND_PATH = resolve(ROOT, 'data/alternatives-candidates.json')
const WATERMARK_PATH = resolve(ROOT, 'data/.watermark.json')

const SOURCE_KEY = 'hn-alt'
const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date'
const DRY_RUN = process.argv.includes('--dry-run')

/** 请求间隔（ms），对免费 API 保持礼貌 */
const REQUEST_GAP_MS = 300

function log(msg) {
  console.log(msg)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 海外工具匹配规则。
 * 默认规则：工具名的 \b 词边界转义；这里是「默认规则会误伤」的特例表。
 * patterns 命中任意一条即算匹配。
 *
 * @type {Record<string, RegExp[]>}  key = alternatives.json 里的海外工具 id
 */
const MATCHER_OVERRIDES = {
  // "you" 是英文高频词，只认域名形态
  you: [/\byou\.com\b/i],
  // \bd-?id\b 会命中英文单词 "did"，只认 d-id / did.com 字面
  'd-id': [/\bd-id\b/i, /\bdid\.com\b/i],
  // DALL·E 的间隔号在英文讨论里写作 DALL-E / DALLE / DALL E
  'dall-e': [/\bdall[·.\s-]?e\b/i, /\bdalle\b/i],
  // 「Google 翻译」在英文语境是 Google Translate
  'google-translate': [/google\s+translat/i],
  // ms-copilot 必须带 Microsoft/Bing 前缀，裸 copilot 归 github-copilot
  'ms-copilot': [/microsoft\s+(365\s+)?copilot/i, /\bbing\s+(copilot|chat)\b/i],
  // 官方名 Microsoft 365 Copilot，简称 Copilot（裸词，会与 ms-copilot 双命中，无害）
  'github-copilot': [/github\s+copilot/i, /\bcopilot\b/i],
  // khanmigo 常被直接叫 Khan Academy
  khanmigo: [/\bkhanmigo\b/i, /\bkhan\s+academy\b/i],
  // elevenlabs 的官方大小写是 ElevenLabs，讨论里常拆成 eleven labs
  elevenlabs: [/\beleven\s?labs\b/i],
  // murf 官方域是 murf.ai，裸词 murf 误伤少但补域名形态更稳
  murf: [/\bmurf\.ai\b/i, /\bmurf\b/i],
  // otter / fireflies 都是普通英文单词，只认带 .ai 的域名形态
  otter: [/\botter\.ai\b/i],
  fireflies: [/\bfireflies\.ai\b/i],
  // tl;dv 里的分号需要字面匹配
  tldv: [/\btl;?dv\b/i],
  // Brave 单独出现多为浏览器新闻，限定 search/browser/根本体
  'brave-search': [/\bbrave\s+(search|browser)\b/i, /\bbrave\s+ai\b/i],
  // notion 单独出现多为 Notion 本体新闻，限定 AI 语境会漏掉
  // 「Notion alternative」这种核心句式，故保留裸词（替代语义词兜底过滤）
  'notion-ai': [/\bnotion\b/i],
}

/** 替代语义词：与工具名共现才算候选线索 */
const ALT_SEMANTIC =
  /\balternativ|\breplac|\bsubstitut|\bclone\b|\bkiller\b|instead of|switch(ed)?\s+(from|to)|migrat\w*\s+from|\b(cancel|drop|quit|left)\w*\s+\w*(for|because)|shut\w*\s+down|\bsunset(ting|ted)?\b|\brΙ?p\w*\s+off|平替|替代|国产/i

/** 从 alternatives.json 构造 { id → { name, category, patterns } } */
function buildMatchers(items) {
  const overseas = items.filter((x) => x.region === 'overseas')
  const matchers = []
  for (const t of overseas) {
    const patterns = MATCHER_OVERRIDES[t.id] ?? [
      new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    ]
    matchers.push({ id: t.id, name: t.name, category: t.category, patterns })
  }
  return matchers
}

/** 在文本里找出命中的海外工具（去重、保序） */
function matchOverseas(text, matchers) {
  const hits = []
  for (const m of matchers) {
    if (m.patterns.some((re) => re.test(text))) hits.push(m)
  }
  return hits
}

/**
 * 判定一条故事是否「替代关系」线索，返回 { matched, level } 或 null。
 *
 * 两级判定（实测教训：全文共现会把「正文顺带提及 Claude」的故事误判成
 * Claude 替代品——OpenChart 是 TradingView 替代品，只因正文一句
 * "we wanted Claude to interface with the markets" 就命中了 claude）：
 *   - 标题级：标题含替代语义，且标题里出现已知海外工具名 → 直接采信，
 *     matched 只取标题内命中的工具（替代对象几乎总在标题里）；
 *   - 正文级：标题无语义或标题无工具名时，逐句查正文，
 *     只有「同一句内既有替代语义又有工具名」才算——顺带提及通常不带替代词。
 */
function judgeStory(title, storyText, matchers) {
  const matchedInTitle = matchOverseas(title, matchers)
  if (ALT_SEMANTIC.test(title) && matchedInTitle.length > 0) {
    return { matched: matchedInTitle, level: 'title' }
  }
  if (!storyText) return null
  const sentences = String(storyText).split(/(?<=[.!?])\s+|<[^>]+>|\n+/)
  const inSentence = new Map()
  for (const s of sentences) {
    if (!s || !ALT_SEMANTIC.test(s)) continue
    for (const m of matchOverseas(s, matchers)) inSentence.set(m.id, m)
  }
  if (inSentence.size === 0) return null
  return { matched: [...inSentence.values()], level: 'text' }
}

/** 工具级搜索词：id → HN 搜索 query（名字含点号/间隔号的用 id 更好搜） */
const QUERY_OVERRIDES = {
  'dall-e': 'dall-e',
  'd-id': 'd-id',
  you: 'you.com',
  otter: 'otter.ai',
  fireflies: 'fireflies.ai',
  tldv: 'tldv',
  elevenlabs: 'elevenlabs',
  'google-translate': 'google translate',
  'ms-copilot': 'microsoft copilot',
  'brave-search': 'brave search',
}

function queryFor(tool) {
  const q = QUERY_OVERRIDES[tool.id] ?? tool.name
  return `${q} alternative`
}

/**
 * 拉一个 query 的增量命中。
 * @returns {Promise<Array>} hits（可能为空数组）
 */
async function searchHN(query, sinceUnix, hitsPerPage = 30) {
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(query)}&tags=story` +
    `&hitsPerPage=${hitsPerPage}&numericFilters=created_at_i>${sinceUnix}`
  const data = await fetchJson(url)
  return data.hits ?? []
}

async function main() {
  const startedAt = Date.now()
  log('\n--- 国产替代候选发现（HN Algolia）---')

  const alt = JSON.parse(readFileSync(ALT_PATH, 'utf8'))
  const matchers = buildMatchers(alt.items)
  log(`  已收录海外工具 ${matchers.length} 个，作为匹配锚点`)

  const watermarks = loadWatermarks(WATERMARK_PATH)
  const { since, isInitial } = sinceFor(watermarks, SOURCE_KEY)
  const sinceUnix = Math.floor(new Date(since).getTime() / 1000)
  log(`  水位线 ${since.slice(0, 10)}${isInitial ? '（首次，回填 7 天）' : '（增量）'}`)

  // ---------- 搜索 ----------
  const queries = [
    // 通用：中文/国产替代的英文讨论句式
    'chinese alternative AI',
    'china alternative AI tool',
    // 工具级："{工具名} alternative"
    ...matchers.map(queryFor),
  ]

  const bySlug = new Map() // slug → candidate（跨 query 去重）
  let failures = 0

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    try {
      const hits = await searchHN(query, sinceUnix)
      if (i < 5 || hits.length > 0) {
        log(`  [${i + 1}/${queries.length}] "${query}" → ${hits.length} 条`)
      }
      for (const h of hits) {
        // 纯文本帖没有外链，线索无法溯源
        if (!h.title) continue
        const verdict = judgeStory(h.title, h.story_text ?? '', matchers)
        if (!verdict) continue // 层 1+2：已知海外工具名 × 替代语义共现

        const slug = `hnalt:${h.objectID}`
        if (bySlug.has(slug)) continue
        bySlug.set(slug, {
          slug,
          title: h.title,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          storyUrl: h.url ?? null,
          source: 'hn',
          matchedOverseas: verdict.matched.map((m) => m.id),
          categoryHint: verdict.matched[0].category,
          matchLevel: verdict.level,
          description: '',
          signals: { hnPoints: h.points ?? 0, hnComments: h.num_comments ?? 0 },
          snippet: String(h.story_text ?? '').slice(0, 280) || null,
          discoveredAt: new Date().toISOString().slice(0, 10),
          decided: false,
        })
      }
    } catch (e) {
      failures++
      log(`  ⚠️ "${query}" 失败: ${e.message}`)
    }
    if (i < queries.length - 1) await sleep(REQUEST_GAP_MS)
  }

  if (failures === queries.length) {
    throw new Error(`全部 ${queries.length} 个搜索请求失败，本次不写盘`)
  }

  // ---------- 去重合并 ----------
  const existing = existsSync(CAND_PATH)
    ? JSON.parse(readFileSync(CAND_PATH, 'utf8'))
    : { generatedAt: null, candidates: [] }
  const knownSlugs = new Set(existing.candidates.map((c) => c.slug))
  const fresh = [...bySlug.values()].filter((c) => !knownSlugs.has(c.slug))

  log(`  命中 ${bySlug.size} 条，其中新线索 ${fresh.length} 条`)

  if (fresh.length > 0 && !DRY_RUN) {
    existing.candidates.push(...fresh)
    existing.generatedAt = new Date().toISOString().slice(0, 10)
    mkdirSync(dirname(CAND_PATH), { recursive: true })
    writeFileSync(CAND_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8')
    log(`  ✅ 已写入 ${CAND_PATH.replace(ROOT + '/', '')}（池内共 ${existing.candidates.length} 条）`)
  } else if (fresh.length === 0) {
    log('  0 条新线索，不写盘（保留旧池）')
  } else {
    log('  --dry-run：不写盘')
  }

  const pending = existing.candidates.filter((c) => !c.decided).length
  log(`  待人工处理 ${pending} 条`)

  // 水位线推进：即使 0 新增也推进（窗口已处理完）。
  // 必须先 load 到变量上改，改完再 save——边 load 边 save 会把没改的副本写回去。
  if (!DRY_RUN) {
    const wm = loadWatermarks(WATERMARK_PATH)
    advanceWatermark(wm, SOURCE_KEY, new Date().toISOString())
    saveWatermarks(WATERMARK_PATH, wm)
  }

  log(`  完成（${Math.round((Date.now() - startedAt) / 1000)}s，失败 ${failures}/${queries.length}）`)
}

main().catch((e) => {
  console.error(`❌ 国产替代候选发现失败: ${e.message}`)
  process.exit(1)
})
