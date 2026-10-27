/**
 * 大模型评分数据 schema 校验
 *
 * 评分来自第三方（Artificial Analysis），字段错位不会让页面崩，
 * 只会静默展示错误分数——比崩溃更危险。重点校验 0–100 范围、必填字段与排名唯一。
 *
 * 用法：node scripts/lib/model-scores-schema.mjs --check src/data/model-scores.json
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function validateModelScores(payload) {
  const issues = []
  if (!payload || typeof payload !== 'object') return { ok: false, issues: ['根节点必须是对象'], total: 0 }

  const { meta, models } = payload
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(meta.lastUpdated ?? '')) {
    issues.push('meta.lastUpdated 缺失或格式错误')
  }
  for (const f of ['source', 'sourceUrl', 'indexName', 'indexVersion', 'methodology', 'disclaimer']) {
    if (typeof meta?.[f] !== 'string' || !meta[f].trim()) issues.push(`meta.${f} 缺失`)
  }
  if (!Array.isArray(models)) {
    issues.push('models 必须是数组')
    return { ok: false, issues, total: 0 }
  }

  const seen = new Set()
  const ranks = new Set()
  models.forEach((m, i) => {
    const at = `models[${i}]${m?.name ? ` (${m.name})` : ''}`
    if (!m || typeof m.name !== 'string' || !m.name.trim()) issues.push(`${at}.name 缺失`)
    if (!m || typeof m.slug !== 'string' || !m.slug.trim()) issues.push(`${at}.slug 缺失`)
    if (seen.has(m?.slug)) issues.push(`${at}.slug "${m.slug}" 重复`)
    seen.add(m?.slug)
    if (ranks.has(m?.rank)) issues.push(`${at}.rank "${m.rank}" 重复`)
    ranks.add(m?.rank)
    if (typeof m?.score !== 'number' || m.score < 0 || m.score > 100) {
      issues.push(`${at}.score 必须是 0–100 的数字`)
    }
    for (const f of ['coding', 'frontierCode', 'multimodal', 'automation', 'science']) {
      const v = m?.[f]
      if (v == null) continue
      if (typeof v !== 'number' || v < 0 || v > 100) issues.push(`${at}.${f}=${v} 超出 0–100`)
    }
    for (const f of ['costPerTask', 'speed', 'ttft', 'priceIn', 'priceOut', 'context']) {
      const v = m?.[f]
      if (v == null) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) issues.push(`${at}.${f}=${v} 必须是非负数`)
    }
  })

  return { ok: issues.length === 0, issues, total: models.length }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--check')
  const target = i >= 0 ? args[i + 1] : args[0]
  if (!target) {
    console.error('用法: node scripts/lib/model-scores-schema.mjs --check src/data/model-scores.json')
    process.exit(1)
  }
  const payload = JSON.parse(readFileSync(resolve(process.cwd(), target), 'utf8'))
  const r = validateModelScores(payload)
  if (r.ok) {
    console.log(`✅ 大模型评分 schema 校验通过：${r.total} 条`)
    process.exit(0)
  }
  console.error(`❌ 校验失败 ${r.issues.length} 处`)
  r.issues.slice(0, 20).forEach((x) => console.error('  - ' + x))
  process.exit(1)
}
