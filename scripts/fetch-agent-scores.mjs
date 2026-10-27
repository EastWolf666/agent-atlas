#!/usr/bin/env node
/**
 * Agent 评分数据同步
 *
 * 两个专门给 Agent 打分的公开榜单，口径不同、互不换算：
 *   1) Artificial Analysis — Coding Agent Index（商业编码 Agent 实测）
 *      FrontierCode v1.1、SWE-Atlas-QnA、Terminal-Bench v4 三项等权合成，
 *      主指标为「编码指数」（0–100，实为各数据集平均 reward）。
 *      页面是 Next.js，数据以 flight（self.__next_f.push）内嵌，不需要浏览器。
 *      一行 = 一个「Agent × 驱动模型 × 推理档位」组合，所以同一 Agent 会占多行。
 *   2) The Agentic Leaderboard（开源 Agent 综合评分）
 *      Top 100，每周一重算；总分含可靠性、工具选择质量、平均步数、成本等权重。
 *      静态 HTML 表格，直接解析；详情页补分项。
 *
 * 为什么分两个区展示而不是合成一个总分：
 *   一边是「编码指数（任务 reward 均值）」，一边是「加权综合分」，把两者平均没有任何方法论依据，
 *   只会造出一个看似权威、实则无法解释的数字。页面按来源分区，各自标注口径。
 *
 * 换源记录（2026-10-27）：
 *   商业榜原用 Assistant Analysis（49 项任务的验证通过率），但该源只有 9 个系统且快照自
 *   2026-09 起不再更新，每天抓回来的都是同一批数字；页面还是 SPA，必须靠 Playwright 渲染。
 *   换成 AA Coding Agent Index 后同源同解析方式（与大模型评分页一致），每日真刷新。
 *
 * 跑法：node scripts/fetch-agent-scores.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_PATH = resolve(ROOT, 'src/data/agent-scores.json')
const DRY_RUN = process.argv.includes('--dry-run')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const AL_LIST = 'https://www.theagenticleaderboard.com/agent'
const AL_AGENT = (slug) => `https://www.theagenticleaderboard.com/agent/${slug}/`
const AA_AGENTS = 'https://artificialanalysis.ai/agents'
/** 换源前的口径标记：旧 Assistant Analysis 数据不能用新源逻辑兜底 */
const COMMERCIAL_SOURCE = 'aa-coding-agents'

function log(m) {
  console.log(m)
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

async function getText(url, timeout = 30000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(t)
  }
}

/**
 * 从 Next.js flight 数据里取出指定数组，如 extractFlightArray(html, 'benchmarkRows')
 * 括号配对必须跳过字符串内部的括号，否则遇到 "Opus 5.5 (max)" 这类值就会提前截断。
 */
function extractFlightArray(html, key) {
  const chunks = [...html.matchAll(/<script>self\.__next_f\.push\(\[1,("[\s\S]*?")\]\)<\/script>/g)]
  let text = ''
  for (const c of chunks) {
    try {
      text += JSON.parse(c[1])
    } catch {
      /* 跳过坏 chunk */
    }
  }
  const at = text.indexOf(`"${key}":[`)
  if (at < 0) throw new Error(`未找到 ${key}（页面结构可能已变）`)
  const start = text.indexOf('[', at)
  let depth = 0
  let end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '"') {
      i++
      while (i < text.length) {
        if (text[i] === '\\') i++
        else if (text[i] === '"') break
        i++
      }
      continue
    }
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error(`${key} 数组未闭合`)
  return JSON.parse(text.slice(start, end + 1))
}

/** 上游偶尔把推理档位配置整段塞进名字里，如 "Opencode - GLM-5.3 ({'reasoning_effort': 'max'})" */
const cleanName = (s) =>
  String(s ?? '')
    .replace(/\s*\(\{[^}]*\}\)\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const round2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 10 : null)

/* ---------------- 1. The Agentic Leaderboard ---------------- */

function parseAgenticList(html) {
  const rows = []
  for (const block of html.split('<tr>').slice(1)) {
    const rank = block.match(/#<!-- -->(\d+)/)
    const slug = block.match(/href="\/agent\/([^/"]+)\/?"/)
    const name = block.match(/<a class="font-semibold[^"]*"[^>]*>([^<]+)<\/a>/)
    const dev = block.match(/by <!-- -->([^<]+)</)
    const cat = block.match(/text-sm text-gray-500">([^<]+)<\/td>/)
    const score = block.match(/font-mono font-bold text-gray-800">([\d.]+)<\/td>/)
    if (!rank || !slug || !name || !score) continue
    rows.push({
      rank: Number(rank[1]),
      slug: slug[1],
      name: decode(name[1]),
      developer: dev ? decode(dev[1]) : null,
      category: cat ? decode(cat[1]) : 'Uncategorized',
      score: Number(score[1]),
      url: `https://www.theagenticleaderboard.com/agent/${slug[1]}`,
    })
  }
  return rows
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n+/g, '\n')
}

function parseAgenticDetail(html) {
  const text = stripTags(html)
  const num = (re) => {
    const m = text.match(re)
    return m ? Number(m[1]) : null
  }
  let stars = null
  const sm = text.match(/GitHub Stars\n([\d.]+)(k?)/)
  if (sm) stars = Math.round(Number(sm[1]) * (sm[2] === 'k' ? 1000 : 1))
  let latencyMs = null
  const lm = text.match(/Latency\n([\d.]+)(ms|s|m)/)
  if (lm) {
    const v = Number(lm[1])
    latencyMs = lm[2] === 'ms' ? v : lm[2] === 's' ? v * 1000 : v * 60000
  }
  const desc = html.match(/<p class="mt-4 text-gray-600">([\s\S]*?)<\/p>/)
  return {
    reliability: num(/scoring\s*([\d.]+)\s*%\s*on reliability/),
    toolSelection: num(/([\d.]+)\s*%\s*on tool selection quality/),
    avgSteps: num(/Avg Steps\n(\d+)/),
    costPerTask: num(/Cost \/ Task\n\$([\d.]+)/),
    latencyMs: latencyMs == null ? null : Math.round(latencyMs),
    stars,
    mindshare: num(/Mindshare\n([\d.]+)/),
    description: desc ? decode(stripTags(desc[1]).replace(/\n/g, ' ')).slice(0, 240) : null,
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      try {
        out[idx] = await fn(items[idx], idx)
      } catch {
        out[idx] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function fetchAgentic(prev) {
  const html = await getText(AL_LIST)
  const list = parseAgenticList(html)
  if (list.length === 0) throw new Error('榜单解析结果为 0 条')
  log(`  榜单 ${list.length} 条，抓取详情补分项…`)

  const details = await mapPool(list, 8, async (row) => parseAgenticDetail(await getText(AL_AGENT(row.slug))))
  const merged = list.map((row, i) => ({ ...row, ...(details[i] || {}) }))

  const prevMap = new Map((prev || []).map((r) => [r.slug, r]))
  // 详情抓失败的条目，用上一版分项兜底，避免整块字段突然变空
  const out = merged.map((r) => {
    const p = prevMap.get(r.slug)
    if (!p) return r
    const filled = { ...r }
    for (const k of ['reliability', 'toolSelection', 'avgSteps', 'costPerTask', 'latencyMs', 'stars', 'mindshare']) {
      if (filled[k] == null && p[k] != null) filled[k] = p[k]
    }
    return filled
  })
  return out
}

/* ---------------- 2. Artificial Analysis — Coding Agent Index ---------------- */

/**
 * 商业编码 Agent 实测榜
 *
 * 一行 = Agent × 驱动模型 × 推理档位，所以 Claude Code 会占多行（不同模型/档位）。
 * 这里故意不做 Agent 级去重：同一个 Agent 换模型后分数能差 10 分以上，
 * 压成一行反而把最有价值的「搭什么模型才划算」这个信息抹掉了。
 */
async function fetchAACodingAgents() {
  const html = await getText(AA_AGENTS, 45000)
  const rows = extractFlightArray(html, 'benchmarkRows')
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('benchmarkRows 解析为空')

  const scored = rows.filter((r) => typeof r?.indexScore === 'number')
  log(`  榜单 ${rows.length} 条，其中有分数 ${scored.length} 条`)
  if (scored.length === 0) throw new Error('没有带分数的条目（上游可能改版）')

  // 评测时点：取所有条目里最新的驱动版本发布日期
  let evaluatedAt = null
  for (const r of scored) {
    for (const v of Object.values(r.versions || {})) {
      const d = v?.max?.dateReleased
      if (typeof d === 'string' && (!evaluatedAt || d > evaluatedAt)) evaluatedAt = d
    }
  }

  const out = scored
    .slice()
    .sort((a, b) => b.indexScore - a.indexScore)
    .map((r, i) => ({
      rank: i + 1,
      name: cleanName(r.displayLabel || r.display?.agent || r.agentName || '—'),
      agent: cleanName(r.agentName) || null,
      model: cleanName(r.display?.model) || null,
      developer: r.agentCreator?.name ?? null,
      score: round1(r.indexScore * 100),
      costUsd: round2(r.mean?.costUsd),
      wallTimeSec: typeof r.mean?.agentWallTimeSec === 'number' ? Math.round(r.mean.agentWallTimeSec) : null,
      steps: typeof r.mean?.steps === 'number' ? Math.round(r.mean.steps) : null,
      cacheHitRate: pct(r.mean?.cacheHitRate),
      safetyRefusalRate: pct(r.safety?.rate),
      evals: (r.evals || [])
        .map((e) => ({
          name: e?.evaluationDatasetSlug ?? null,
          score: pct(e?.mean?.reward),
          weight: e?.weight ?? null,
        }))
        .filter((e) => e.name),
      url: AA_AGENTS,
      source: COMMERCIAL_SOURCE,
    }))
    .filter((r) => typeof r.score === 'number')

  if (out.length === 0) throw new Error('商业榜解析结果为 0 条')
  return { rows: out, evaluatedAt }
}

/* ---------------- main ---------------- */

async function main() {
  log(`\n=== Agent 评分同步 ${new Date().toISOString()} ===`)
  let prev = { commercial: [], openSource: [] }
  if (existsSync(OUT_PATH)) {
    try {
      const j = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
      prev = { commercial: j.commercial || [], openSource: j.openSource || [], meta: j.meta || null }
    } catch {
      /* 坏文件按首次处理 */
    }
  }

  log('\n[1/2] The Agentic Leaderboard（开源 Agent）')
  let openSource = []
  try {
    openSource = await fetchAgentic(prev.openSource)
    log(`  ✅ ${openSource.length} 条`)
  } catch (e) {
    log(`  ❌ ${e.message}`)
  }

  log('\n[2/2] Artificial Analysis · Coding Agent Index（商业编码 Agent）')
  let commercial = []
  let aaEvaluatedAt = null
  // 旧口径（Assistant Analysis）数据不能拿来给新榜兜底——字段和量纲都不同，混着显示是错的
  const prevSameSource =
    Array.isArray(prev.commercial) &&
    prev.commercial.length > 0 &&
    prev.commercial[0]?.source === COMMERCIAL_SOURCE
  try {
    const res = await fetchAACodingAgents()
    commercial = res.rows
    aaEvaluatedAt = res.evaluatedAt
    log(`  ✅ ${commercial.length} 条`)
  } catch (e) {
    log(`  ❌ ${e.message}`)
    if (prevSameSource) {
      commercial = prev.commercial
      aaEvaluatedAt = prev.meta?.sources?.find((s) => s.key === COMMERCIAL_SOURCE)?.evaluatedAt ?? null
      log(`  ↩️ 用上一版同口径数据兜底（${commercial.length} 条）`)
    }
  }

  /* 熔断：任一榜单突然归零/腰斩，几乎都是上游改版，写盘会把页面清空 */
  if (openSource.length === 0) {
    console.error('❌ 开源榜 0 条，判定上游异常，放弃写盘')
    process.exit(1)
  }
  if (prev.openSource.length > 10 && openSource.length < prev.openSource.length * 0.5) {
    console.error(`❌ 开源榜从 ${prev.openSource.length} 跌到 ${openSource.length}，放弃写盘`)
    process.exit(1)
  }
  if (commercial.length === 0) {
    console.error('❌ 商业榜 0 条，且没有同口径历史数据可兜底，放弃写盘')
    process.exit(1)
  }

  const alUpdated = openSource.length ? new Date().toISOString().slice(0, 10) : null
  const payload = {
    meta: {
      lastUpdated: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      sources: [
        {
          key: COMMERCIAL_SOURCE,
          name: 'Artificial Analysis · Coding Agent Index',
          url: AA_AGENTS,
          version: 'FrontierCode v1.1 + SWE-Atlas-QnA + Terminal-Bench v4',
          note: '三项数据集等权合成；编码指数 = 各数据集平均 reward（0–100）。一行是一个 Agent × 驱动模型组合',
          evaluatedAt: aaEvaluatedAt,
          count: commercial.length,
        },
        {
          key: 'agentic-leaderboard',
          name: 'The Agentic Leaderboard',
          url: AL_LIST,
          version: null,
          note: '开源 Agent 综合评分（可靠性、工具选择质量、平均步数、成本等加权）；每周一重算',
          evaluatedAt: alUpdated,
          count: openSource.length,
        },
      ],
      disclaimer:
        '两个榜单口径不同，不能跨榜比较，也不做合并总分：Artificial Analysis 编码指数是三项数据集的' +
        '平均 reward（0–100），The Agentic Leaderboard 是加权综合分（0–100）。' +
        '成本与耗时为榜单测试时点的均值，不是厂商定价。数据由脚本自动抓取，商用决策请以原榜单与方法论文档为准。',
    },
    commercial,
    openSource,
  }

  if (DRY_RUN) {
    log('\n--dry-run：未写盘')
    return
  }
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  log(`\n已写入 ${OUT_PATH}（商业 ${commercial.length} / 开源 ${openSource.length}）`)
}

main().catch((e) => {
  console.error('❌ 未捕获异常：', e)
  process.exit(1)
})
