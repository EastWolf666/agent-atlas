/**
 * 自动入库判据
 * ================
 * 这个模块决定「一个候选能不能自动写进正式数据 src/data/agents.json」。
 *
 * 为什么要有独立的判据层：
 *   fetch.mjs 的存量刷新走 merge.mjs，只更新 star/许可证这类客观值；
 *   而「把一个全新产品收进来」意味着要生成 autonomyLevel、description、
 *   highlights 等编辑字段——这是 merge.mjs 的 FORBIDDEN 明确禁止的。
 *
 * 所以入库走一条**独立的、可审计的**通道，而不是往白名单里开后门。
 * 本模块只回答一个问题：够不够格？至于「够格之后怎么写」交给 synthesize.mjs。
 *
 * 设计立场：**宁可漏几个边缘新品，也不在正式页面摆明显不靠谱的条目。**
 * 正式数据的读者会拿它做采购/选型参考，垃圾条目的代价远高于漏掉几个。
 */

import { slugify, scoreCandidate, isReviewable } from './filter.mjs'

/**
 * 自动入库的分数门槛。
 *
 * 为什么是 62 而不是在入池线的 35：
 *   入池门槛 35 的定位是「值得人工扫一眼」，判据宽松（宁可多捞）。
 *   入库门槛是「直接出现在正式页面」，判据必须严格得多——
 *   分数构成里 55 分来自关键词、30 分来自热度、15 分来自来源可信度。
 *   62 分意味着：至少命中 3 个 Agent 关键词（30+10+8）**且**有实质热度
 *   （star≥1000 得 15，或 HN≥20 得 3）**且**来源可信度≥8。
 *   实测这档能接住 Pi / DeepSeek Harness 这类真产品，
 *   而挡掉「名字里蹭 agent 的小 repo」。
 */
export const ADMIT_SCORE = 62

/**
 * 描述最小长度：低于此值说明信息不足，无法生成可信条目。
 *
 * 为什么是 25 而不是 40（实测校准）：
 *   近三个月 star 前 30 的 agent 项目里，有 22367 star 的 jev-ultrafast
 *   描述只有 30 字（"Fastest and cheapest web ag…"），按 40 卡就会被误杀——
 *   而它是真实的高质量项目。25 字够生成一句不空洞的 tagline。
 *   低于 25 则基本只剩一个光秃秃的 repo 名，生成出来必然是空话。
 */
const MIN_DESC_LENGTH = 25

/** 热度门槛（信号组 B 用） */
const HOT_STARS = 1500
const HOT_HN_POINTS = 80

/** 新鲜度上限：超过这个天数的产品不算"新发布" */
const FRESH_DAYS = 30

/** 噪声否决词：这些即使高分也不该入库（教程、课程、模板、提示词仓库） */
const ADMIT_NOISE = [
  'tutorial', 'course', 'learn', 'awesome', 'book', 'roadmap', 'interview',
  'cheatsheet', 'prompt collection', 'prompt library', 'templates',
  ' Boilerplate', 'starter template', '简历', '教程', '课程', '学习路线',
  '面试题', ' prompt 集合', '提示词合集', '模板库',
  // 技能/配置合集：名字像 Agent、实际是给 coding agent 装 prompts 的配置仓库
  'skills for', 'agent skills', 'claude code', 'cursor rules', 'instincts',
  'dotfiles', 'system prompt',
]

/**
 * 回溯窗口的老项目 star 门槛。
 *
 * 回溯窗口（pushed:>90天）捞回来的绝大多数是「一直很火的老项目」——
 * crewAI（2023）、TradingAgents（2024）都是这样，它们出现在结果里只是因为
 * star 基数大，不是因为近期发生了什么。这类条目补进来毫无价值：
 * 它们要么早该入库（属于人工补录），要么根本不是 Agent 产品。
 *
 * 真正值得捞的是「仓库存在很久，但最近才突然爆火」——Pi 建仓于 2025-08，
 * 14 个月里从无人问津涨到 11 万 star，这类项目用 created:> 窗口永远抓不到。
 *
 * 为什么门槛定在 30000：
 *   判据本质是「star / 仓库年龄」的比值，但 GitHub search API 只给当前 star，
 *   不给历史增长曲线，没法直接算加速度。所以只能用绝对量级近似：
 *   一个存在 1 年以上的仓库还能有 3 万 star，一定是近期被某个事件引爆的；
 *   而 crewAI(5.9万/3年)、JeecgBoot(4.8万/8年) 这类是「匀速积累型」，
 *   它们 star 高但增速平缓——这类该走人工补录，不该自动进。
 *   30000 是实测卡出来的：能接住 Pi(11万)，能挡住 crewAI/JeecgBoot。
 */
const BACKFILL_HOT_STARS = 30000

/**
 * 回溯入库的仓库年龄上限（按天）。
 *
 * 再老的仓库即使 star 极高也不自动入库：
 *   crewAI 建仓 2023-10，距今近 3 年。这类项目之所以没在库里，
 *   是当初人工选型时漏了，不是脚本该补的——补进来会绕过人工判断，
 *   而且这类项目通常已经有一整套完整文档和社区，
 *   真正需要「快速发现」的从来是近几个月才出现的东西。
 */
const BACKFILL_MAX_AGE_DAYS = 730

/**
 * homepage 不可信域名：指向这些站点说明它不是产品官网。
 *
 * arxiv 是论文预印本——TradingAgents 的 homepage 就是 arxiv PDF。
 * 一个论文链接不能证明「这是个对外发布的产品」，用它冒充官网会把
 * 研究原型当成商业产品摆到页面上。
 */
const UNTRUSTED_HOMEPAGE = ['arxiv.org', 'huggingface.co/papers', 'doi.org', 'wikipedia.org']

/**
 * 归一化域名，用于判断 homepage 是否只是仓库自身的镜像。
 * homepage 若与 repo 同域，说明它不是产品官网，拿不到官方源。
 */
function domainOf(url = '') {
  const m = String(url).match(/^https?:\/\/([^/]+)/i)
  return m ? m[1].toLowerCase().replace(/^www\./, '') : ''
}

/**
 * 判断是否有官方来源。
 *
 * GitHub 仓库的 homepage 字段是「产品官网」——这是 GitHub 源唯一
 * 能拿到一手官方链接的途径。hn/rss 源的 url 本身就是报道/发布页，
 * 只能算媒体或社区源。
 */
function hasOfficialSource(cand) {
  if (!cand.homepage) return false
  if (cand.source !== 'github') return true
  // homepage 指向论文预印本/百科，说明这不是产品官网
  if (UNTRUSTED_HOMEPAGE.some((d) => cand.homepage.toLowerCase().includes(d))) return false
  // github 源：homepage 必须和仓库不同域，否则等于没提供官网
  const repoDomain = domainOf(cand.url)
  return Boolean(cand.homepage) && domainOf(cand.homepage) !== repoDomain
}

/** 判断新鲜度（信号组 B 用） */
function isFresh(cand, now) {
  const t = cand.createdAt ?? cand.pushedAt ?? cand.discoveredAt
  if (!t) return false
  const days = (now.getTime() - new Date(t).getTime()) / 86400000
  return Number.isFinite(days) && days >= 0 && days <= FRESH_DAYS
}

/**
 * 回溯窗口的额外闸门（实测校准，见 github.mjs 的窗口策略说明）。
 *
 * 回溯捞回来的项目分两类，必须区别对待：
 *   a) 最近才建的项目 —— 走正常判据，有官方来源就能入。
 *   b) 建了很久的老项目 —— 只有 star 高到异常（远超该年龄应有的量级）才入，
 *      否则一律拒绝。因为光看 star 高说明不了「最近火的」：
 *      crewAI 59k star 但它2023 年就存在了，那是「一直火」不是「刚火」。
 *
 * 这条闸门直接决定了回溯窗口有没有价值：
 * 没有它，回溯就是在补历史档案（crewAI/TradingAgents 这类该人工补的东西）；
 * 有了它，回溯只捞「突然爆火的老项目」（Pi 这类真正会漏掉的新品）。
 */
function passesBackfillGate(cand, now) {
  const isBackfill = String(cand.queryGroup ?? '').includes('backfill')
  if (!isBackfill) return { ok: true }

  const stars = cand.signals?.stars ?? 0
  const created = cand.createdAt
  if (!created) return { ok: true }

  const ageDays = (now.getTime() - new Date(created).getTime()) / 86400000
  if (!Number.isFinite(ageDays) || ageDays <= FRESH_DAYS) return { ok: true }

  if (ageDays > BACKFILL_MAX_AGE_DAYS) {
    return {
      ok: false,
      why: `仓库年龄超 ${BACKFILL_MAX_AGE_DAYS} 天（建仓${String(created).slice(0, 10)}），属人工补录范围`,
    }
  }
  if (stars < BACKFILL_HOT_STARS) {
    return {
      ok: false,
      why: `老项目未达爆火量级（建仓 ${Math.round(ageDays)} 天，star ${stars} < ${BACKFILL_HOT_STARS}）`,
    }
  }
  return { ok: true }
}

/** 噪声否决 */
function looksLikeNoise(text) {
  const lower = String(text).toLowerCase()
  return ADMIT_NOISE.some((w) => lower.includes(w.toLowerCase()))
}

/**
 * 生成唯一 id。slug 撞现有 id 时追加 -2 / -3 后缀。
 * schema 的 SLUG_RE 只允许小写字母数字连字符，所以这里必须清洗干净。
 */
export function uniqueId(cand, knownIds) {
  let base = slugify(cand.name)
  if (!base) base = slugify(cand.fullName ?? cand.url ?? 'agent')
  if (!base) return null
  if (!knownIds.has(base)) return base
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`
    if (!knownIds.has(candidate)) return candidate
  }
  return null
}

/**
 * 判断单个候选能否入库。
 *
 * @param {object} cand 候选（来自各source）
 * @param {object} ctx  { knownIds:Set, knownUrls:Set, now:Date }
 * @returns {{ok:true, score:number, reason:string}
 *          |{ok:false, score:number, reason:string}}
 */
export function evaluateCandidate(cand, ctx) {
  const { knownIds, knownUrls, now = new Date() } = ctx
  const text = `${cand.name} ${cand.description ?? ''} ${cand.title ?? ''}`

  // 1. 基本形状：必须有名字和 url（url 是 officialUrl 的来源，缺了无法入库）
  if (!cand.name && !cand.title) return { ok: false, score: 0, reason: '无名称' }
  if (!cand.url) return { ok: false, score: 0, reason: '无链接' }

  // 2. 去重：已在库里的不重复收
  const url = String(cand.url).replace(/\/$/, '')
  if (knownUrls.has(url) || knownUrls.has(String(cand.url))) {
    return { ok: false, score: 0, reason: '链接已在库' }
  }

  // 3. 复用现有质量门槛（挡新闻/公告/无法判断的条目）
  if (!isReviewable({ title: cand.name ?? cand.title, description: cand.description })) {
    return { ok: false, score: 0, reason: '不可判断（新闻/公告/描述不足）' }
  }

  // 4. 描述长度：HN 源从不填 description，空描述直接淘汰
  const desc = String(cand.description ?? '').trim()
  if (desc.length < MIN_DESC_LENGTH) {
    return { ok: false, score: 0, reason: `描述不足 ${MIN_DESC_LENGTH} 字` }
  }

  // 5. 分数门槛
  const score = scoreCandidate({
    title: cand.name ?? cand.title,
    description: desc,
    signals: cand.signals ?? {},
    sourceType: cand.source,
  })
  if (score < ADMIT_SCORE) {
    return { ok: false, score, reason: `分数 ${score} < ${ADMIT_SCORE}` }
  }

  // 6. 噪声否决
  if (looksLikeNoise(text)) {
    return { ok: false, score, reason: '疑似教程/资源合集' }
  }

  // 6.5 回溯窗口闸门：老项目必须 star 异常高才认定为「近期爆火」
  const backfill = passesBackfillGate(cand, now)
  if (!backfill.ok) {
    return { ok: false, score, reason: backfill.why }
  }

  // 7. 信号组合：官方来源(A) 或 热度达标(B)，满足其一
  const official = hasOfficialSource(cand)
  const signals = cand.signals ?? {}
  const hot = (signals.stars >= HOT_STARS || signals.hnPoints >= HOT_HN_POINTS) && isFresh(cand, now)
  if (!official && !hot) {
    const why = `无官方来源${cand.homepage ? '' : '（homepage 为空）'}，热度未达标（star ${signals.stars ?? 0} / hn ${signals.hnPoints ?? 0}）`
    return { ok: false, score, reason: why }
  }

  // 8. id 唯一性
  const id = uniqueId(cand, knownIds)
  if (!id) return { ok: false, score, reason: '无法生成唯一 id' }

  const basis = official ? '有官方来源' : `热度达标（star ${signals.stars ?? 0} / hn ${signals.hnPoints ?? 0}）`
  return { ok: true, score, id, reason: `分数 ${score}，${basis}` }
}

/**
 * 批量筛选：返回可入库的候选 + 拒绝原因统计。
 * 按分数降序，同分按 id 字典序（保证幂等：两次运行顺序一致）。
 */
export function selectAdmissible(candidates, ctx) {
  const accepted = []
  const rejected = []
  // 边筛边扩充 knownIds，保证同一批里两个同名候选不会都拿到同一个 id
  const workingIds = new Set(ctx.knownIds)

  for (const cand of candidates) {
    const verdict = evaluateCandidate(cand, { ...ctx, knownIds: workingIds })
    if (verdict.ok) {
      workingIds.add(verdict.id)
      accepted.push({ cand, ...verdict })
    } else {
      rejected.push({ cand, ...verdict })
    }
  }

  accepted.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return { accepted, rejected }
}

/** 汇总拒绝原因 TOP N，用于每日报告 */
export function rejectionSummary(rejected, topN = 3) {
  const counts = new Map()
  for (const r of rejected) {
    // 把数字归一化，避免"分数 60 < 62"和"分数 55 < 62"算两类
    const key = r.reason.replace(/\d+/g, 'N').replace(/（[^）]*）/g, '')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([reason, count]) => ({ reason, count }))
}