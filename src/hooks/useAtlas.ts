import { useCallback, useEffect, useMemo, useState } from 'react'
import { agents as allAgents, searchAgents } from '../lib/agents'
import type { Agent, Tier, Modality, Deployment, PricingModel } from '../types'

export interface Filters {
  query: string
  regions: Set<'overseas' | 'china'>
  tiers: Set<Tier>
  /** 自主性下限：0 表示不限制，1–5 表示「L{n} 及以上」 */
  autonomyMin: number
  deployments: Set<Deployment>
  modalities: Set<Modality>
  pricing: Set<PricingModel>
  openSourceOnly: boolean
  /** 仅看非活跃状态（status !== 'active'） */
  nonActiveOnly: boolean
  /** 仅看脚本自动收录、尚未人工核实的条目 */
  autoAdmittedOnly: boolean
}

const EMPTY: Filters = {
  query: '',
  regions: new Set(),
  tiers: new Set(),
  autonomyMin: 0,
  deployments: new Set(),
  modalities: new Set(),
  pricing: new Set(),
  openSourceOnly: false,
  nonActiveOnly: false,
  autoAdmittedOnly: false,
}

/**
 * 单选切换：再次点击同一项则取消选择。
 * 这些维度（地区/分类/部署/模态/价格）本质互斥——同时选「国内+海外」
 * 恒等于全选，选项失去意义；用单选让每个按钮都有明确语义。
 */
function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set<T>()
  if (!set.has(value)) next.add(value)
  return next
}

/** 把筛选状态编码进 URL，分享链接时能还原视图 */
function encodeToUrl(f: Filters): string {
  const p = new URLSearchParams()
  if (f.query) p.set('q', f.query)
  if (f.regions.size) p.set('region', [...f.regions].join(','))
  if (f.tiers.size) p.set('tier', [...f.tiers].join(','))
  if (f.autonomyMin > 0) p.set('lvl', String(f.autonomyMin))
  if (f.deployments.size) p.set('dep', [...f.deployments].join(','))
  if (f.modalities.size) p.set('mod', [...f.modalities].join(','))
  if (f.pricing.size) p.set('price', [...f.pricing].join(','))
  if (f.openSourceOnly) p.set('oss', '1')
  if (f.nonActiveOnly) p.set('na', '1')
  if (f.autoAdmittedOnly) p.set('auto', '1')
  return p.toString()
}

function decodeFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search)
  const lvl = Number(p.get('lvl'))
  const set = <T extends string>(v: string | null): Set<T> =>
    // 兼容旧链接里逗号分隔的多值：只取第一项，实现单选语义
    new Set(v ? ([v.split(',').filter(Boolean)[0]] as T[]).filter(Boolean) : [])

  return {
    query: p.get('q') ?? '',
    regions: set<'overseas' | 'china'>(p.get('region')),
    tiers: set<Tier>(p.get('tier')),
    autonomyMin: Number.isInteger(lvl) && lvl >= 1 && lvl <= 5 ? lvl : 0,
    deployments: set<Deployment>(p.get('dep')),
    modalities: set<Modality>(p.get('mod')),
    pricing: set<PricingModel>(p.get('price')),
    openSourceOnly: p.get('oss') === '1',
    nonActiveOnly: p.get('na') === '1',
    autoAdmittedOnly: p.get('auto') === '1',
  }
}

export function useFilters() {
  const [filters, setFilters] = useState<Filters>(decodeFromUrl)

  // 筛选变化时同步 URL（replace 避免污染浏览历史）
  useEffect(() => {
    const qs = encodeToUrl(filters)
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [filters])

  const reset = useCallback(() => setFilters(EMPTY), [])

  const results = useMemo(() => {
    let list = searchAgents(allAgents, filters.query)

    if (filters.regions.size) {
      list = list.filter((a) => filters.regions.has(a.region))
    }
    if (filters.tiers.size) {
      list = list.filter((a) => filters.tiers.has(a.tier))
    }
    if (filters.autonomyMin > 0) {
      list = list.filter((a) => a.autonomyLevel >= filters.autonomyMin)
    }
    if (filters.deployments.size) {
      list = list.filter((a) => a.deployment.some((d) => filters.deployments.has(d)))
    }
    if (filters.modalities.size) {
      list = list.filter((a) => a.modalities.some((m) => filters.modalities.has(m)))
    }
    if (filters.pricing.size) {
      list = list.filter((a) => filters.pricing.has(a.pricingModel))
    }
    if (filters.openSourceOnly) {
      list = list.filter((a) => a.openSource)
    }
    if (filters.nonActiveOnly) {
      list = list.filter((a) => a.status !== 'active')
    }
    if (filters.autoAdmittedOnly) {
      list = list.filter((a) => a.autoAdmitted === true)
    }
    return list
  }, [filters])

  const activeCount =
    (filters.query ? 1 : 0) +
    filters.regions.size +
    filters.tiers.size +
    filters.deployments.size +
    filters.modalities.size +
    filters.pricing.size +
    (filters.openSourceOnly ? 1 : 0) +
    (filters.nonActiveOnly ? 1 : 0) +
    (filters.autoAdmittedOnly ? 1 : 0) +
    (filters.autonomyMin > 0 ? 1 : 0)

  return {
    filters,
    setFilters,
    results,
    activeCount,
    reset,
    setQuery: (query: string) => setFilters((f) => ({ ...f, query })),
    toggleRegion: (r: 'overseas' | 'china') =>
      setFilters((f) => ({ ...f, regions: toggle(f.regions, r) })),
    toggleTier: (t: Tier) => setFilters((f) => ({ ...f, tiers: toggle(f.tiers, t) })),
    toggleDeployment: (d: Deployment) =>
      setFilters((f) => ({ ...f, deployments: toggle(f.deployments, d) })),
    toggleModality: (m: Modality) =>
      setFilters((f) => ({ ...f, modalities: toggle(f.modalities, m) })),
    togglePricing: (p: PricingModel) =>
      setFilters((f) => ({ ...f, pricing: toggle(f.pricing, p) })),
    /** 传入 0 或当前值则取消限制 */
    setMinAutonomy: (n: number) =>
      setFilters((f) => ({ ...f, autonomyMin: n })),
    toggleOpenSource: () =>
      setFilters((f) => ({ ...f, openSourceOnly: !f.openSourceOnly })),
    toggleNonActive: () =>
      setFilters((f) => ({ ...f, nonActiveOnly: !f.nonActiveOnly })),
    toggleAutoAdmitted: () =>
      setFilters((f) => ({ ...f, autoAdmittedOnly: !f.autoAdmittedOnly })),
  }
}

/** 对比选择：最多 4 个 */
export function useCompare() {
  const [selected, setSelected] = useState<string[]>([])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 4) return prev
      return [...prev, id]
    })
  }, [])

  const clear = useCallback(() => setSelected([]), [])

  const isFull = selected.length >= 4
  const agents_ = useMemo(
    () => selected.map((id) => allAgents.find((a) => a.id === id)!).filter(Boolean),
    [selected]
  )

  return { selected, agents: agents_, toggle, clear, isFull }
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-transition')
    root.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('aa-theme', theme)
    } catch {
      /* 隐私模式下 localStorage 不可用，忽略 */
    }
    const t = setTimeout(() => root.classList.remove('theme-transition'), 250)
    return () => clearTimeout(t)
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}

export type { Agent }
