import alternativesData from '../data/alternatives.json'
import type { AltCategory, AltPlatform, AltPricing, AltRegion, AltTool, AlternativesPayload } from '../types-alternative'

/*
 * 运行时断言：类型断言对 JSON 没有校验力。
 * alternatives.json 是人工维护的静态数据，最可能出的问题是：
 *   1. 手滑导致 category/replaces 等关键字段缺失
 *   2. items 数组为空或被误删
 * 这里只抽查首条的关键字段，把问题从「线上显示空页面」
 * 提前到「dev 立即失败」。完整校验在 npm run validate。
 */
function validateAtRuntime(payload: AlternativesPayload): AltTool[] {
  const list = payload?.items
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('alternatives.json 的 items 字段必须是非空数组')
  }
  const first = list[0]
  if (!first?.id || !first.category || !first.region || !Array.isArray(first.replaces)) {
    throw new Error(
      'alternatives.json 数据非法：第 1 条缺 id / category / region / replaces。请运行 npm run validate'
    )
  }
  return list
}

export const alternatives: AltTool[] = validateAtRuntime(alternativesData as AlternativesPayload)
export const alternativesMeta: AlternativesPayload['meta'] = (alternativesData as AlternativesPayload).meta

/** 场景中文名 */
export const CATEGORY_LABEL: Record<AltCategory, string> = {
  chat: 'AI 对话与助手',
  image: 'AI 生图',
  video: 'AI 视频生成',
  music: 'AI 音乐生成',
  office: 'AI 办公与效率',
  coding: 'AI 编程与开发',
  design: 'AI 设计与 PPT',
  learning: 'AI 学习与教育',
  search: 'AI 搜索与研究',
}

/** 场景顺序，即 UI 筛选 chips 的展示顺序 */
export const CATEGORY_ORDER: AltCategory[] = [
  'chat',
  'image',
  'video',
  'music',
  'office',
  'coding',
  'design',
  'learning',
  'search',
]

/** 地区中文名 */
export const REGION_LABEL: Record<AltRegion, string> = {
  overseas: '海外',
  china: '国产',
}

/** 平台中文名 */
export const PLATFORM_LABEL: Record<AltPlatform, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  api: 'API',
}

/** 定价模式中文名 */
export const PRICING_LABEL: Record<AltPricing, string> = {
  free: '免费',
  freemium: '免费增值',
  subscription: '订阅制',
  usage: '按量计费',
  enterprise: '企业定制',
}

/** 定价模式 chip 颜色 */
export function pricingClass(model: AltPricing): string {
  switch (model) {
    case 'free':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
    case 'freemium':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
    case 'subscription':
    case 'usage':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20'
    case 'enterprise':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20'
    default:
      return 'bg-faint/15 text-muted'
  }
}

/** 搜索：工具名、厂商、场景、描述 */
export function searchAlternatives(list: AltTool[], query: string): AltTool[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const terms = q.split(/\s+/).filter(Boolean)
  return list.filter((item) => {
    const hay = [item.name, item.vendor, item.tagline, item.description, CATEGORY_LABEL[item.category]]
      .join(' ')
      .toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}
