#!/usr/bin/env node
/**
 * 大模型评分同步 —— Artificial Analysis
 *
 * 数据源：https://artificialanalysis.ai/leaderboards/models
 *   AA 是业界引用最多的独立模型评测站，其 Intelligence Index 由 GPQA、Terminal-Bench、
 *   τ²-bench、IFBench、HLE、CritPt、Omniscience 等评测加权而成（当前 v4.3.2）。
 *   页面是 Next.js，完整数据以 flight 数据（self.__next_f.push）内嵌在 HTML 里，
 *   不需要浏览器，解析后即为结构化 JSON——比爬表格稳。
 *
 * 去重口径：
 *   同一模型常有多个推理档位（Max / Xhigh / High…），AA 把它们当成独立条目。
 *   这里按「去掉括号后缀的名字」聚合，保留 Intelligence Index 最高的一档，
 *   并在 variant 字段记录档位，避免榜单被同款模型刷屏。
 *
 * 带分条目数会跳变，这是上游常态，不是抓取失败：
 *   2026-10-29 实测：页面共 273 条，只有 77 条带 intelligenceIndex，去重后 38 条
 *   （上一版是 190 条）。原因是 AA 换了评测套件——带总分的条目都跑齐了
 *   terminalbench-4-0 / scicode / automationbench-aa / frontiercode-2-0 / critpt-v2-hard，
 *   而没有总分的 196 条在这些新评测上缺失 67%~100%，即停留在旧套件、尚未回填。
 *   已用无头浏览器渲染页面核对：页面上确实是 77 行有分数、196 行显示 `--`，
 *   与 HTML 里的 flight 数据一致，说明脚本解析无误。
 *   所以数量下跌只告警不拦（见 main() 里的熔断注释）。
 *
 * 跑法：node scripts/fetch-model-scores.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_PATH = resolve(ROOT, 'src/data/model-scores.json')
const SOURCE_URL = 'https://artificialanalysis.ai/leaderboards/models'
const DRY_RUN = process.argv.includes('--dry-run')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

function log(m) {
  console.log(m)
}

/** 从 Next.js flight 数据里取出 initialModels 数组 */
function extractModels(html) {
  const chunks = [...html.matchAll(/<script>self\.__next_f\.push\(\[1,("[\s\S]*?")\]\)<\/script>/g)]
  let text = ''
  for (const c of chunks) {
    try {
      text += JSON.parse(c[1])
    } catch {
      /* 跳过坏 chunk */
    }
  }
  const at = text.indexOf('"initialModels":[')
  if (at < 0) throw new Error('未找到 initialModels（页面结构可能已变）')
  const start = text.indexOf('[', at)
  let depth = 0
  let end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++
    else if (text[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('initialModels 数组未闭合')
  return JSON.parse(text.slice(start, end + 1))
}

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 10 : null)

/** 名称去掉括号档位后缀（同名多档取最高分） */
const baseName = (n) => n.replace(/\s*\([^)]*\)\s*$/, '').trim()

function normalize(models) {
  const best = new Map()
  for (const m of models) {
    if (typeof m.intelligenceIndex !== 'number') continue
    const key = baseName(m.name)
    const variantMatch = m.name.match(/\(([^)]*)\)\s*$/)
    const row = {
      slug: m.slug,
      name: key,
      variant: variantMatch ? variantMatch[1] : null,
      creator: m.modelCreatorName ?? 'Unknown',
      score: round1(m.intelligenceIndex),
      estimated: !!m.intelligenceIndexIsEstimated,
      coding: pct(m.scores?.['terminalbench-4-0']),
      frontierCode: pct(m.scores?.['frontiercode']),
      multimodal: pct(m.scores?.['mmmu-pro']),
      automation: pct(m.scores?.['automationbench-aa']),
      science: pct(m.scores?.['critpt']),
      costPerTask: typeof m.intelligenceIndexCostPerTask === 'number' ? Math.round(m.intelligenceIndexCostPerTask * 1000) / 1000 : null,
      speed: round1(m.medianOutputTokensPerSecond),
      ttft: round1(m.medianTimeToFirstTokenSeconds),
      priceIn: m.price1mInputTokens ?? null,
      priceOut: m.price1mOutputTokens ?? null,
      context: m.contextWindowTokens ?? null,
      openWeights: !!m.isOpenWeights,
      reasoning: !!m.isReasoning,
    }
    const prev = best.get(key)
    if (!prev || row.score > prev.score) best.set(key, row)
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((r, i) => ({ rank: i + 1, ...r }))
}

async function main() {
  log(`\n=== 大模型评分同步 ${new Date().toISOString()} ===`)
  let prev = null
  if (existsSync(OUT_PATH)) {
    try {
      prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    } catch {
      prev = null
    }
  }

  log('[1/2] 抓取 Artificial Analysis')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45000)
  let html
  try {
    const r = await fetch(SOURCE_URL, { headers: { 'user-agent': UA }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    html = await r.text()
  } finally {
    clearTimeout(timer)
  }
  log(`  页面 ${(html.length / 1024).toFixed(0)} KB`)

  log('[2/2] 解析并去重')
  const raw = extractModels(html)
  const rows = normalize(raw)
  const scored = raw.filter((m) => typeof m.intelligenceIndex === 'number').length
  log(
    `  原始 ${raw.length} 条 → 带 Intelligence Index ${scored} 条 → 去重后 ${rows.length} 条` +
      `（覆盖 ${Math.round((scored / raw.length) * 100)}%）`
  )

  /*
   * 熔断：只拦「评分体系整体消失」这一种真异常。
   *
   * 2026-10-29 踩过的坑：AA 升级 Intelligence Index 评测套件后，
   * 带总分的条目从 190 掉到 38（-80%），旧判据（比上一版跌超 20% 就 abort）
   * 把它当成异常拒写盘，于是 model-scores.json 一直停在旧套件时代的快照，
   * 和线上榜单对不上——这比写盘危险得多，读者看到的是早已过期的分数。
   *
   * 覆盖波动本来就是上游常态：换套件、分批回填、模型下架都会让数量跳变。
   * 所以改成：跌了就大声告警，但照常写盘；真要拦，只拦「一个都没有」。
   */
  const MIN_SCORED = 10
  if (rows.length < MIN_SCORED) {
    console.error(
      `❌ 仅 ${rows.length} 个模型带 Intelligence Index（下限 ${MIN_SCORED}），` +
        '判定为上游异常（页面改版或抓取失败），放弃写盘'
    )
    process.exit(1)
  }
  const prevCount = prev?.models?.length ?? 0
  if (prevCount > 0 && rows.length < prevCount * 0.8) {
    const drop = Math.round((1 - rows.length / prevCount) * 100)
    log(
      `  ⚠️ 评分覆盖从 ${prevCount} 条降到 ${rows.length} 条（-${drop}%）：` +
        '通常是 AA 换了评测套件或分批回填，已照常写盘，请核对最新榜单'
    )
  }

  const payload = {
    meta: {
      lastUpdated: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      source: 'Artificial Analysis',
      sourceUrl: SOURCE_URL,
      indexName: 'Artificial Analysis Intelligence Index',
      indexVersion: 'v4.3.2',
      count: rows.length,
      methodology:
        'Intelligence Index v4.3.2 由 Terminal-Bench 4.0、SciCode、FrontierCode、MMMU-Pro、AutomationBench、' +
        'CritPt、Humanity’s Last Exam、Omniscience、长上下文推理等独立评测加权得出（0–100）。' +
        '同一模型的不同推理档位只保留得分最高的一档。' +
        '分项列为单项原始通过率，未经二次加权。',
      disclaimer:
        '评分为第三方独立评测结果（Artificial Analysis），非本站自评；厂商自报成绩与第三方复测可能不同，' +
        '价格与速度为测试时点数据，商用决策请以官方定价页与最新榜单为准。',
    },
    models: rows,
  }

  if (DRY_RUN) {
    log('--dry-run：未写盘')
    return
  }
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  log(`已写入 ${OUT_PATH}（${rows.length} 条）`)
  log(`  Top 3: ${rows.slice(0, 3).map((r) => `${r.name} ${r.score}`).join(' / ')}`)
}

main().catch((e) => {
  console.error('❌ 未捕获异常：', e)
  process.exit(1)
})
