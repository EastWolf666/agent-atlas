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

/**
 * 发现新建的开源 Agent 项目
 * @param {string} since ISO 时间戳
 */
export async function discoverRepos(since, { perPage = 60 } = {}) {
  // created:>水位线 是增量的关键——不加这个条件会每次捞回全部仓库
  const q = `agent OR agentic OR llm created:>${since.slice(0, 10)}`
  const url =
    `${SEARCH}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`

  const data = await fetchJson(url)
  const items = data.items ?? []

  const out = []
  for (const r of items) {
    // 已归档的项目没有收录价值——它已经是过去式了
    if (r.archived) continue

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
    })
  }
  return out
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
  // 认得出 owner/repo 形式的官方链接才刷，其余（比如厂商官网）跳过
  const targets = existing
    .map((a) => ({ id: a.id, slug: ownerRepoFromUrl(a.officialUrl) }))
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
    // 主动限速，避免撞上 60 次/时
    await new Promise((r) => setTimeout(r, 1100))
  }

  return { updated, signals }
}

/** 从 github.com 链接里提取 owner/repo */
function ownerRepoFromUrl(url = '') {
  const m = String(url).match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/)
  return m ? `${m[1]}/${m[2]}` : null
}