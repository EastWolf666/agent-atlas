#!/usr/bin/env node
/**
 * 大模型数据更新 —— 独立管线
 *
 * 跑法：npm run fetch:models
 *
 * 为什么单独一个脚本，而不是塞进 fetch.mjs 的 6 步里：
 *   两份数据的**性质完全不同**。
 *   - agents.json 是人工撰写 + 机器补全：机器只改客观字段，新条目要过入库门槛；
 *   - models.json 是纯 API 镜像：全量替换，没有「候选」概念，也没有「审核」概念。
 *   硬合并会导致 models 的失败把 agents 的成功一起拖垮（fetch.mjs 是fail-fast 的）。
 *   所以做成独立脚本，fetch.mjs 用 try/catch 调它，失败只记警告。
 *
 * 写盘前必经 models-schema 校验；不过就 abort，一个字节都不落。
 * 这点必须和 agents 一样：定时任务是无人值守的，
 * 上游字段一变就把脏数据写进线上，页面会静默显示错误价格——比不更新糟得多。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fetchModels } from './lib/sources/models.mjs'
import { validateModelsFile } from './lib/models-schema.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const MODELS_PATH = resolve(ROOT, 'src/data/models.json')
const VERIFIED_PATH = resolve(ROOT, 'data/models-verified.json')
const DRY_RUN = process.argv.includes('--dry-run')

function log(msg) {
  console.log(msg)
}

/**
 * 读人工核实台账。
 * @returns {{verified: Set<string>, verifyBy: Map<string,string>}}
 */
function loadVerifyLedger() {
  if (!existsSync(VERIFIED_PATH)) return { verified: new Set(), verifyBy: new Map() }
  try {
    const j = JSON.parse(readFileSync(VERIFIED_PATH, 'utf8'))
    const list = Array.isArray(j) ? j : (j.verified ?? [])
    const verifyBy = new Map()
    for (const v of list) {
      if (v?.id) verifyBy.set(v.id, v.verifiedBy ?? '人工核实')
    }
    return { verified: new Set(verifyBy.keys()), verifyBy }
  } catch (e) {
    // 台账坏了不能静默——那会导致所有核实标记被清空
    throw new Error(`data/models-verified.json 解析失败: ${e.message}`)
  }
}

/** 读上一版数据，用于差异比对和收录日期继承 */
function loadPrevModels() {
  try {
    const j = JSON.parse(readFileSync(MODELS_PATH, 'utf8'))
    return Array.isArray(j.models) ? j.models : []
  } catch {
    return []
  }
}

/**
 * 判断这次抓取相对上次有没有实质变化。
 *
 * 为什么需要：OpenRouter 每天都会新增/下架模型，如果只比lastUpdated，
 * 那么「今天的数据和昨天字节级一致」也会被当成变更，白白产生一个 commit。
 * 真正有意义的变化只有三种：模型集合变了、某个模型的客观字段变了、模型数量变了。
 */
function diffModels(prev, next) {
  if (!prev) return { added: next.length, removed: 0, changed: next.length, firstRun: true }

  const prevMap = new Map(prev.map((m) => [m.id, m]))
  const nextMap = new Map(next.map((m) => [m.id, m]))

  const added = []
  const removed = []
  const changed = []

  for (const [id, m] of nextMap) {
    if (!prevMap.has(id)) {
      added.push(id)
      continue
    }
    // 逐字段比对：只关心客观字段，description 这类文案抖动不该刷commit
    const a = prevMap.get(id)
    if (
      a.priceInput !== m.priceInput ||
      a.priceOutput !== m.priceOutput ||
      a.priceCacheRead !== m.priceCacheRead ||
      a.contextWindow !== m.contextWindow ||
      a.maxOutputTokens !== m.maxOutputTokens ||
      a.isMultimodal !== m.isMultimodal ||
      a.openWeights !== m.openWeights ||
      a.releasedAt !== m.releasedAt ||
      a.knowledgeCutoff !== m.knowledgeCutoff
    ) {
      changed.push(id)
    }
  }

  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removed.push(id)
  }

  return { added, removed, changed, firstRun: false }
}

/** 把差异翻译成人能读的结论，决定摘要里写什么 */
function describeDiff(d) {
  if (d.firstRun) return `首次写入 ${d.added} 个模型`
  const parts = []
  if (d.added.length) parts.push(`新增 ${d.added.length}`)
  if (d.removed.length) parts.push(`下架 ${d.removed.length}`)
  if (d.changed.length) parts.push(`字段变更 ${d.changed.length}`)
  return parts.length ? parts.join(' / ') : '无实质变化'
}

/**
 * 单独检出价格变更。
 *
 * 为什么要从 changed 里再拆一层：
 *   价格是模型数据里最敏感也最有决策价值的字段——
 *   「某模型涨价 4 倍」会直接改变选型结论，
 *   而「上下文窗口从 128K 变成 131K」几乎不影响任何决策。
 *   混在一个「字段变更 N 条」里报告，关键信息会被淹没。
 *
 * 只比对输入/输出/缓存三个价，不含上下文——那是另一个维度。
 */
function diffPrices(prev, next) {
  const prevMap = new Map(prev.map((m) => [m.id, m]))
  const out = []
  for (const m of next) {
    const a = prevMap.get(m.id)
    if (!a) continue
    for (const [field, label] of [
      ['priceInput', '输入价'],
      ['priceOutput', '输出价'],
      ['priceCacheRead', '缓存读取价'],
    ]) {
      const from = a[field]
      const to = m[field]
      if (from === to) continue
      // 两者都为 null（无此计费项）不算变化
      if (from == null && to == null) continue
      const ratio =
        typeof from === 'number' && from > 0 && typeof to === 'number'
          ? to / from
          : null
      out.push({ id: m.id, name: m.name, field, label, from, to, ratio })
    }
  }
  return out
}

async function main() {
  const startedAt = Date.now()
  log(`\n=== 模型数据更新 ${new Date().toISOString()} ===`)

  log('\n[1/3] 抓取 OpenRouter 模型列表')
  const { models, meta } = await fetchModels()
  log(`  抓取到 ${models.length} 个模型`)

  /*
   * 人工核实标记的来源是 data/models-verified.json，不是上一版 models.json。
   *
   * 为什么不用 models.json 里的 verifiedBy 直接继承：
   * models.json 每日全量重写，一旦某次抓取或手改把它弄丢了，
   * 核实记录就跟着消失，且没有任何地方能看出来。
   * 台账文件独立存在、git diff 清晰，是人工成果的唯一真相来源。
   * 详见 scripts/verify-model.mjs。
   */
  const prevModels = loadPrevModels()
  if (prevModels.length === 0) log('  未找到既有 models.json，按首次写入处理')
  const prevDates = new Map(prevModels.map((m) => [m.id, m.autoAdmittedAt]).filter(([, v]) => v))

  const { verified: ledgerEntries, verifyBy } = loadVerifyLedger()
  if (ledgerEntries.size > 0) {
    log(`  台账中有 ${ledgerEntries.size} 条人工核实记录`)
  }
  // 台账里指向已下架模型的记录必须提示，否则会以为核实还在生效
  const staleVerified = [...ledgerEntries].filter((id) => !models.some((m) => m.id === id))
  if (staleVerified.length) {
    log(`  ⚠️ 台账中 ${staleVerified.length} 条已下架模型：${staleVerified.slice(0, 5).join(', ')}`)
  }
  const nowDate = meta.fetchedAt.slice(0, 10)

  const enriched = models.map((m) => ({
    ...m,
    autoAdmitted: true,
    /*
     * 收录日期的继承逻辑：
     * 首次出现 = 今天；已存在则沿用旧日期。
     * 模型被下架又重新上架时会重新标待核实（台账里没有它的核实记录），
     * 但旧日期不该丢——否则读者分不清「新条目」和「重新上架的老条目」。
     */
    autoAdmittedAt: prevDates.get(m.id) ?? nowDate,
    verifiedBy: verifyBy.get(m.id) ?? null,
  }))

  const d = diffModels(prevModels, enriched)
  log(`  ${describeDiff(d)}`)
  if (d.added.length) log(`    新增：${d.added.slice(0, 6).join(', ')}${d.added.length > 6 ? ' …' : ''}`)
  if (d.removed.length) log(`    下架：${d.removed.slice(0, 6).join(', ')}${d.removed.length > 6 ? ' …' : ''}`)
  if (d.changed.length) log(`    变更：${d.changed.slice(0, 6).join(', ')}${d.changed.length > 6 ? ' …' : ''}`)

  /*
   * 调价高亮。
   * 价格照常写盘推送（不阻塞管线——OpenRouter 是聚合器，
   * 渠道价格波动未必等于厂商官宣，停下来等确认反而容易卡住整条更新），
   * 但单独列出来，让报告里能一眼看到「哪些模型的价格变了、变了多少」。
   */
  const priceChanges = diffPrices(prevModels, enriched)
  if (priceChanges.length) {
    log(`\n  💰 调价 ${priceChanges.length} 项（已自动更新，商用前请核对官方定价页）：`)
    // 涨得最狠的排前面：倍率越大越需要关注
    const sorted = [...priceChanges].sort((a, b) => (b.ratio ?? 99) - (a.ratio ?? 99))
    for (const p of sorted.slice(0, 10)) {
      const pct =
        p.ratio == null ? '' : `${p.ratio >= 1 ? '+' : ''}${((p.ratio - 1) * 100).toFixed(0)}%`
      log(`    ${p.name}（${p.id}）${p.label} $${p.from ?? '—'} → $${p.to ?? '—'}${pct ? ` (${pct})` : ''}`)
    }
    if (priceChanges.length > 10) log(`    …另有 ${priceChanges.length - 10} 项`)
  }

  /*
   * 熔断：一次抓回 0 个模型几乎不可能是真实的（OpenRouter 从未下架过全部模型）。
   * 这种时候写盘等于把线上清空，必须 abort。
   */
  if (enriched.length === 0) {
    console.error('❌ 抓取结果为 0 个模型，判定为上游异常，已放弃写盘')
    process.exit(1)
  }
  if (prevModels.length > 0 && enriched.length < prevModels.length * 0.8) {
    console.error(
      `❌ 模型数量从 ${prevModels.length} 跌到 ${enriched.length}（跌幅超20%），` +
        '判定为上游截断，已放弃写盘'
    )
    process.exit(1)
  }

  const payload = {
    meta: {
      lastUpdated: meta.fetchedAt.slice(0, 10),
      source: meta.source,
      disclaimer:
        '数据来自 OpenRouter 公开 API（聚合器，非厂商官方源），价格单位为美元/百万 token。' +
        '本数据由脚本每日自动抓取，字段未经人工逐条核实，商用决策请以厂商官方定价页为准。' +
        '标记「路由器」的条目是自动选型服务而非模型本体，价格随转发目标浮动；' +
        '标记「批处理」的条目是批处理折扣变体，与同名标准版不构成同价对比。',
      total: enriched.length,
      autoAdmitted: enriched.filter((m) => !m.verifiedBy).length,
      verified: enriched.filter((m) => m.verifiedBy).length,
    },
    models: enriched,
  }

  log('\n[2/3] schema 校验')
  const result = validateModelsFile(payload)
  if (!result.ok) {
    console.error(`❌ schema 校验失败（${result.issues.length} 处），已放弃写盘，线上不受影响：`)
    for (const it of result.issues.slice(0, 15)) console.error(`  · ${it}`)
    process.exit(1)
  }
  log(`  ✅ 校验通过（${result.total} 个模型）`)

  log('\n[3/3] 写盘')
  if (DRY_RUN) {
    log('  --dry-run：未写任何文件')
  } else {
    writeFileSync(MODELS_PATH, JSON.stringify(payload) + '\n', 'utf8')
    log(`  已写入 src/data/models.json（${result.total} 个模型）`)
  }

  const secs = Math.round((Date.now() - startedAt) / 1000)
  log(`\n=== 完成（${secs}s）｜${describeDiff(d)}｜待核实 ${payload.meta.autoAdmitted} / 已核实 ${payload.meta.verified} ===`)
  if (priceChanges.length) log(`💰 本次调价 ${priceChanges.length} 项，详见上方清单`)
  return { total: result.total, diff: d, priceChanges: priceChanges.length }
}

main().catch((e) => {
  console.error(`\n❌ 模型数据更新失败: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
