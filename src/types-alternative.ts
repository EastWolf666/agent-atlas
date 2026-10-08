export type AltRegion = 'overseas' | 'china'

/** 9 个功能场景，顺序即 UI 筛选/分组顺序 */
export type AltCategory =
  | 'chat'
  | 'image'
  | 'video'
  | 'music'
  | 'office'
  | 'coding'
  | 'design'
  | 'learning'
  | 'search'

export type AltPlatform = 'web' | 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'api'

export type AltPricing = 'free' | 'freemium' | 'subscription' | 'usage' | 'enterprise'

export interface AltTool {
  /** URL-safe slug，全局唯一 */
  id: string
  /** 产品名称 */
  name: string
  /** 厂商/出品方 */
  vendor: string
  /** 国内或海外 */
  region: AltRegion
  /** 功能场景 */
  category: AltCategory
  /** 一句话定位，卡片直接展示 */
  tagline: string
  /** 2-4 句详情，浮层展示 */
  description: string
  /** 官方网站 */
  officialUrl: string
  /** 定价模式 */
  pricingModel: AltPricing
  /** 人话定价说明，如「免费；Pro ¥20/月」 */
  pricingNote: string
  /** 支持平台 */
  platforms: AltPlatform[]
  /** 核心卖点 2-4 条 */
  highlights: string[]
  /**
   * 替代关系：国产条目对应海外工具 id 列表；海外条目为空数组。
   * 这是本页核心关系——场景内国际↔国产配对全靠它。
   */
  replaces: string[]
  /** 信息图转录后逐条核对官网的日期，YYYY-MM-DD 或 YYYY-MM */
  lastVerified: string
}

export interface AlternativesMeta {
  lastUpdated: string
  source: string
  disclaimer: string
  total: number
}

export interface AlternativesPayload {
  meta: AlternativesMeta
  items: AltTool[]
}

export interface SchemaIssue {
  where: string
  msg: string
}
