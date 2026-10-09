/**
 * AI 国产替代数据 schema 校验
 *
 * 与 agents / models 不同，alternatives.json 是人工维护的静态数据，
 * 风险不在于「接口字段漂移」，而在于：
 *   1. 手滑写错 id、漏写必填字段
 *   2. 国产条目忘了填 replaces，导致替代关系断了
 *   3. 海外工具没被任何国产条目引用，信息图里的配对漏录
 *   4. meta.total 与实际条数不一致
 *
 * 用法：
 *   node scripts/lib/alternatives-schema.mjs --check src/data/alternatives.json
 *   node scripts/lib/alternatives-schema.mjs --check src/data/alternatives.json --quiet
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REGIONS = new Set(['overseas', 'china'])
const CATEGORIES = new Set([
  'chat',
  'image',
  'video',
  'music',
  'office',
  'coding',
  'design',
  'learning',
  'search',
  'translate',
  'speech',
  'avatar',
  'meeting',
])
const PLATFORMS = new Set(['web', 'ios', 'android', 'windows', 'macos', 'linux', 'api'])
const PRICING = new Set(['free', 'freemium', 'subscription', 'usage', 'enterprise'])

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/

/**
 * 校验单条工具记录。
 * @returns {string[]} 问题列表，空数组表示通过
 */
export function validateAlternative(item, index) {
  const issues = []
  const at = `items[${index}]${item?.id ? ` (${item.id})` : ''}`

  if (!item || typeof item !== 'object') {
    return [`${at} 不是对象`]
  }

  // ---- 必填字符串 ----
  for (const f of [
    'id',
    'name',
    'vendor',
    'region',
    'category',
    'tagline',
    'description',
    'officialUrl',
    'pricingModel',
    'pricingNote',
    'lastVerified',
  ]) {
    if (typeof item[f] !== 'string' || !item[f].trim()) {
      issues.push(`${at}.${f} 缺失或不是非空字符串`)
    }
  }

  // ---- id 规范 ----
  if (typeof item.id === 'string' && item.id && !ID_RE.test(item.id)) {
    issues.push(`${at}.id "${item.id}" 只能是小写字母、数字、连字符`)
  }

  // ---- URL ----
  if (typeof item.officialUrl === 'string' && item.officialUrl && !/^https?:\/\//.test(item.officialUrl)) {
    issues.push(`${at}.officialUrl 必须是 http(s) 链接`)
  }

  // ---- 地区 ----
  if (typeof item.region === 'string' && !REGIONS.has(item.region)) {
    issues.push(`${at}.region "${item.region}" 非法，合法的：${[...REGIONS].join(', ')}`)
  }

  // ---- 场景 ----
  if (typeof item.category === 'string' && !CATEGORIES.has(item.category)) {
    issues.push(`${at}.category "${item.category}" 非法，合法的：${[...CATEGORIES].join(', ')}`)
  }

  // ---- 定价模式 ----
  if (typeof item.pricingModel === 'string' && !PRICING.has(item.pricingModel)) {
    issues.push(`${at}.pricingModel "${item.pricingModel}" 非法，合法的：${[...PRICING].join(', ')}`)
  }

  // ---- 日期 ----
  if (typeof item.lastVerified === 'string' && item.lastVerified && !DATE_RE.test(item.lastVerified)) {
    issues.push(`${at}.lastVerified 应为 YYYY-MM 或 YYYY-MM-DD，实际 "${item.lastVerified}"`)
  }

  // ---- 平台数组 ----
  if (!Array.isArray(item.platforms) || item.platforms.length === 0) {
    issues.push(`${at}.platforms 必须是非空数组`)
  } else {
    for (const p of item.platforms) {
      if (!PLATFORMS.has(p)) {
        issues.push(`${at}.platforms 含非法平台 "${p}"`)
      }
    }
  }

  // ---- 卖点数组 ----
  if (!Array.isArray(item.highlights) || item.highlights.length === 0) {
    issues.push(`${at}.highlights 必须是非空数组`)
  } else {
    for (const h of item.highlights) {
      if (typeof h !== 'string' || !h.trim()) {
        issues.push(`${at}.highlights 含空字符串`)
      }
    }
  }

  // ---- 替代关系 ----
  if (!Array.isArray(item.replaces)) {
    issues.push(`${at}.replaces 必须是数组`)
  } else {
    // 海外工具不应有 replaces（它不是替代别人，而是被替代）
    if (item.region === 'overseas' && item.replaces.length > 0) {
      issues.push(`${at}.replaces 应为空数组（海外工具是被替代方）`)
    }
    // 国产工具必须至少替代一个海外工具，否则「替代」语义不成立
    if (item.region === 'china' && item.replaces.length === 0) {
      issues.push(`${at}.replaces 不能为空（国产工具必须指明替代对象）`)
    }
    for (const rid of item.replaces) {
      if (typeof rid !== 'string' || !ID_RE.test(rid)) {
        issues.push(`${at}.replaces 含非法 id "${rid}"`)
      }
    }
  }

  return issues
}

/**
 * 校验整份 alternatives.json。
 * @returns {{ok: boolean, issues: string[], total: number}}
 */
export function validateAlternativesFile(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    return { ok: false, total: 0, issues: ['alternatives.json 必须是含 items 数组的对象'] }
  }

  const items = payload.items
  const issues = []
  const seenIds = new Map()
  const overseasIds = new Set()
  const replacedBy = new Map() // overseas id -> 国产条目 index 列表

  items.forEach((item, i) => {
    issues.push(...validateAlternative(item, i))

    if (item && typeof item.id === 'string') {
      if (seenIds.has(item.id)) {
        issues.push(`id "${item.id}" 重复（第 ${seenIds.get(item.id)} 条与第 ${i} 条）`)
      } else {
        seenIds.set(item.id, i)
      }

      if (item.region === 'overseas') {
        overseasIds.add(item.id)
      }

      if (Array.isArray(item.replaces) && item.region === 'china') {
        for (const rid of item.replaces) {
          const list = replacedBy.get(rid) || []
          list.push(i)
          replacedBy.set(rid, list)
        }
      }
    }
  })

  // 国产条目的 replaces 必须指向真实存在的海外 id
  for (const [rid, indexes] of replacedBy.entries()) {
    if (!overseasIds.has(rid)) {
      for (const idx of indexes) {
        issues.push(`items[${idx}] (${items[idx]?.id}).replaces 指向不存在的海外 id "${rid}"`)
      }
    }
  }

  // 每个海外 id 至少被一个国产条目引用（保证配对完整）
  for (const oid of overseasIds) {
    if (!replacedBy.has(oid)) {
      issues.push(`海外工具 "${oid}" 未被任何国产条目引用，请检查是否漏录配对`)
    }
  }

  // meta.total 一致性
  if (payload.meta && typeof payload.meta.total === 'number' && payload.meta.total !== items.length) {
    issues.push(`meta.total=${payload.meta.total} 与实际条数 ${items.length} 不一致`)
  }

  return { ok: issues.length === 0, issues, total: items.length }
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const args = process.argv.slice(2)
  const checkIdx = args.indexOf('--check')
  const target = checkIdx >= 0 ? args[checkIdx + 1] : args.find((a) => !a.startsWith('--'))
  const quiet = args.includes('--quiet')

  if (!target) {
    console.error('用法: node scripts/lib/alternatives-schema.mjs --check src/data/alternatives.json')
    process.exit(1)
  }

  const file = resolve(process.cwd(), target)
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  const { ok, issues, total } = validateAlternativesFile(payload)

  if (ok) {
    console.log(`✅ 国产替代 schema 校验通过：${total} 条数据`)
    process.exit(0)
  }

  if (!quiet) {
    console.error(`❌ 国产替代 schema 校验失败：${issues.length} 处问题`)
    for (const it of issues.slice(0, 40)) console.error('  - ' + it)
    if (issues.length > 40) console.error(`  ...另有 ${issues.length - 40} 处`)
  }
  process.exit(1)
}
