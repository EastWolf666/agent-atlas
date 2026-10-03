/**
 * 客观字段合并
 *
 * 这个模块的核心是一张**白名单**：只有列在 AUTO_WRITABLE 里的字段才允许
 * 脚本自动写入。其余字段——尤其是定级与描述——永远不动。
 *
 * 为什么不做得更激进：自动抓取能拿到的是「GitHub 有多少 star」这类客观信号，
 * 但「这个产品该判 L3 还是 L4」是编辑判断。让脚本去猜，只会把一份
 * 有人复核过的数据变成一份没人复核过的数据，而且错了没人发现。
 */

/** 允许自动写入的字段（全是客观、可验证的） */
export const AUTO_WRITABLE = new Set([
  'lastVerified', // 本次自动核对过，标记日期
  'metrics', // { stars, license } 等外部信号
])

/**
 * 明确禁止自动写入的字段——每一项都记下原因，
 * 免得以后有人「觉得这个字段应该也能自动更新」而误改。
 */
export const FORBIDDEN = new Map([
  ['autonomyLevel', '自主性定级是编辑判断，API 无法得出'],
  ['autonomyReason', '定级判据必须人工撰写'],
  ['description', '产品描述需要实际使用体验，机器摘要是媒体视角'],
  ['tagline', '一句话定位是编辑判断'],
  ['highlights', '亮点需人工核实'],
  ['limitations', '局限需实际踩坑才知道'],
  ['bestFor', '适用场景需人工判断'],
  ['status', '误判会把活跃产品标成停更，伤害比收益大'],
  ['tier', '分类变更影响图谱行高与筛选器枚举'],
  ['pricingModel', '定价模式需逐个核实官网'],
  ['pricingNote', '价格细节变动快且需人工核对'],
  ['contextWindow', '上下文长度需查官方文档'],
  ['region', '地区判定需人工确认'],
  ['nameZh', '中文名是人工翻译'],
])

/**
 * 把自动抓到的信号合并进存量数据。
 * @returns {{agent: object, changed: boolean, notes: string[]}}
 */
export function mergeObjective(agent, fetched) {
  const notes = []
  const next = { ...agent }

  if (fetched.stars != null || fetched.license != null) {
    const before = next.metrics?.stars ?? null
    next.metrics = {
      ...(next.metrics ?? {}),
      stars: fetched.stars ?? next.metrics?.stars,
      license: fetched.license ?? next.metrics?.license,
    }
    if (before !== fetched.stars) {
      notes.push(`star ${before ?? '无'} → ${fetched.stars ?? '未知'}`)
    }
  }

  // 只在确实有变更时更新 lastVerified，避免每天都写一遍造成无意义的 diff
  if (notes.length) {
    const stamp = new Date().toISOString().slice(0, 10)
    if (next.lastVerified !== stamp) {
      next.lastVerified = stamp
      notes.push(`lastVerified → ${stamp}`)
    }
  }

  return { agent: next, changed: notes.length > 0, notes }
}

/**
 * 状态变更信号：只报告，不落库。
 * 理由：GitHub 仓库 archived 不等于产品停更（公司可能只是把代码挪走、
 * 转向闭源），误判会直接误导读者。
 */
export function collectStatusSignals(agents, signals) {
  const out = []
  for (const s of signals) {
    const agent = agents.find((a) => a.id === s.id)
    if (!agent) continue
    // 已经是非活跃状态就不重复报告
    if (agent.status !== 'active') continue
    out.push({
      id: s.id,
      name: agent.name,
      currentStatus: agent.status,
      signal: s.statusSignal,
      why: s.why,
      hint: '需人工确认：仓库 archived 不等于产品停更，也可能只是转向闭源',
    })
  }
  return out
}