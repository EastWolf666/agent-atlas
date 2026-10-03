/**
 * 数据 schema 校验器
 *
 * 为什么需要这个：src/data/agents.json 是手工维护 + 每日自动更新混合的数据源，
 * 而 src/lib/agents.ts 用的是 `as Agent[]` 类型断言——JSON 里写错枚举值不会报错，
 * 只会在运行时炸。最严重的场景是 FilterPanel 渲染 `meta.tiers[t].label` 时
 * t 是非法值，直接抛 TypeError 白屏。
 *
 * 所以这里做三道关，失败即中止，绝不放行：
 *   1. 枚举白名单（从 meta.json 动态取真值，不硬编码）
 *   2. 必填 + 类型 + 取值边界
 *   3. 引用完整性（id 唯一、slug 化、relatedIds 指向存在）
 *
 * 零第三方依赖：workflow 里 node scripts/lib/schema.mjs 直接跑，不引入 zod/ajv。
 *
 * 用法：
 *   node scripts/lib/schema.mjs --check src/data/agents.json
 *   node scripts/lib/schema.mjs --check src/data/agents.json --quiet
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 枚举字段 -> 在 meta.json 里的字典路径 */
/**
 * 标量枚举字段 -> 在 meta.json 里的字典路径
 * 注意 deployment 是数组（见 ENUM_ARRAY_FIELDS），不在这张表里。
 */
const ENUM_DICTS = {
  region: 'regions',
  tier: 'tiers',
  status: 'statuses',
  pricingModel: 'pricingModels',
  dataConfidence: 'dataConfidence',
}

/** 必填字符串字段 */
const STRING_FIELDS = [
  'id', 'name', 'vendor', 'tagline', 'description',
  'bestFor', 'pricingNote', 'contextWindow', 'officialUrl', 'lastVerified',
]

/** 必填非空数组字段（数组可为空字符串元素，但本身不能是空数组） */
const ARRAY_FIELDS = ['highlights', 'limitations', 'modalities', 'deployment', 'sources']

/** 枚举数组字段（取���内的每个值都必须在白名单里） */
const ENUM_ARRAY_FIELDS = {
  modalities: 'modalities',
  deployment: 'deployments',
}

const INTEGER_RANGES = {
  autonomyLevel: [1, 5],
  prominence: [1, 10],
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

class Issues {
  constructor() {
    this.list = []
  }
  add(where, msg) {
    this.list.push({ where, msg })
  }
  get count() {
    return this.list.length
  }
}

/** 从 meta.json 的字典里动态取出某个枚举字段的合法值集合 */
function enumValues(metaDict, dictKey) {
  const d = metaDict[dictKey]
  if (!d || typeof d !== 'object') {
    throw new Error(`meta.json 缺少字典 ${dictKey}，无法校验枚举`)
  }
  return new Set(Object.keys(d))
}

/**
 * region 的合法值不在 meta.json 里（meta 只有 tiers/statuses/... 没有 regions），
 * 所以单独处理。
 */
const REGION_VALUES = new Set(['overseas', 'china'])

function validateAgent(a, i, issues, seenIds, enumSets) {
  const at = a?.id ? `agents[${i}] (${a.id})` : `agents[${i}]`

  if (typeof a !== 'object' || a === null || Array.isArray(a)) {
    issues.add(at, '不是对象')
    return
  }

  // ---- 必填字符串 ----
  for (const f of STRING_FIELDS) {
    const v = a[f]
    if (typeof v !== 'string') {
      issues.add(at, `字段 ${f} 必须是字符串，实际 ${v === undefined ? '缺失' : typeof v}`)
    } else if (!v.trim()) {
      issues.add(at, `字段 ${f} 不能为空字符串`)
    }
  }

  // ---- id 规范 + 唯一性 ----
  if (typeof a.id === 'string') {
    if (!SLUG_RE.test(a.id)) {
      issues.add(at, `id "${a.id}" 不是合法 slug（只允许小写字母、数字、连字符）`)
    }
    if (seenIds.has(a.id)) {
      issues.add(at, `id "${a.id}" 重复`)
    }
    seenIds.add(a.id)
  }

  // ---- 枚举字段（白名单来自 meta.json，单一事实来源）----
  for (const [field, dictKey] of Object.entries(ENUM_DICTS)) {
    const allowed = field === 'region' ? REGION_VALUES : enumSets[dictKey]
    if (!allowed) continue
    const v = a[field]
    if (typeof v !== 'string') {
      issues.add(at, `字段 ${field} 必须是字符串`)
    } else if (!allowed.has(v)) {
      issues.add(
        at,
        `字段 ${field} 的值 "${v}" 不在 meta.json 的 ${dictKey} 白名单内。` +
          `这会导致 FilterPanel 取 label 时白屏——合法值：[${[...allowed].join(', ')}]`
      )
    }
  }

  // ---- 枚举数组字段 ----
  for (const [field, dictKey] of Object.entries(ENUM_ARRAY_FIELDS)) {
    const arr = a[field]
    if (!Array.isArray(arr)) continue
    const allowed = enumSets[dictKey]
    if (!allowed) continue
    for (const v of arr) {
      if (typeof v !== 'string' || !allowed.has(v)) {
        issues.add(at, `字段 ${field} 含非法值 "${v}"，不在 ${dictKey} 白名单内`)
      }
    }
  }

  // ---- 数组字段 ----
  for (const f of ARRAY_FIELDS) {
    const v = a[f]
    if (!Array.isArray(v)) {
      issues.add(at, `字段 ${f} 必须是数组`)
    } else if (v.length === 0) {
      issues.add(at, `字段 ${f} 不能是空数组`)
    }
  }

  // ---- 整数边界 ----
  for (const [f, [min, max]] of Object.entries(INTEGER_RANGES)) {
    const v = a[f]
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      issues.add(at, `字段 ${f} 必须是整数，实际 ${v === undefined ? '缺失' : typeof v}`)
    } else if (v < min || v > max) {
      issues.add(at, `字段 ${f} = ${v} 超出范围 [${min}, ${max}]`)
    }
  }

  // ---- 日期格式 ----
  // lastVerified 允许 YYYY-MM-DD 与 YYYY-MM 两种：当日精确核过写前者，
  // 按月核过写后者。两者都接受，不强行统一——强制统一只会逼着人编造精确日期。
  if (typeof a.lastVerified === 'string' && !DATE_RE.test(a.lastVerified) && !MONTH_RE.test(a.lastVerified)) {
    issues.add(at, `lastVerified "${a.lastVerified}" 应为 YYYY-MM-DD 或 YYYY-MM`)
  }

  // ---- 链接必须是 http(s) ----
  // officialUrl 是详情页「访问官网」的入口，写错等于给用户一个死链
  if (typeof a.officialUrl === 'string' && !/^https?:\/\/[^\s]+$/.test(a.officialUrl)) {
    issues.add(at, `officialUrl "${a.officialUrl}" 不是合法的 http(s) 链接`)
  }

  // 注：这里刻意不校验 openSource 与 pricingModel 的一致性。
  // 「代码开源但按托管服务收费」是真实存在的形态（mem0、sandbox-runtime 等
  // 开源 SDK 都属此类），把 openSource=true 强制绑到 open_source 会误报。
  // 两个字段表达的是不同维度：许可协议 vs 计费方式。

  // ---- sources 结构 ----
  if (Array.isArray(a.sources)) {
    a.sources.forEach((s, j) => {
      if (!s || typeof s !== 'object') {
        issues.add(at, `sources[${j}] 不是对象`)
        return
      }
      if (typeof s.title !== 'string' || !s.title.trim()) {
        issues.add(at, `sources[${j}].title 缺失`)
      }
      if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) {
        issues.add(at, `sources[${j}].url 必须是 http(s) 链接，实际 "${s.url}"`)
      }
      const types = new Set(['official', 'media', 'community', 'research'])
      if (!types.has(s.type)) {
        issues.add(at, `sources[${j}].type "${s.type}" 非法，合法值：[${[...types].join(', ')}]`)
      }
      if (typeof s.date !== 'string' || !MONTH_RE.test(s.date)) {
        issues.add(at, `sources[${j}].date "${s.date}" 应为 YYYY-MM`)
      }
    })
  }
}

/**
 * 校验 agents.json
 * @returns {{ok: boolean, count: number, issues: Array<{where:string,msg:string}>}}
 */
export function validateAgents(agentsJson, metaJson, { quiet = false } = {}) {
  const issues = new Issues()

  if (!Array.isArray(agentsJson)) {
    issues.add('root', 'agents.json 根节点必须是数组')
    return { ok: false, count: 0, issues: issues.list }
  }

  const metaDict = metaJson?.meta
  if (!metaDict) {
    issues.add('root', 'meta.json 缺少 meta 字段')
    return { ok: false, count: 0, issues: issues.list }
  }

  // 动态构建枚举白名单——meta.json 是单一事实来源。
  // 必须覆盖 ENUM_DICTS 与 ENUM_ARRAY_FIELDS 引用的全部字典，
  // 少建一个会让对应字段的校验静默失效（continue 掉）。
  const neededDicts = new Set([
    ...Object.values(ENUM_DICTS),
    ...Object.values(ENUM_ARRAY_FIELDS),
  ])
  const enumSets = {}
  for (const dictKey of neededDicts) {
    if (dictKey === 'regions') continue
    try {
      enumSets[dictKey] = enumValues(metaDict, dictKey)
    } catch (e) {
      issues.add('meta.json', e.message)
    }
  }

  const seenIds = new Set()
  agentsJson.forEach((a, i) => validateAgent(a, i, issues, seenIds, enumSets))

  // ---- 引用完整性：relatedIds 必须指向存在的 id ----
  for (const a of agentsJson) {
    if (!a || typeof a !== 'object') continue
    const rel = a.relatedIds
    if (rel === undefined) continue
    if (!Array.isArray(rel)) {
      issues.add(a.id ?? '?', 'relatedIds 必须是数组')
      continue
    }
    for (const r of rel) {
      if (!seenIds.has(r)) {
        issues.add(a.id, `relatedIds 指向不存在的 id "${r}"`)
      }
      if (r === a.id) {
        issues.add(a.id, 'relatedIds 不应包含自己')
      }
    }
  }

  // ---- meta.total 与实际条数一致性 ----
  // total 字段全站无代码读取，但留着是为了误导——这里做一致性检查，
  // 让人工/脚本更新它，避免忘了改。
  if (typeof metaDict.total === 'number' && metaDict.total !== agentsJson.length) {
    issues.add(
      'meta.json',
      `meta.total=${metaDict.total} 与 agents.json 实际 ${agentsJson.length} 条不一致。` +
        `meta.total 目前无代码读取，但会误导读者——请同步更新`
    )
  }

  return { ok: issues.count === 0, count: agentsJson.length, issues: issues.list }
}

/** 从 meta.json 的 insights 里找出所有硬编码了条数的文案，提示可能失真 */
export function findHardcodedCounts(metaJson) {
  const insights = metaJson?.meta?.insights ?? []
  const hits = []
  insights.forEach((ins, i) => {
    const text = ins?.text ?? ''
    const basis = ins?.basis ?? ''
    // 匹配「64 条」「8 个」「49 条」这类具体数字表述
    const m = String(text).match(/(\d+)\s*(条|个|家|款)/g)
    const b = String(basis).match(/(\d+)\s*(条|个|家|款)/g)
    if (m || b) {
      hits.push({ index: i, text: [...new Set([...(m ?? []), ...(b ?? [])])].join(' ') })
    }
  })
  return hits
}

// ---------------- CLI ----------------
function main() {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')
  const target = args.find((a) => a.endsWith('.json') && !a.startsWith('--'))
  if (!target) {
    console.error('用法: node scripts/lib/schema.mjs --check <agents.json 路径>')
    process.exit(2)
  }
  const agentsPath = resolve(process.cwd(), target)
  const metaPath = agentsPath.replace(/agents\.json$/, 'meta.json')

  let agentsJson, metaJson
  try {
    agentsJson = JSON.parse(readFileSync(agentsPath, 'utf8'))
    metaJson = JSON.parse(readFileSync(metaPath, 'utf8'))
  } catch (e) {
    console.error(`读取或解析 JSON 失败: ${e.message}`)
    process.exit(2)
  }

  const { ok, count, issues } = validateAgents(agentsJson, metaJson, { quiet })

  if (ok) {
    console.log(`✅ schema 校验通过：${count} 条数据`)
    const hard = findHardcodedCounts(metaJson)
    if (hard.length) {
      console.log(`⚠️  ${hard.length} 条洞察文案含硬编码数字，扩容后需复核：`)
      for (const h of hard) console.log(`    [${h.index}] ${h.text}`)
    }
    process.exit(0)
  }

  console.error(`❌ schema 校验失败：${count} 处问题`)
  const limit = quiet ? 10 : issues.length
  for (const it of issues.slice(0, limit)) {
    console.error(`  · ${it.where}: ${it.msg}`)
  }
  if (issues.length > limit) {
    console.error(`  …… 另有 ${issues.length - limit} 处`)
  }
  process.exit(1)
}

// 仅在直接执行时跑 CLI（被 import 时不跑）
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}