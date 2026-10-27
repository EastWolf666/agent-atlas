#!/usr/bin/env node
/**
 * Agent 评分数据同步
 *
 * 两个专门给 Agent 打分的公开榜单，口径不同、互不换算：
 *   1) Assistant Analysis（商业数字助理基准 v0.2.0）
 *      49 项真实任务逐项验证，主指标为「验证通过率」（任务达成且无越权/安全违规）。
 *      页面是 SPA，只能渲染后读表格 → 用 Playwright。
 *   2) The Agentic Leaderboard（开源 Agent 综合评分）
 *      Top 100，每周一重算；总分含可靠性、工具选择质量、平均步数、成本等权重。
 *      静态 HTML 表格，直接解析；详情页补分项。
 *
 * 为什么分两个区展示而不是合成一个总分：
 *   一边是「任务通过率 %」，一边是「加权综合分」，把两者平均没有任何方法论依据，
 *   只会造出一个看似权威、实则无法解释的数字。页面按来源分区，各自标注口径。
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
const AA_BOARD = 'https://assistantanalysis.com/leaderboard'

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

/* ---------------- 2. Assistant Analysis ---------------- */

async function fetchAssistantAnalysis(prev) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    log('  ⚠️ 未安装 playwright，跳过商业榜（保留上一版数据）')
    return prev || []
  }

  const candidates = [undefined, '/usr/bin/chromium', '/usr/bin/google-chrome']
  let browser = null
  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch(executablePath ? { executablePath } : {})
      break
    } catch {
      /* 试下一个 */
    }
  }
  if (!browser) {
    log('  ⚠️ 无可用 Chromium，跳过商业榜（保留上一版数据）')
    return prev || []
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    await page.goto(AA_BOARD, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForTimeout(2500)
    const rows = await page.evaluate(() => {
      return [...document.querySelectorAll('table tr')]
        .map((tr) => {
          const tds = [...tr.querySelectorAll('td')]
          if (tds.length < 8) return null
          const link = tds[0].querySelector('a')
          const nameBlock = (link?.innerText || '').split('\n')
          const cells = tds.map((td) => td.innerText.trim())
          return {
            name: nameBlock[0] || '',
            developer: nameBlock[1] || null,
            href: link?.getAttribute('href') || null,
            score: cells[1],
            reliability: cells[2],
            coverage: cells[7],
            lastEvaluated: cells[8],
            status: cells[9],
          }
        })
        .filter(Boolean)
    })

    const parsePct = (s) => {
      const m = String(s || '').match(/([\d.]+)\s*%/)
      return m ? Number(m[1]) : null
    }
    const out = rows
      .filter((r) => r.name)
      .map((r, i) => ({
        rank: i + 1,
        name: r.name,
        developer: r.developer,
        score: parsePct(r.score),
        reliability: parsePct(r.reliability),
        coverage: r.coverage || null,
        lastEvaluated: r.lastEvaluated || null,
        status: r.status || null,
        url: r.href ? new URL(r.href, 'https://assistantanalysis.com').toString() : null,
      }))
      .filter((r) => typeof r.score === 'number')

    await page.close()
    if (out.length === 0) throw new Error('商业榜解析结果为 0 条')
    return out
  } catch (e) {
    log(`  ⚠️ 商业榜抓取失败（${e.message}），保留上一版数据`)
    return prev || []
  } finally {
    await browser.close().catch(() => {})
  }
}

/* ---------------- main ---------------- */

async function main() {
  log(`\n=== Agent 评分同步 ${new Date().toISOString()} ===`)
  let prev = { commercial: [], openSource: [] }
  if (existsSync(OUT_PATH)) {
    try {
      const j = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
      prev = { commercial: j.commercial || [], openSource: j.openSource || [] }
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

  log('\n[2/2] Assistant Analysis（商业 Agent）')
  let commercial = []
  try {
    commercial = await fetchAssistantAnalysis(prev.commercial)
    log(`  ✅ ${commercial.length} 条`)
  } catch (e) {
    log(`  ❌ ${e.message}`)
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
  if (commercial.length === 0 && prev.commercial.length === 0) {
    console.error('❌ 商业榜从未成功抓取，放弃写盘')
    process.exit(1)
  }

  const alUpdated = openSource.length ? new Date().toISOString().slice(0, 10) : null
  const payload = {
    meta: {
      lastUpdated: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      sources: [
        {
          key: 'assistant-analysis',
          name: 'Assistant Analysis',
          url: 'https://assistantanalysis.com/leaderboard',
          version: 'v0.2.0',
          note: '49 项真实任务逐项验证；主指标为任务验证通过率（达成目标且无越权/安全违规）',
          evaluatedAt: commercial[0]?.lastEvaluated || null,
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
        '两个榜单口径不同，不能跨榜比较，也不做合并总分：Assistant Analysis 为任务验证通过率（%），' +
        'The Agentic Leaderboard 为加权综合分（0–100）。数据由脚本自动抓取，商用决策请以原榜单与方法论文档为准。',
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
