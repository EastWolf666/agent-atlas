/**
 * Agent Atlas 数据结构定义
 *
 * 字段说明见 REQUIREMENTS.md 第2.1 节。
 * 所有数据为人工整理的研究快照，每条均可通过 sources 追溯。
 */

export type Region = 'overseas' | 'china'
export type Tier = 'infrastructure' | 'coding' | 'productivity' | 'platform' | 'vertical'
export type Status = 'active' | 'preview' | 'maintenance' | 'acquired' | 'discontinued'
export type Confidence = 'high' | 'medium' | 'low'
export type Deployment = 'web' | 'app' | 'cli' | 'ide' | 'api' | 'saas' | 'private'
export type PricingModel =
  | 'free'
  | 'freemium'
  | 'subscription'
  | 'usage'
  | 'open_source'
  | 'enterprise'
export type Modality = 'text' | 'image' | 'audio' | 'video' | '3d'
export type ColorMode = 'tier' | 'form' | 'autonomy'

export interface Source {
  title: string
  url: string
  type: 'official' | 'media' | 'community' | 'research'
  date: string
}

export interface Agent {
  id: string
  name: string
  nameZh?: string
  vendor: string
  region: Region
  tier: Tier
  /** 垂直行业子类，仅 tier==='vertical' 时有值 */
  verticalDomain?: string
  status: Status
  /** 1-5，依据 meta.json 的 autonomyLevels 判定标准 */
  autonomyLevel: number
  /** 为什么评这个等级，必须能对照标准 */
  autonomyReason: string
  tagline: string
  description: string
  highlights: string[]
  limitations: string[]
  /** 推荐场景，对比视图会展示 */
  bestFor: string
  deployment: Deployment[]
  pricingModel: PricingModel
  pricingNote: string
  contextWindow: string
  modalities: Modality[]
  openSource: boolean
  /** 相对知名度1-10，用于图谱气泡大小 */
  prominence: number
  officialUrl: string
  sources: Source[]
  dataConfidence: Confidence
  lastVerified: string
  /** 关联的同厂商/同分类条目 id */
  relatedIds?: string[]
}

export interface Meta {
  meta: {
    version: string
    lastUpdated: string
    total: number
    disclaimer: string
    tiers: Record<Tier, { label: string; short: string; desc: string; color: string }>
    autonomyLevels: Record<
      string,
      { label: string; name: string; criteria: string; example: string; benchmark: string }
    >
    statuses: Record<Status, { label: string; desc: string }>
    dataConfidence: Record<Confidence, { label: string; desc: string }>
    deployments: Record<Deployment, { label: string }>
    pricingModels: Record<PricingModel, { label: string }>
    modalities: Record<Modality, { label: string }>
    insights: { text: string; basis: string }[]
  }
}
