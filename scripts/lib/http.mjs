/**
 * 带超时的 fetch 封装
 *
 * 每日 workflow 不能被某个源拖死——GitHub Actions 单个 job 有 6 小时上限，
 * 但实际运维上等 3 分钟没结果就该当作这个源失败，而不是继续等。
 */

const UA = 'AgentAtlasBot/1.0 (+https://github.com/EastWolf666/agent-atlas)'

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
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, */*',
        ...headers,
      },
      body,
    })
    if (!res.ok) {
      // 把状态码带上，便于排查限流(403/429)vs 端点不存在(404)
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
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