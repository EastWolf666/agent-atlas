import agentsData from '../data/agents.json'
import metaData from '../data/meta.json'
import type { Agent, Meta, Tier, Status, Confidence } from '../types'

/*
 * 为什么不直接 `as Agent[]`：
 * 类型断言对 JSON 里的数据没有任何校验力，agents.json 一旦被写坏
 * （尤其是 tier/status 写出枚举外的值），编译照过，运行时才炸——
 * FilterPanel 渲染 meta.tiers[t].label 时抛 TypeError，整页白屏。
 * 数据源是「人工维护 + 每日自动更新」的混合体，这类问题迟早会发生。
 *
 * 完整校验在 scripts/lib/schema.mjs（npm run validate，构建前自动跑）。
 * 这里只做一次运行时断言兜底：结构明显不对就直接抛错，
 * 把问题从「线上白屏」提前到「dev 立即失败」。
 */
const RAW_TIERS = ['infrastructure', 'coding', 'productivity', 'platform', 'vertical'] as const
const RAW_STATUSES = ['active', 'preview', 'maintenance', 'acquired', 'discontinued'] as const

function validateAtRuntime(list: unknown): Agent[] {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('agents.json 根节点必须是非空数组')
  }
  // 只抽查第一条：全量校验交给 npm run validate，这里只求「快速失败」
  const first = list[0] as Partial<Agent>
  for (const [field, dict] of [
    ['tier', RAW_TIERS],
    ['status', RAW_STATUSES],
  ] as const) {
    const v = first[field]
    if (typeof v !== 'string' || !(dict as readonly string[]).includes(v)) {
      throw new Error(
        `agents.json 数据非法：第 1 条的 ${field} = ${JSON.stringify(v)}，不在允许范围内。[${dict.join(', ')}]。` +
          `请运行 npm run validate 查看全部问题`
      )
    }
  }
  return list as Agent[]
}

export const agents: Agent[] = validateAtRuntime(agentsData)
export const meta: Meta['meta'] = (metaData as Meta).meta

export const TIER_ORDER: Tier[] = [
  'infrastructure',
  'coding',
  'productivity',
  'platform',
  'vertical',
]

export const STATUS_ORDER: Status[] = [
  'active',
  'preview',
  'maintenance',
  'acquired',
  'discontinued',
]

export const CONFIDENCE_ORDER: Confidence[] = ['high', 'medium', 'low']

/** 自主性等级的颜色：越高越"暖"，表示能力越强 */
export const AUTONOMY_COLORS: Record<number, string> = {
  1: '#94a3b8',
  2: '#60a5fa',
  3: '#34d399',
  4: '#fbbf24',
  5: '#f472b6',
}

export const AUTONOMY_LEVELS = [1, 2, 3, 4, 5] as const

/** 部署形态的归类，用于图谱的 Form 着色 */
export type Form = 'consumer' | 'devtool' | 'platform' | 'private' | 'vertical'

export const FORM_META: Record<Form, { label: string; color: string }> = {
  consumer: { label: '消费级', color: '#06b6d4' },
  devtool: { label: '开发者工具', color: '#3b82f6' },
  platform: { label: '平台', color: '#f59e0b' },
  private: { label: '私有化', color: '#8b5cf6' },
  vertical: { label: '垂直行业', color: '#ec4899' },
}

/** 根据部署形态与分类推导 Form，决定图谱的第三种着色维度 */
export function formOf(a: Agent): Form {
  if (a.tier === 'vertical') return 'vertical'
  if (a.tier === 'platform') return 'platform'
  if (a.tier === 'infrastructure') return 'devtool'
  if (a.deployment.includes('private')) return 'private'
  if (
    a.deployment.includes('ide') ||
    a.deployment.includes('cli') ||
    a.tier === 'coding'
  )
    return 'devtool'
  return 'consumer'
}

export function tierLabel(t: Tier): string {
  return meta.tiers[t].label
}

export function tierColor(t: Tier): string {
  return meta.tiers[t].color
}

export function statusLabel(s: Status): string {
  return meta.statuses[s].label
}

export function confidenceLabel(c: Confidence): string {
  return meta.dataConfidence[c].label
}

export function pricingLabel(p: Agent['pricingModel']): string {
  return meta.pricingModels[p].label
}

export function deploymentLabel(d: Agent['deployment'][number]): string {
  return meta.deployments[d]?.label ?? d
}

export function modalityLabel(m: Agent['modalities'][number]): string {
  return meta.modalities[m]?.label ?? m
}

/** 关联产品：优先用显式 relatedIds，其次按同 Tier 补足 */
export function relatedAgents(a: Agent, limit = 4): Agent[] {
  const byId = new Map(agents.map((x) => [x.id, x]))
  const explicit = (a.relatedIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Agent[]
  if (explicit.length >= limit) return explicit.slice(0, limit)

  const seen = new Set([a.id, ...explicit.map((x) => x.id)])
  const fillers = agents.filter(
    (x) => !seen.has(x.id) && (x.tier === a.tier || x.vendor === a.vendor)
  )
  return [...explicit, ...fillers].slice(0, limit)
}

/** 搜索：匹配名称、中文名、厂商、标语、标签 */
export function searchAgents(list: Agent[], query: string): Agent[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const terms = q.split(/\s+/).filter(Boolean)
  return list.filter((a) => {
    const haystack = [
      a.name,
      a.nameZh ?? '',
      a.vendor,
      a.tagline,
      a.bestFor,
      ...a.highlights,
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}
