import agentsData from '../data/agents.json'
import metaData from '../data/meta.json'
import type { Agent, Meta, Tier, Status, Confidence } from '../types'

export const agents = agentsData as Agent[]
export const meta = (metaData as Meta).meta

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
