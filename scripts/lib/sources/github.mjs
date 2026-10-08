/**
 * GitHub API —— 开源 Agent 项目发现 + 存量项目的 star/许可证刷新
 *
 * 限流（实测 2026-10）：
 *   search端点 10 次/分（未鉴权），core 端点 60 次/时
 *   search 按 created:>水位线 过滤，返回量可控；
 *   存量刷新必须分批 + 退避，否则 60 次/时会很快打满。
 */

import { fetchJson } from '../http.mjs'
import { scoreCandidate, shouldEnqueue } from '../filter.mjs'

const SEARCH = 'https://api.github.com/search/repositories'

/*
 * 搜索 query 组
 * ----------------
 * 为什么要分多组、而不是一个 `agent OR agentic OR llm`：
 *
 * 1) 一组就够的话，国内候选会继续维持在 3% 的水平。实测（2026-10-03）
 *    纯英文 query 捞回的前 20 条里，中文项目只有 2 个，且都不是 Agent 产品。
 *    但换成中文词（智能体 / AI Agent / LLM Agent），立刻捞到
 *    zai-org/ZCode（智谱）、qiz029/dscode（DeepSeek 的 coding agent）这类真项目。
 *    国内开发者的开源项目确实在 GitHub 上，只是英文词搜不到——他们用中文写 description。
 *
 * 2) 单个宽query 的噪声极高。`agent created:>X` 实测有 5.3 万条，
 *    按 star 排序取前 60 会捞到 skills / dots / seiso 这类
 *    「名字里蹭到 agent、实际不是 Agent 产品」的仓库。
 *    拆成多个窄 query 各自排序，等于把 star 排序的竞争池缩小，信噪比高得多。
 *
 * 注意：created:> 是全局约束（实测无意义词 + created 返回 0），
 * 所以每组 query 都要带上时间条件，不能只加一次。
 */
const QUERY_GROUPS = [
  { label: 'en-agent', q: 'agent OR agentic OR "ai agent" OR "llm agent"' },
  { label: 'zh-agent', q: '智能体 OR AI Agent OR LLM Agent' },
  { label: 'zh-llm', q: '大模型 OR 智能助手 OR 多智能体' },
  { label: 'en-framework', q: 'multi-agent OR agent-framework OR agent-runtime OR mcp-server' },
]

/*
 * 时间窗口策略
 * ----------------
 * 原先只有 created:> 水位线一个窗口，漏检是结构性的：
 *
 *   Pi（Earendil 的 coding agent）就是活生生的例子——仓库早已存在，
 *   但近期才因为某个事件爆火、star 暴涨。等它被搜索按created 抓到时，
 *   用户早就用上了，而我们的库里还没有。这不是发现源弱，是查询维度选窄了。
 *
 * 所以改成两个互补的窗口：
 *   created 窗口 —— 只捞「近N 天新建的」，噪声最低，量小。
 *   backfill 窗口 —— 用 pushed:> 捞「近 N 天有推送」的成熟项目，
 *                      按 star 降序取头部的 N 个。这一组必然混入大量
 *                      两年前的经典项目（LangChain、AutoGPT 等），
 *                      但只要它们已入库，knownIds 就会在admit.mjs 里挡掉；
 *                      真正入库的只会是 star 涨到门槛以上、库里还没有的老项目。
 *
 * backfill 只取最热的 headLimit 个，且不受单日入库上限以外的额外配额，
 * 因为它天然低产（大部分命中项已在库），但召回价值高。
 */
const BACKFILL_DAYS = 90
const BACKFILL_PER_GROUP = 8

/**
 * 发现开源 Agent 项目（新建 + 爆火回溯两个窗口）
 * @param {string} since ISO 时间戳，水位线
 * @param {{perGroup?: number, backfill?: boolean}} opts
 */
export async function discoverRepos(since, { perGroup = 25, backfill = true } = {}) {
  const sinceDay = since.slice(0, 10)
  const out = []
  const seen = new Set()

  // 两个窗口：created 保证不漏新建，pushed 补上「老项目近期爆火」
  const windows = [
    { label: 'created', timeFilter: `created:>${sinceDay}`, perGroup },
  ]
  if (backfill) {
    const backfillDay = shiftDays(sinceDay, -BACKFILL_DAYS)
    windows.push({ label: 'backfill', timeFilter: `pushed:>${backfillDay}`, perGroup: BACKFILL_PER_GROUP })
  }

  for (const win of windows) {
    for (const group of QUERY_GROUPS) {
      const q = `(${group.q}) ${win.timeFilter}`
      const url = `${SEARCH}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${win.perGroup}`

      let data
      try {
        data = await withRetry(() => fetchJson(url))
      } catch (e) {
        // 单组失败不影响其他组——search 端点限流最容易在这里发生
        console.warn(`  ⚠️ GitHub 搜索组 ${group.label}/${win.label} 失败: ${e.message}`)
        continue
      }

      for (const r of data.items ?? []) {
        // 已归档的项目没有收录价值——它已经是过去式了
        if (r.archived) continue
        if (seen.has(r.full_name.toLowerCase())) continue
        seen.add(r.full_name.toLowerCase())

        const score = scoreCandidate({
          title: r.name,
          description: r.description ?? '',
          signals: { stars: r.stargazers_count ?? 0 },
          sourceType: 'github',
        })
        if (!shouldEnqueue(score)) continue

        out.push({
          slugSource: `gh:${r.full_name.toLowerCase()}`,
          name: r.name,
          url: r.html_url,
          score,
          description: (r.description ?? '').slice(0, 300),
          signals: {
            stars: r.stargazers_count ?? 0,
            license: r.license?.spdx_id ?? null,
            forks: r.forks_count ?? 0,
            archived: r.archived,
          },
          fullName: r.full_name,
          pushedAt: r.pushed_at ?? null,
          /*
           * homepage —— 自动入库判定的必需输入。
           * GitHub 仓库的 homepage 字段是「产品官网」，这是 GitHub 源
           * 唯一能拿到一手官方链接的途径（仓库 URL 本身只能算仓库页）。
           * 没有它就无法满足 admit.mjs 的「有官方来源」信号组。
           */
          homepage: (r.homepage || '').trim() || null,
          createdAt: r.created_at ?? null,
          queryGroup: `${group.label}/${win.label}`,
        })
      }

      // search 端点鉴权后 30 次/分，这里只有 8 次，仍留 1 秒间隔避免撞线
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  return out
}

/** YYYY-MM-DD 前移 n 天。不能用 Date 算，避免时区把日期推错一天。 */
function shiftDays(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + delta * 86400_000
  const dt = new Date(t)
  return dt.toISOString().slice(0, 10)
}

/** 指数退避重试，用于 403/429 限流 */
async function withRetry(fn, { retries = 3, baseDelay = 2000 } = {}) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const isRateLimit = /HTTP (403|429)/.test(e.message)
      // 只对限流退避；404 之类的错误重试也没用
      if (!isRateLimit || i === retries - 1) throw e
      const delay = baseDelay * 2 ** i
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

/**
 * 刷新存量里已收录的 GitHub 项目（取 star 与许可证）。
 *
 * 只更新客观字段，且**不碰 status** —— 仓库 archived 只产出信号，
 * 由人工确认后才改数据，避免把活跃产品误判为停更。
 *
 * @param {Array<{id:string, officialUrl:string}>} existing
 */
export async function refreshRepos(existing) {
  /*
   * 优先用 repoUrl，退回从 officialUrl 里解析。
   *
   * 为什么要改：原先只看 officialUrl，而库里 13 个 openSource 项目有 12 个的
   * officialUrl 指向官网或文档页（ragflow.io、docs.anthropic.com、kimi.com/code…），
   * 只有 superagi 一个是仓库地址。结果这个函数基本在空转——
   * 每次只刷到 1 个项目，而日志里看不出异常，看起来像「今天没变化」。
   *
   * repoUrl 是逐个用 GitHub API 核实过存在的真实仓库地址。
   * kimi-code 特别说明：MoonshotAI/kimi-cli 已archived（Python 旧版），
   * 活跃仓库是 MoonshotAI/kimi-code，别填错。
   */
  const targets = existing
    .map((a) => ({
      id: a.id,
      slug: ownerRepoFromUrl(a.repoUrl) ?? ownerRepoFromUrl(a.officialUrl),
    }))
    .filter((t) => t.slug)

  const updated = []
  const signals = []
  let rateLimited = 0

  for (const t of targets) {
    try {
      const r = await withRetry(() => fetchJson(`https://api.github.com/repos/${t.slug}`))
      updated.push({
        id: t.id,
        stars: r.stargazers_count ?? null,
        license: r.license?.spdx_id ?? null,
        pushedAt: r.pushed_at ?? null,
      })
      // archived / 长期不维护 只作为「疑似状态变更」信号，不自动改 status
      if (r.archived) {
        signals.push({ id: t.id, statusSignal: 'discontinued', why: 'GitHub 仓库已 archived' })
      }
    } catch (e) {
      if (/HTTP (403|429)/.test(e.message)) {
        rateLimited++
        // 打满限流就停手，剩余的下次跑——不能硬撑
        if (rateLimited >= 3) {
          console.warn(`  ⚠️ GitHub 限流，剩余 ${targets.length - updated.length} 个下次再刷`)
          break
        }
      }
      //单个项目失败（404 是常态：仓库改名或删除）不影响整体
      continue
    }
    // 主动限速，避免撞上限流。
    // 鉴权后 core 端点额度 5000 次/时（未鉴权只有 60），
    // 1.1 秒/次 ≈ 3300次/时，留足余量；未鉴权时退回 1.1 秒也不会超。
    await new Promise((r) => setTimeout(r, 400))
  }

  return { updated, signals }
}

/** 从 github.com 链接里提取 owner/repo */
function ownerRepoFromUrl(url = '') {
  const m = String(url).match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/)
  return m ? `${m[1]}/${m[2]}` : null
}