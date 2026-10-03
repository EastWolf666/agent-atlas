/**
 * Hacker News Algolia —— 新增候选的主要发现渠道
 *
 * 选它的原因：官方免费 API、免鉴权、created_at 可精确增量。
 * tags=show_hn 是产品发布的集中区，比抓新闻稿更接近「真实新产品」。
 */

import { fetchJson } from '../http.mjs'
import { cleanTitle, scoreCandidate, shouldEnqueue } from '../filter.mjs'

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date'

/**
 * @param {string} since ISO 时间戳，水位线
 * @returns {Promise<Array>} 候选数组
 */
export async function fetchFromHN(since, { limit = 300 } = {}) {
  const sinceUnix = Math.floor(new Date(since).getTime() / 1000)
  const url =
    `${ENDPOINT}?tags=show_hn&hitsPerPage=${limit}` +
    `&numericFilters=created_at_i>${sinceUnix}`

  const data = await fetchJson(url)
  const hits = data.hits ?? []

  const out = []
  for (const h of hits) {
    // url 为 null 说明是纯文本帖（Ask HN 那种），没有产品可收录
    if (!h.url || !/^https?:\/\//.test(h.url)) continue

    const name = cleanTitle(h.title)
    if (!name || name.length < 2) continue

    // 时间戳：只精确到月，与现有 sources 的 date 粒度一致
    const month = String(h.created_at ?? '').slice(0, 7)

    const score = scoreCandidate({
      title: h.title ?? '', // 用原始标题打分：cleanTitle 剥掉了 "Show HN:" 前缀，
      // 但产品名里往往才是关键词所在（"Show HN: MyAgent - LLM framework"）
      description: h.title ?? '',
      signals: { hnPoints: h.points ?? 0 },
      sourceType: 'community',
    })
    if (!shouldEnqueue(score)) continue

    out.push({
      slugSource: `hn:${h.objectID}`,
      name,
      url: h.url,
      score,
      date: month,
      signals: { hnPoints: h.points ?? 0, hnComments: h.num_comments ?? 0 },
      title: h.title,
    })
  }
  return out
}