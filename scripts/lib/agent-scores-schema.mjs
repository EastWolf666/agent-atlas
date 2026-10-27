/**
 * Agent 评分数据 schema 校验
 *
 * 评分页是「外部榜单镜像」，风险与模型页类似：
 * 上游改版/字段错位不会让页面崩，只会静默显示错误分数——比崩溃更糟。
 * 因此重点校验数值范围、必填字段与 id 唯一性，不做主观判断。
 *
 * 用法：node scripts/lib/agent-scores-schema.mjs --check src/data/agent-scores.json
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function validateAgentScores(payload) {
  const issues = []
  if (!payload || typeof payload !== 'object') {
    return { ok: false, issues: ['根节点必须是对象'], total: 0 }
  }
  const { meta, commercial, openSource } = payload
  if (!meta || typeof meta.lastUpdated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.lastUpdated)) {
    issues.push('meta.lastUpdated 缺失或不是 YYYY-MM-DD')
  }
  if (!Array.isArray(meta?.sources) || meta.sources.length === 0) {
    issues.push('meta.sources 必须是非空数组')
  }
  if (typeof meta?.disclaimer !== 'string' || !meta.disclaimer.trim()) {
    issues.push('meta.disclaimer 缺失')
  }
  if (!Array.isArray(commercial)) issues.push('commercial 必须是数组')
  if (!Array.isArray(openSource)) issues.push('openSource 必须是数组')

  const checkScore = (v, at) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) issues.push(`${at}.score 必须是数字`)
    else if (v < 0 || v > 100) issues.push(`${at}.score=${v} 超出 0–100`)
  }

  if (Array.isArray(commercial)) {
    const seen = new Set()
    commercial.forEach((r, i) => {
      const at = `commercial[${i}]`
      if (!r || typeof r.name !== 'string' || !r.name.trim()) issues.push(`${at}.name 缺失`)
      if (seen.has(r?.name)) issues.push(`${at}.name "${r.name}" 重复`)
      seen.add(r?.name)
      checkScore(r?.score, at)
      if (r?.reliability != null) {
        const v = r.reliability
        if (typeof v !== 'number' || !Number.isFinite(v)) issues.push(`${at}.reliability 必须是数字`)
        else if (v < 0 || v > 100) issues.push(`${at}.reliability=${v} 超出 0–100`)
      }
      if (r?.url && !/^https?:\/\//.test(r.url)) issues.push(`${at}.url 必须是 http(s)`)
    })
  }

  if (Array.isArray(openSource)) {
    const seen = new Set()
    openSource.forEach((r, i) => {
      const at = `openSource[${i}]`
      if (!r || typeof r.name !== 'string' || !r.name.trim()) issues.push(`${at}.name 缺失`)
      if (!r || typeof r.slug !== 'string' || !r.slug.trim()) issues.push(`${at}.slug 缺失`)
      if (seen.has(r?.slug)) issues.push(`${at}.slug "${r.slug}" 重复`)
      seen.add(r?.slug)
      checkScore(r?.score, at)
      if (typeof r?.category !== 'string' || !r.category.trim()) issues.push(`${at}.category 缺失`)
      if (typeof r?.rank !== 'number') issues.push(`${at}.rank 必须是数字`)
      if (r?.url && !/^https?:\/\//.test(r.url)) issues.push(`${at}.url 必须是 http(s)`)
    })
  }

  return { ok: issues.length === 0, issues, total: (commercial?.length || 0) + (openSource?.length || 0) }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--check')
  const target = i >= 0 ? args[i + 1] : args[0]
  if (!target) {
    console.error('用法: node scripts/lib/agent-scores-schema.mjs --check src/data/agent-scores.json')
    process.exit(1)
  }
  const payload = JSON.parse(readFileSync(resolve(process.cwd(), target), 'utf8'))
  const r = validateAgentScores(payload)
  if (r.ok) {
    console.log(`✅ Agent 评分 schema 校验通过：${r.total} 条`)
    process.exit(0)
  }
  console.error(`❌ 校验失败 ${r.issues.length} 处`)
  r.issues.slice(0, 20).forEach((x) => console.error('  - ' + x))
  process.exit(1)
}
