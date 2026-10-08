#!/usr/bin/env node
/**
 * 每日数据更新 —— 编排入口
 *
 * 跑法：npm run fetch
 *
 * 设计原则：**只做机器能做且不会出错的事**。
 *   机器能做：发现新产品、刷新 star/许可证、统计口径重算
 *   机器不能做：L1-L5 定级、产品描述、状态变更判断
 *
 * 所以这个脚本的产物分两处：
 *   src/data/agents.json  ← 只改客观字段，改动极小
 *   data/candidates.json  ← 新候选池，攒着给人工看
 *
 * 写盘前必经schema 校验；校验不过就abort，一个字节都不落。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateAgents, findHardcodedCounts } from './lib/schema.mjs'
import { loadWatermarks, saveWatermarks, sinceFor, advanceWatermark } from './lib/watermark.mjs'
import { fetchFromHN } from './lib/sources/hn.mjs'
import { discoverRepos, refreshRepos } from './lib/sources/github.mjs'
import { fetchFromRSS } from './lib/sources/rss.mjs'
import { mergeObjective, collectStatusSignals } from './lib/merge.mjs'
import { refreshMetaNumbers, refreshInsights, confidenceBreakdown } from './lib/insights.mjs'
import { slugify, guessRegion, guessTier, isReviewable } from './lib/filter.mjs'
import { selectAdmissible, rejectionSummary } from './lib/admit.mjs'
import { synthesizeAgent } from './lib/synthesize.mjs'
import { effectiveLimit, loadState, saveState, DEFAULT_DAILY_LIMIT } from './lib/quota.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const AGENTS_PATH = resolve(ROOT, 'src/data/agents.json')
const META_PATH = resolve(ROOT, 'src/data/meta.json')
const CANDIDATES_PATH = resolve(ROOT, 'data/candidates.json')
const WATERMARK_PATH = resolve(ROOT, 'data/.watermark.json')
const STATUS_SIGNALS_PATH = resolve(ROOT, 'data/status-signals.json')
const AUTO_ADDED_PATH = resolve(ROOT, 'data/auto-added.json')
const ADMISSION_STATE_PATH = resolve(ROOT, 'data/.admission-state.json')

/** 允许 CI 里跳过网络步骤（调试用） */
const SKIP_FETCH = process.argv.includes('--no-fetch')
const DRY_RUN = process.argv.includes('--dry-run')

/** 单日自动入库上限，可--max=N 覆盖 */
const MAX_ARG = process.argv.find((a) => a.startsWith('--max='))
const DAILY_LIMIT = MAX_ARG ? Number(MAX_ARG.split('=')[1]) : DEFAULT_DAILY_LIMIT

function log(msg) {
  console.log(msg)
}

async function main() {
  const startedAt = Date.now()
  log(`\n=== Agent Atlas 数据更新 ${new Date().toISOString()} ===`)

  const agents = JSON.parse(readFileSync(AGENTS_PATH, 'utf8'))
  const metaJson = JSON.parse(readFileSync(META_PATH, 'utf8'))
  const watermarks = loadWatermarks(WATERMARK_PATH)
  const now = new Date()

  // ---------------- 1. 抓取 ----------------
  const candidates = []
  const failures = []

  if (SKIP_FETCH) {
    log('\n[1/5] --no-fetch：跳过所有网络抓取')
  } else {
    log('\n[1/5] 抓取候选源')

    // HN —— 新产品发现主力
    try {
      const { since, isInitial } = sinceFor(watermarks, 'hn', now)
      log(`  HN Show HN（${isInitial ? '首次，回填 7 天' : '增量'}，since ${since.slice(0, 10)}）`)
      const items = await fetchFromHN(since)
      log(`  HN: 保留 ${items.length} 条候选`)
      candidates.push(...items.map((c) => ({ ...c, source: 'hn' })))
      advanceWatermark(watermarks, 'hn', now.toISOString(), now)
    } catch (e) {
      log(`  ⚠️ HN 抓取失败: ${e.message}`)
      failures.push('hn')
    }

    // GitHub —— 开源项目发现
    try {
      const { since } = sinceFor(watermarks, 'github', now)
      log(`  GitHub 新项目（since ${since.slice(0, 10)}）`)
      const items = await discoverRepos(since)
      log(`  GitHub: 保留 ${items.length} 条候选`)
      candidates.push(...items.map((c) => ({ ...c, source: 'github' })))
      advanceWatermark(watermarks, 'github', now.toISOString(), now)
    } catch (e) {
      log(`  ⚠️ GitHub 抓取失败: ${e.message}`)
      failures.push('github')
    }

    // RSS —— 国内候选 + 素材
    try {
      const { since } = sinceFor(watermarks, 'rss', now)
      log('  RSS 源')
      const items = await fetchFromRSS(since, { failures })
      log(`  RSS: 保留 ${items.length} 条候选`)
      candidates.push(...items.map((c) => ({ ...c, source: 'rss' })))
      advanceWatermark(watermarks, 'rss', now.toISOString(), now)
    } catch (e) {
      log(`  ⚠️ RSS 抓取失败: ${e.message}`)
      failures.push('rss')
    }
  }

  // ---------------- 2. 刷新存量的客观字段 ----------------
  log('\n[2/5] 刷新存量客观字段（star / 许可证）')
  let statusSignals = []
  let refreshedCount = 0
  if (SKIP_FETCH) {
    log('  --no-fetch：跳过')
  } else {
    try {
      const { updated, signals } = await refreshRepos(agents)
      for (const u of updated) {
        const agent = agents.find((a) => a.id === u.id)
        if (!agent) continue
        const { agent: next, changed } = mergeObjective(agent, u)
        if (changed) {
          agents[agents.indexOf(agent)] = next
          refreshedCount++
        }
      }
      statusSignals = collectStatusSignals(agents, signals)
      log(`  刷新 ${updated.length} 个项目，其中 ${refreshedCount} 条有变化`)
      if (statusSignals.length) {
        log(`  ⚠️ ${statusSignals.length} 个项目疑似状态变更（需人工确认，未自动改status）`)
      }
    } catch (e) {
      log(`  ⚠️ GitHub刷新失败: ${e.message}`)
      failures.push('github-refresh')
    }
  }

  // ---------------- 3. 自动入库 ----------------
  /*
   * 为什么放在「刷新存量」之后、「重算统计」之前：
   *   - 刷新存量拿到最新的 homepage / star，入库判据要用这些信号；
   *   - 放在重算之前，新条目的 id 会立刻计入 meta.total 与各条洞察的统计口径，
   *     不需要再跑一遍。
   *
   * 这一步解决的是「发现能力早就有了，但从候选到入库的通道缺失」这个老问题：
   * 候选池曾堆积 357 条从未被消费，新品永远进不了正式数据。
   * 这里在严格判据 + 单日配额下，把够格的高质量候选直接写进 agents.json。
   *
   * 与 merge.mjs 的关系是**并列而非修改**：merge.mjs 管存量「修正客观值」，
   * 这里管新增「生成编辑占位」。两者语义不同，强行合并会让 merge.mjs
   * 精心维护的 FORBIDDEN 白名单失效。
   */
  log('\n[3/6] 自动入库（发现的新品直接进正式数据）')
  let admittedRecords = []
  let admissionReport = { found: candidates.length, qualified: 0, admitted: 0, quotaLimited: false, paused: null, rejected: [], accepted: [] }

  if (SKIP_FETCH) {
    log('  --no-fetch：跳过')
    admissionReport.paused = 'SKIP_FETCH'
  } else {
    const knownIds = new Set(agents.map((a) => a.id))
    const knownUrls = new Set(agents.map((a) => a.officialUrl).filter(Boolean).map((u) => String(u).replace(/\/$/, '')))

    const { accepted, rejected } = selectAdmissible(candidates, { knownIds, knownUrls, now })
    admissionReport.qualified = accepted.length
    admissionReport.rejected = rejectionSummary(rejected)

    const quota = effectiveLimit({ failedSources: failures, limit: DAILY_LIMIT })
    if (quota.limit === 0) {
      admissionReport.paused = quota.reason
      log(`  ⏸ ${quota.reason}`)
      log('  （候选仍会正常进入候选池，只是今日不自动写入正式数据）')
    } else {
      const toAdmit = accepted.slice(0, quota.limit)
      admissionReport.quotaLimited = accepted.length > quota.limit

      for (const item of toAdmit) {
        const rec = synthesizeAgent(item.cand, item.id, now.toISOString().slice(0, 10))
        agents.push(rec)
        admittedRecords.push(rec)
        knownIds.add(rec.id)
      }
      admissionReport.admitted = admittedRecords.length
      admissionReport.accepted = toAdmit.map((x) => ({ id: x.id, name: x.cand.name, score: x.score, reason: x.reason }))

      log(`  候选 ${candidates.length} 条 → 达门槛 ${accepted.length} 条 → 实际入库 ${admittedRecords.length} 条（上限 ${quota.limit}）`)
      for (const a of admissionReport.accepted) {
        log(`    ✓ ${a.id}（${a.name}）— ${a.reason}`)
      }
      if (admissionReport.quotaLimited) {
        log(`  ⚠️ 另有 ${accepted.length - toAdmit.length} 条达门槛候选因单日上限未入库，明日继续`)
      }
      if (rejected.length) {
        const top = admissionReport.rejected.map((r) => `${r.reason} ×${r.count}`).join('；')
        log(`  拒绝 ${rejected.length} 条，主要原因：${top}`)
      }
    }
  }

  // ---------------- 4. 重算数字与洞察 ----------------
  log('\n[4/6] 重算统计口径与洞察文案')
  const stats = refreshMetaNumbers(metaJson, agents)
  const changedInsights = refreshInsights(metaJson, agents, stats)
  log(`  total: ${metaJson.meta.total}｜官方来源 ${stats.officialCount}｜非活跃 ${stats.nonActive}`)
  log(`  洞察更新 ${changedInsights.length} 条`)
  for (const c of changedInsights) {
    log(`    [${c.index}] ${c.before.slice(0, 40)}… → ${c.after.slice(0, 40)}…`)
  }

  // ---------------- 5. 候选池 ----------------
  log('\n[5/6] 合并候选池')
  const existingCandidates = existsSync(CANDIDATES_PATH)
    ? JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8'))
    : { candidates: [] }
  const seen = new Set(existingCandidates.candidates.map((c) => c.slugSource))
  const knownIds = new Set(agents.map((a) => a.id))
  const knownUrls = new Set(agents.map((a) => a.officialUrl))

  /*
   * 地区比例守卫
   * ----------------
   * 项目定位已调整为「国内为主」：正式数据中国内 48 / 海外 32 ≈ 6:4。
   *
   * 但现有抓取源（HN Show HN、GitHub trending、英文 RSS）天然偏海外，
   * 每天灌进来的候选会持续把候选池推向海外。若不做干预，
   * 人工消费候选时会不断优先看到海外产品，比例会慢慢被侵蚀回50:50。
   *
   * 处理方式：给候选池设置 TARGET_CN_RATIO 的软上限。
   * 国内候选达到水位线后，仍低于水位线的海外候选不再入池，
   * 而国内候选永远优先入池——即使当下比例已经超标。
   *
   * 已知限制（不要假装这个守卫能解决它）：
   * 国内 RSS 源在沙箱与 CI 环境下都不可用——
   *   机器之心 rss、36氪 feed   → HTTP 200 但 0 items（空壳）
   *   量子位feed               → 需带 User-Agent，否则返回空 body
   *   IT之家 rss                → 可用（60 items），但综合科技新闻，
   *                               前 25 条里仅 2 条与 AI 相关，噪声比过高
   *
   * 但「国内为主」并非只能靠人工：实测（2026-10-03）GitHub 中文关键词搜索
   * 能稳定捞到国内开发者的项目——
   *   「智能体」近 30 天 2,240 条，捞到 Loopera-ai/loopera、agents-universe
   *   「AI Agent」近 30 天 66,034 条，捞到 zai-org/ZCode（智谱）
   *   「LLM Agent」捞到 qiz029/dscode（DeepSeek 的 coding agent）
   * 国内开发者的项目在 GitHub 上，只是他们用中文写 description，
   * 英文关键词搜不到。github.mjs 的 QUERY_GROUPS 已加入中文词组。
   *
   * 所以现在国内候选有两条通路：中文 GitHub 搜索（自动）+ 人工补充。
   * 守卫的价值从「唯一的手段」降级为「兜底」：防止某天中文源抽风时比例回退。
   */
  const TARGET_CN_RATIO = 0.6
  const pool = existingCandidates.candidates
  const cnInPool = pool.filter((c) => c.regionHint === 'china').length
  const ratioInPool = pool.length === 0 ? 1 : cnInPool / pool.length
  if (pool.length >= 20 && ratioInPool < TARGET_CN_RATIO - 0.1) {
    log(
      `  ⚠️ 候选池国内占比 ${(ratioInPool * 100).toFixed(0)}%（${cnInPool}/${pool.length}），` +
        `低于目标 ${(TARGET_CN_RATIO * 100).toFixed(0)}%：海外候选照常入池，国内源缺失需人工补充`
    )
  }

  let added = 0
  let skippedByRatio = 0
  let skippedUnreviewable = 0
  for (const c of candidates) {
    if (seen.has(c.slugSource)) continue
    // 已在库里的产品（按 id 或官网链接匹配）不再重复入池
    const slug = slugify(c.name)
    if (knownIds.has(slug)) continue
    if (c.url && knownUrls.has(c.url)) continue

    /*
     * 质量门槛：挡掉人工无法判断的条目（纯新闻、AI 新闻公告、无描述的 repo 名）。
     * 放在 seen.add 之前——被判废的条目不该占去重位，
     * 否则同一 slug 下次换个源再抓一次，还是会被这里挡掉，掩盖了源本身的问题。
     */
    if (!isReviewable({ title: c.name ?? c.title, description: c.description })) {
      skippedUnreviewable++
      continue
    }

    seen.add(c.slugSource)

    const text = `${c.name} ${c.description ?? ''} ${c.title ?? ''}`
    const region = c.regionHint ?? guessRegion(text)

    // 国内候选无条件优先入池；海外候选在水位线达标后才放行
    const liveRatio = existingCandidates.candidates.length === 0
      ? 1
      : cnInPool / existingCandidates.candidates.length
    if (region !== 'china' && existingCandidates.candidates.length >= 20 && liveRatio >= TARGET_CN_RATIO) {
      skippedByRatio++
      continue
    }

    existingCandidates.candidates.push({
      slug,
      name: c.name,
      url: c.url,
      source: c.source,
      score: c.score,
      date: c.date,
      regionHint: region,
      tierHint: c.regionHint ? undefined : guessTier(text, c.name),
      description: c.description ?? c.summary ?? '',
      signals: c.signals ?? {},
      suggestedSources: c.url
        ? [{ title: `${c.sourceName ?? c.source} 报道`, url: c.url, type: 'media', date: c.date }]
        : [],
      discoveredAt: now.toISOString().slice(0, 10),
      decided: false,
    })
    added++
  }
  existingCandidates.generatedAt = now.toISOString().slice(0, 10)
  log(`  新增候选 ${added} 条，池内共 ${existingCandidates.candidates.length} 条待处理`)
  if (skippedUnreviewable > 0) {
    log(`  质量门槛挡下 ${skippedUnreviewable} 条（纯新闻/无法判断的条目）`)
  }
  if (skippedByRatio > 0) {
    log(`  其中 ${skippedByRatio} 条海外候选因国内占比已达目标而未入池（需人工从国内侧补充）`)
  }
  const cnNow = existingCandidates.candidates.filter((c) => c.regionHint === 'china').length
  log(`  候选池地区构成：国内 ${cnNow} / 海外 ${existingCandidates.candidates.length - cnNow}`)
  const pending = existingCandidates.candidates.filter((c) => !c.decided).length
  log(`  其中 ${pending} 条尚未人工处理`)

  // ---------------- 6. 校验后写盘 ----------------
  log('\n[6/6] schema 校验并写盘')
  const { ok, count, issues } = validateAgents(agents, metaJson)
  if (!ok) {
    console.error(`❌ schema 校验失败（${issues.length} 处），已放弃写盘，线上不受影响：`)
    for (const it of issues.slice(0, 15)) console.error(`  · ${it.where}: ${it.msg}`)
    process.exit(1)
  }
  log(`  ✅ 校验通过（${count} 条）`)

  if (DRY_RUN) {
    log('\n--dry-run：未写任何文件')
  } else {
    writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2) + '\n', 'utf8')
    writeFileSync(META_PATH, JSON.stringify(metaJson, null, 2) + '\n', 'utf8')
    mkdirSync(dirname(CANDIDATES_PATH), { recursive: true })
    writeFileSync(
      CANDIDATES_PATH,
      JSON.stringify(existingCandidates, null, 2) + '\n',
      'utf8'
    )
    saveWatermarks(WATERMARK_PATH, watermarks)

    /*
     * 自动收录台账。
     * 存在的意义：自动写入正式数据的条目带 autoAdmitted 标记，
     * 但「该不该留」最终由人决定。这份台账让人能事后批量审查/清理，
     * 而不必去 agents.json 里大海捞针（那里 88+ 条里混着两种来源）。
     */
    const ledger = existsSync(AUTO_ADDED_PATH)
      ? JSON.parse(readFileSync(AUTO_ADDED_PATH, 'utf8'))
      : []
    const entries = Array.isArray(ledger) ? ledger : (ledger.entries ?? [])
      const existingIds = new Set(entries.map((e) => e.id))
      for (const rec of admittedRecords) {
        if (existingIds.has(rec.id)) continue
        entries.push({
          id: rec.id,
          admittedAt: rec.autoAdmittedAt,
          source: rec.openSource ? 'github' : 'media',
          reviewState: 'pending',
          note: '由每日脚本自动收录，定级与描述尚未人工核实',
        })
      }
      // 台账漂移防护：id 已不在正式数据里的条目自动剔除（对应 reviewState=rejected 被人工删除）
      const liveIds = new Set(agents.map((a) => a.id))
      const pruned = entries.filter((e) => liveIds.has(e.id))
      if (pruned.length !== entries.length) {
        log(`  台账剔除 ${entries.length - pruned.length} 条已删除的记录`)
      }
    writeFileSync(AUTO_ADDED_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf8')

    const quotaState = saveState(ADMISSION_STATE_PATH, now.toISOString().slice(0, 10), {
      admitted: admittedRecords.length,
      sourcesHealthy: failures.length === 0,
    })
    if (quotaState.shouldWarn) {
      log(`  ⚠️ 已连续 ${quotaState.zeroStreak} 天「源正常但入库 0 条」，判据可能过严或数据源结构变化，建议人工看一眼`)
    }

    if (statusSignals.length) {
      writeFileSync(
        STATUS_SIGNALS_PATH,
        JSON.stringify(
          { generatedAt: now.toISOString().slice(0, 10), signals: statusSignals },
          null,
          2
        ) + '\n',
        'utf8'
      )
    }
    log('  已写入 src/data/agents.json、src/data/meta.json、data/')
  }

  // ---------------- 摘要 ----------------
  const conf = confidenceBreakdown(agents)
  const hard = findHardcodedCounts(metaJson)
  const secs = Math.round((Date.now() - startedAt) / 1000)
  log(`\n=== 完成（${secs}s）===`)
  log(`  数据 ${count} 条｜变更 ${refreshedCount} 条｜新候选 ${added} 条｜待人工处理 ${pending} 条`)
  log(
    `  自动入库 ${admissionReport.admitted} 条（候选 ${admissionReport.found} → 达门槛 ${admissionReport.qualified}）` +
      (admissionReport.paused ? `｜已暂停：${admissionReport.paused}` : '')
  )
  log(`  置信度 high ${conf.high ?? 0} / medium ${conf.medium ?? 0} / low ${conf.low ?? 0}`)
  if (statusSignals.length) {
    log(`  状态信号 ${statusSignals.length} 条（data/status-signals.json，需人工确认）`)
  }
  if (hard.length) {
    log(`  ⚠️ 仍有 ${hard.length} 条洞察含硬编码数字，需人工复核`)
  }
  if (failures.length) {
    log(`  ⚠️ 本次失败的源：${failures.join(', ')}（已保持原水位线，下次重试）`)
  }
}

main().catch((e) => {
  console.error(`\n❌ 数据更新失败: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})