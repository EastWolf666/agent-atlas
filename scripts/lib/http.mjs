/**
 * 带超时的 fetch 封装
 *
 * 每日 workflow 不能被某个源拖死——GitHub Actions 单个 job 有 6 小时上限，
 * 但实际运维上等 3 分钟没结果就该当作这个源失败，而不是继续等。
 */

const UA = 'AgentAtlasBot/1.0 (+https://github.com/EastWolf666/agent-atlas)'

/*
 * GitHub 鉴权
 * ----------------
 * GitHub Actions 会自动注入 GITHUB_TOKEN 环境变量，但默认权限下它是空的，
 * 必须显式声明 secrets 才能读到（见 update-data.yml 的 env）。
 *
 * 不带 token 的代价是实打实的（实测2026-10-03）：
 *   search 端点 10 次/分-> 30 次/分
 *   core 端点   60 次/时  -> 5000 次/时
 * 而 refreshRepos 要刷存量里所有带 GitHub 链接的条目（约 30+ 个），
 * 未鉴权时撞到 3 次限流就break，一半以上的 star 刷新会静默失败——
 * 日志里只留一行「GitHub 限流，剩余 N个下次再刷」，很容易被当成正常现象忽略。
 *
 * 本地手动跑时通常没有这个变量，此时降级为未鉴权请求，不报错。
 */
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''

/** 需要鉴权的域名（只有 GitHub API，其他源如 HN/RSS 不需要） */
function authHeaders(url, headers) {
  if (!GH_TOKEN) return headers
  if (!/^https:\/\/api\.github\.com\//.test(url)) return headers
  return { ...headers, Authorization: `Bearer ${GH_TOKEN}` }
}

/**
 * @param {string} url
 * @param {{timeout?: number, headers?: object, method?: string, body?: any}} opts
 */
export async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 20_000, headers = {}, method = 'GET', body } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: authHeaders(url, {
        'User-Agent': UA,
        Accept: 'application/json, */*',
        ...headers,
      }),
      body,
    })
    if (!res.ok) {
      // 把状态码带上，便于排查限流(403/429)vs 端点不存在(404)
      const hint =
        res.status === 403 || res.status === 429
          ? GH_TOKEN
            ? ''
            : '（未检测到 GITHUB_TOKEN，限流额度为未鉴权档）'
          : ''
      throw new Error(`HTTP ${res.status} ${res.statusText}${hint} — ${url}`)
    }
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts)
  return res.json()
}

/** 取纯文本（RSS 用） */
export async function fetchText(url, opts = {}) {
  const res = await fetchWithTimeout(url, {
    ...opts,
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*', ...(opts.headers ?? {}) },
  })
  return res.text()
}