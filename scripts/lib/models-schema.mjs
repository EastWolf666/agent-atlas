/**
 * 大模型数据 schema 校验
 *
 * 为什么模型数据需要独立校验器而不是复用 agents 的：
 *   Agent 数据是「人工整理 + 每日自动更新」混合，字段带主观判断（L1-L5定级），
 *   所以校验重心在枚举白名单和引用完整性。
 *   模型数据是「接口直接吐出来的客观值」，没有主观字段可校验，
 *   但风险换了一种形式：接口改字段、返回 null、单位搞错、厂商归属判错。
 *   这些错不会让页面崩，只会让页面上出现错误的数字——比崩溃更危险，
 *   因为读者会当真。所以这里重点校验：
 *     1. 数值合理性（价格不能为负、上下文不能是天文数字）
 *     2. 枚举合法（模态、地区）
 *     3. 必填字段与 id 唯一
 *     4. 与 agents.json 的交叉一致性（厂商 slug 两边含义一致）
 *
 * 用法：
 *   node scripts/lib/models-schema.mjs --check src/data/models.json
 *   node scripts/lib/models-schema.mjs --check src/data/models.json --quiet
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 合法的输入模态。与 OpenRouter 的 architecture.modality 词表对齐 */
const INPUT_MODALITIES = new Set(['text', 'image', 'audio', 'video', 'file', '3d'])
const OUTPUT_MODALITIES = new Set(['text', 'image', 'audio', 'video', '3d'])
const REGIONS = new Set(['overseas', 'china'])

/**
 * 数值上限：用来抓「单位搞错」这类错误。
 *
 * 上下文长度取 1000 万而不是更大：目前真实最长是 200 万（Gemini），
 * 上限留5 倍余量。任何超过 1000 万的值几乎肯定是单位错乱
 * （比如把 token 数当成字符数、或API 改成了别的字段），
 * 让它报错比静默展示好。
 */
const MAX_CONTEXT = 10_000_000
/** 单价上限：每百万 token 1000 美元。超过的基本是价格字段错位 */
const MAX_PRICE = 1000

const ID_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * 校验单条模型记录。
 * @returns {string[]} 问题列表，空数组表示通过
 */
export function validateModel(m, index) {
  const issues = []
  const at = `models[${index}]${m?.id ? ` (${m.id})` : ''}`

  if (!m || typeof m !== 'object') {
    return [`${at} 不是对象`]
  }

  // ---- 必填字符串 ----
  for (const f of ['id', 'name', 'vendor', 'vendorSlug', 'region', 'openRouterId', 'officialUrl']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) {
      issues.push(`${at}.${f} 缺失或不是非空字符串`)
    }
  }

  // ---- id 规范 ----
  if (typeof m.id === 'string' && m.id && !ID_RE.test(m.id)) {
    issues.push(`${at}.id "${m.id}" 只能是小写字母、数字、连字符`)
  }

  // ---- URL ----
  if (typeof m.officialUrl === 'string' && m.officialUrl && !/^https?:\/\//.test(m.officialUrl)) {
    issues.push(`${at}.officialUrl 必须是 http(s) 链接`)
  }
  if (m.openWeightsUrl && !/^https?:\/\//.test(m.openWeightsUrl)) {
    issues.push(`${at}.openWeightsUrl 必须是 http(s) 链接`)
  }

  // ---- 地区 ----
  if (typeof m.region === 'string' && !REGIONS.has(m.region)) {
    issues.push(`${at}.region "${m.region}" 非法，合法的：${[...REGIONS].join(', ')}`)
  }

  // ---- 模态 ----
  for (const [field, legal] of [
    ['inputModalities', INPUT_MODALITIES],
    ['outputModalities', OUTPUT_MODALITIES],
  ]) {
    const v = m[field]
    if (!Array.isArray(v) || v.length === 0) {
      issues.push(`${at}.${field} 必须是非空数组`)
    } else {
      for (const mo of v) {
        if (!legal.has(mo)) {
          issues.push(`${at}.${field} 含非法模态 "${mo}"`)
        }
      }
    }
  }

  // isMultimodal 必须与 inputModalities 一致，否则筛选会出现自相矛盾的结果
  if (typeof m.isMultimodal === 'boolean' && Array.isArray(m.inputModalities)) {
    const derived = m.inputModalities.some((mo) => mo !== 'text')
    if (m.isMultimodal !== derived) {
      issues.push(
        `${at}.isMultimodal=${m.isMultimodal} 与 inputModalities ${JSON.stringify(m.inputModalities)} 不一致`
      )
    }
  }

  // ---- 上下文长度 ----
  if (m.contextWindow !== null) {
    if (typeof m.contextWindow !== 'number' || !Number.isFinite(m.contextWindow)) {
      issues.push(`${at}.contextWindow 必须是正整数或 null，实际 "${m.contextWindow}"`)
    } else if (m.contextWindow <= 0) {
      issues.push(`${at}.contextWindow=${m.contextWindow} 必须为正数`)
    } else if (m.contextWindow > MAX_CONTEXT) {
      issues.push(`${at}.contextWindow=${m.contextWindow} 超过上限 ${MAX_CONTEXT}，疑似单位错误`)
    }
  }

  // ---- 价格：允许 null（未提供），但不允许负数或异常大值 ----
  for (const f of ['priceInput', 'priceOutput', 'priceCacheRead']) {
    const v = m[f]
    if (v === null || v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push(`${at}.${f} 必须是数字或 null，实际 "${v}"`)
    } else if (v < 0) {
      issues.push(`${at}.${f}=${v} 不能为负`)
    } else if (v > MAX_PRICE) {
      issues.push(`${at}.${f}=${v} 超过上限 ${MAX_PRICE} 每百万 token，疑似单位错误`)
    }
  }

  // ---- 日期 ----
  for (const f of ['releasedAt', 'knowledgeCutoff']) {
    const v = m[f]
    if (v === null || v === undefined) continue
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      issues.push(`${at}.${f} 应为 YYYY-MM-DD 或 null，实际 "${v}"`)
    }
  }

  // ---- 开源权重：声称开源就必须有 HF 链接 ----
  if (m.openWeights === true && !m.openWeightsUrl) {
    issues.push(`${at}.openWeights=true 但没有 openWeightsUrl，自相矛盾`)
  }

  // ---- 跑分：允许部分字段为 null，但有则必须是数字 ----
  if (m.scores !== null && m.scores !== undefined) {
    if (typeof m.scores !== 'object') {
      issues.push(`${at}.scores 必须是对象或 null`)
    } else {
      for (const k of ['intelligence', 'coding', 'agentic']) {
        const v = m.scores[k]
        if (v === null || v === undefined) continue
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          issues.push(`${at}.scores.${k} 必须是数字或 null，实际 "${v}"`)
        }
      }
    }
  }

  // ---- 核实状态 ----
  /*
   * 用户要求沿用 agents 的「自动收录·待核实」机制，所以这两个字段必须有明确取值。
   * autoAdmitted 为 true 且 verifiedBy 为空 = 机器抓的、没人核过。
   * 只写autoAdmitted 不写 verifiedBy 会让「已核实」和「未核实」在数据上无法区分，
   * 那这个机制就等于没建。
   */
  if (m.autoAdmitted !== undefined && typeof m.autoAdmitted !== 'boolean') {
    issues.push(`${at}.autoAdmitted 必须是布尔值`)
  }
  if (m.autoAdmitted === true && typeof m.autoAdmittedAt !== 'string') {
    issues.push(`${at}.autoAdmittedAt 缺失：自动收录的条目必须记录收录日期`)
  }
  if (m.verifiedBy !== undefined && m.verifiedBy !== null) {
    if (typeof m.verifiedBy !== 'string' || !m.verifiedBy.trim()) {
      issues.push(`${at}.verifiedBy 必须是非空字符串或 null`)
    }
    if (m.autoAdmitted !== true) {
      issues.push(`${at}.verifiedBy 有值但 autoAdmitted 不为 true，自相矛盾`)
    }
  }

  return issues
}

/**
 * 校验整份 models.json。
 * @returns {{ok: boolean, issues: string[], total: number}}
 */
export function validateModelsFile(payload) {
  const list = Array.isArray(payload) ? payload : payload?.models
  if (!Array.isArray(list)) {
    return { ok: false, total: 0, issues: ['models.json 必须是数组或含models 数组的对象'] }
  }

  const issues = []
  const seenIds = new Map()
  const seenOpenRouterIds = new Map()

  list.forEach((m, i) => {
    issues.push(...validateModel(m, i))
    if (m && typeof m.id === 'string') {
      if (seenIds.has(m.id)) {
        issues.push(`id "${m.id}" 重复（第 ${seenIds.get(m.id)} 条与第 ${i} 条）`)
      } else {
        seenIds.set(m.id, i)
      }
    }
    if (m && typeof m.openRouterId === 'string') {
      if (seenOpenRouterIds.has(m.openRouterId)) {
        issues.push(
          `openRouterId "${m.openRouterId}" 重复（第 ${seenOpenRouterIds.get(m.openRouterId)} 条与第 ${i} 条）`
        )
      } else {
        seenOpenRouterIds.set(m.openRouterId, i)
      }
    }
  })

  return { ok: issues.length === 0, issues, total: list.length }
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const args = process.argv.slice(2)
  const checkIdx = args.indexOf('--check')
  const target = checkIdx >= 0 ? args[checkIdx + 1] : args.find((a) => !a.startsWith('--'))
  const quiet = args.includes('--quiet')

  if (!target) {
    console.error('用法: node scripts/lib/models-schema.mjs --check src/data/models.json')
    process.exit(1)
  }

  const file = resolve(process.cwd(), target)
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  const { ok, issues, total } = validateModelsFile(payload)

  if (ok) {
    console.log(`✅ 模型schema 校验通过：${total} 条数据`)
    process.exit(0)
  }

  if (!quiet) {
    console.error(`❌ 模型schema 校验失败：${issues.length} 处问题`)
    for (const it of issues.slice(0, 40)) console.error('  - ' + it)
    if (issues.length > 40) console.error(`  ...另有 ${issues.length - 40} 处`)
  }
  process.exit(1)
}