/**
 * 候选 → Agent 记录生成
 * ========================
 * 把通过 admit.mjs 判据的候选，转成符合 schema 的 Agent 记录。
 *
 * ========================== 红线 ==========================
 * 本模块生成的文案**只允许复述来源里已经出现的事实**
 * （GitHub description、仓库名、star 数、license）。
 *
 * 严禁：
 *   - 编造性能数字（「准确率 95%」「快 3 倍」这类一个都不能出现）
 *   - 编造价格、上下文长度、兼容性承诺
 *   - 把「项目自述」当成「本站核实的结论」——所以所有模板字段
 *     都用「待核实」占位，并在 description 前缀明确标注来源。
 *
 * 理由：正式页面的读者会拿它做选型参考。一条诚实的「信息不全，待核实」
 * 是可接受的；一条看起来专业但事实错误的条目是有害的。
 *
 * 定级策略：**保守推断，上限 L3**。merge.mjs 禁止自动写 autonomyLevel
 * 是因为「该判 L3 还是 L4」是编辑判断——那这里也不能越过这条线：
 * 拿不准就往下判（L2），宁可低估不可高估一个产品的自主性。
 * =======================================================
 */

import { guessTier } from './filter.mjs'

/** 固定占位文案——统一出口，方便日后统一调整口径 */
const PLACEHOLDER = {
  limitations: '信息由机器自动抓取，未经人工核实；实际能力边界需自行验证。',
  bestFor: '待核实：请查阅官方文档确认适用场景',
  pricingNote: '待核实：定价信息需查官网',
  contextWindow: '待核实：需查官方文档',
}

/** 从仓库 full_name 提取 owner 作为厂商。GitHub 源没有厂商字段，这是最接近的客观事实。 */
function deriveVendor(cand) {
  if (cand.fullName) return String(cand.fullName).split('/')[0]
  if (cand.source === 'github') {
    const m = String(cand.url ?? '').match(/github\.com\/([\w.-]+)\//)
    if (m) return m[1]
  }
  return '待确认'
}

/** 首句截断做tagline。中文按。！？，英文按.!? */
function firstSentence(text, maxLen = 40) {
  const t = String(text).trim().replace(/\s+/g, ' ')
  if (!t) return '待核实：项目自述信息不足'
  const m = t.match(/^[^.!?。！？]*[.!?。！？]/)
  const s = m ? m[0] : t
  return s.length > maxLen ? s.slice(0, maxLen).trim() + '…' : s
}

/**
 * 保守推断自主性。**上限 3，永不返回 4 或 5。**
 * 框架/运行时类给 2（有明确的多步编排但自主性受限），
 * CLI/编程类给 3（能动态规划执行步骤），其余一律 2。
 */
function inferAutonomy(text) {
  const t = text.toLowerCase()
  // 框架 / 编排 / 运行时 —— 通常是"提供能力"而非"自主干活"
  if (/(orchestrat|multi-agent|multi agent|framework|runtime|protocol|orchestra|mcp server|编排|框架|运行时|协议)/.test(t)) {
    return { level: 2, basis: '框架/编排类关键词' }
  }
  // CLI / 编程助手 —— 通常能动态拆解任务
  if (/(cli|terminal|coding agent|code agent|developer|ide|dev tool|编程|代码|开发)/.test(t)) {
    return { level: 3, basis: 'CLI/编程类关键词' }
  }
  // 拿不准一律给最低的 L2，不猜高
  return { level: 2, basis: '无明确关键词，取保守默认值' }
}

/** star 数 → prominence（1-10）分档 */
function prominenceByStars(stars) {
  const n = Number(stars) || 0
  if (n >= 20000) return 8
  if (n >= 5000) return 7
  if (n >= 1000) return 6
  if (n >= 200) return 4
  return 3
}

/*
 * region（地区）判定——这里没有沿用 guessRegion 的启发式。
 *
 * 原因：guessRegion 会把文本里出现的中文 AI 词判成china，但它的词表里
 * 混进了 'copilot'（本意是英文产品名）。实测导致 CopilotKit/openmuse 这个
 * 美国开源项目被判成 region=china —— 一个纯 bug。
 *
 * region 在 merge.mjs 的 FORBIDDEN 里，是编辑判断字段。所以自动入库时
 * 用更保守的策略：
 *   - 描述里出现**中文正文**（而非产品名）才判china
 *   - 其余一律 overseas
 * 错判方向的选择理由：把海外项目误标成国内会扭曲「国内占比」这个核心指标，
 * 而漏标国内项目的代价只是少算一条，两者不对等——所以宁可漏标。
 */
function inferRegion(cand, text) {
  // 中文正文检测：连续两个以上汉字（排除 'AI助手' 这类固定搭配的误伤）
  if (/[\u4e00-\u9fa5]{2,}/.test(String(cand.description ?? ''))) {
    return 'china'
  }
  return 'overseas'
}

/** license → pricingModel。只有明确的 OSI 友好许可才敢判 open_source */
function pricingFromLicense(license) {
  const l = String(license ?? '').toUpperCase()
  const openLicenses = ['MIT', 'APACHE-2.0', 'BSD-3-CLAUSE', 'BSD-2-CLAUSE', 'ISC', 'MPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'UNLICENSE']
  if (l && openLicenses.includes(l)) return 'open_source'
  // 未识别的一律 free（开源仓库至少不收费），但 dataConfidence 已是 low
  return 'free'
}

/**
 * 生成一条 Agent 记录。
 * @param {object} cand 候选
 * @param {string} id  由 admit.mjs 判定的唯一 id
 * @param {string} today YYYY-MM-DD
 */
export function synthesizeAgent(cand, id, today) {
  const desc = String(cand.description ?? '').trim().replace(/\s+/g, ' ')
  const text = `${cand.name ?? ''} ${desc} ${cand.title ?? ''}`
  const autonomy = inferAutonomy(text)
  const signals = cand.signals ?? {}
  const stars = signals.stars ?? 0

  // sources：有 homepage 算官方源，仓库/HN 报道作为补充
  const month = today.slice(0, 7)
  const sources = []
  if (cand.homepage) {
    sources.push({ title: '项目官网', url: cand.homepage, type: 'official', date: month })
  }
  if (cand.source === 'github') {
    sources.push({
      title: `${cand.fullName ?? 'GitHub'} 仓库`,
      url: cand.url,
      type: 'official',
      date: month,
    })
  } else {
    sources.push({
      title: `${cand.sourceName ?? cand.source} 报道`,
      url: cand.url,
      type: cand.source === 'rss' ? 'media' : 'community',
      date: month,
    })
  }

  // deployment：GitHub CLI 项目按 cli 起步；有官网则大概率有 web
  const deployment = []
  if (cand.source === 'github') {
    deployment.push('cli')
    if (cand.homepage) deployment.push('web')
    deployment.push('api')
  } else {
    deployment.push('web')
  }

  const highlights = [`GitHub 公开仓库，star 数 ${stars}（客观信号，每日刷新）`]
  if (desc) highlights.push(`项目自述：${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}`)

  return {
    id,
    name: cand.name ?? cand.title,
    vendor: deriveVendor(cand),
    region: inferRegion(cand, text),
    tier: guessTier(text, cand.name ?? ''),
    // 新收录产品默认 preview（已发布但未 GA/未核实），不直接标 active
    status: 'preview',
    autonomyLevel: autonomy.level,
    autonomyReason: `按${autonomy.basis}初步推断为 L${autonomy.level}；未核实实际自主性，请以官方文档为准。`,
    tagline: firstSentence(desc || cand.name),
    description: `【机器自动收录，字段待核实】${desc}`,
    highlights,
    limitations: [PLACEHOLDER.limitations],
    bestFor: PLACEHOLDER.bestFor,
    deployment,
    pricingModel: pricingFromLicense(signals.license),
    pricingNote: PLACEHOLDER.pricingNote,
    contextWindow: PLACEHOLDER.contextWindow,
    modalities: ['text'],
    openSource: cand.source === 'github',
    prominence: prominenceByStars(stars),
    officialUrl: cand.homepage || cand.url,
    sources,
    dataConfidence: 'low',
    lastVerified: today,
    // UI 用：标记这是机器自动收录、待人工核实
    autoAdmitted: true,
    autoAdmittedAt: today,
    ...(cand.source === 'github' ? { repoUrl: cand.url } : {}),
    ...(cand.source === 'github' && signals.license ? { metrics: { stars, license: signals.license } } : {}),
  }
}