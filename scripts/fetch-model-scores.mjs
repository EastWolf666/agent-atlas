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
  log(`  原始 ${raw.length} 条 → 去重后 ${rows.length} 条`)

  /* 熔断：AA 从未少于 100 个模型；明显缩水说明页面改版 */
  if (rows.length < 50) {
    console.error(`❌ 仅解析到 ${rows.length} 条，判定上游异常，放弃写盘`)
    process.exit(1)
  }
  if (prev?.models?.length > 100 && rows.length < prev.models.length * 0.6) {
    console.error(`❌ 从 ${prev.models.length} 跌到 ${rows.length}，放弃写盘`)
    process.exit(1)
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
