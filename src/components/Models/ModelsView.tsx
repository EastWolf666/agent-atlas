import { useEffect, useMemo, useState } from 'react'
import {
  models,
  modelsMeta,
  compactTokens,
  priceLabel,
  modalityLabel,
  MODALITY_LABEL,
} from '../../lib/models'
import type { LLMModel, ModelSortKey } from '../../types-model'
import { AutoBadge } from '../bits'

/*
 * 本模块由 index.tsx 动态 import，只有切到「模型」标签页才会下载。
 * 396KB 的模型数据不进首屏 bundle —— 绝大多数访客是来看 Agent 的，
 * 不该替他们白下载一半体积。
 */

/*
 * 模型页布局：卡片网格 ↔ 表格 双视图切换。
 *
 * 为什么两种都要：
 *   卡片适合浏览——一次看十几个模型的「上下文 / 价格 / 模态」概览，
 *     但精确比较两个模型的价格时，数字不对齐的眼睛很难比。
 *   表格适合比较——列对齐、单价直接可比、点击表头排序。
 *   所以做成可切换而不是二选一：先浏览再比，是选型时的实际流程。
 */

type ViewMode = 'grid' | 'table'

/** 排序状态：key + 是否降序。默认按发布时间倒序（新的在前） */
interface SortState {
  key: ModelSortKey
  desc: boolean
}

/**
 * 排序选项，同时用于表格表头。
 *
 * 顺序即表格列顺序，必须和 tbody 里的列一一对应。
 * 之前这里多放了 'name' 和 'vendor' 两个不可见列的排序项，
 * 结果表头「名称」渲染出来是空按钮（因为排序项按名称取字），
 * 而 tbody 的名称列又渲染了一次「发布」——表头和数据对不上。
 * 所以这份列表现在就是唯一真相：表头按它渲染，数据列也按它对齐。
 */
const SORT_OPTIONS: { key: ModelSortKey; label: string; title: string }[] = [
  { key: 'name', label: '名称', title: '按模型名称排序' },
  { key: 'vendor', label: '厂商', title: '按厂商排序' },
  { key: 'contextWindow', label: '上下文', title: '按上下文窗口长度排序' },
  { key: 'priceInput', label: '输入价', title: '按每百万token 输入价排序' },
  { key: 'priceOutput', label: '输出价', title: '按每百万 token 输出价排序' },
  { key: 'intelligence', label: '智能', title: '按综合智能指数排序（第三方评测）' },
  { key: 'agentic', label: 'Agent', title: '按 Agent 能力指数排序（第三方评测）' },
  { key: 'releasedAt', label: '发布', title: '按发布时间排序，新的在前' },
]

/** 表格里固定展示、不参与排序的列 */
const TABLE_EXTRA_COLUMNS = [
  { label: '地区', title: '国内 / 海外' },
  { label: '模态', title: '支持的输入模态' },
] as const

const SORTS: Record<ModelSortKey, (m: LLMModel) => number | string | null> = {
  name: (m) => m.name.toLowerCase(),
  vendor: (m) => m.vendor.toLowerCase(),
  releasedAt: (m) => m.releasedAt,
  contextWindow: (m) => m.contextWindow,
  priceInput: (m) => m.priceInput,
  priceOutput: (m) => m.priceOutput,
  intelligence: (m) => m.scores?.intelligence ?? null,
  agentic: (m) => m.scores?.agentic ?? null,
}

function sortModels(list: LLMModel[], { key, desc }: SortState): LLMModel[] {
  const get = SORTS[key]
  const sorted = [...list].sort((a, b) => {
    const va = get(a)
    const vb = get(b)
    // null恒排最后：没有跑分的模型不该因为 null < 数字就排到最前面，
    // 那会让「按智能指数排序」看起来像「没数据的最强」
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb))
    }
    return va - vb
  })
  return desc ? sorted.reverse() : sorted
}

/** 厂商 chip 的配色：按 slug 稳定散列，同厂商永远同色 */
function vendorColor(slug: string): string {
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1']
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs text-faint">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs font-semibold tabular-nums" title={hint ?? value}>
        {value}
      </p>
    </div>
  )
}

/** 一行模态标签，file 之类的用灰色区分 */
function ModalityTags({ input }: { input: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {input.map((m) => (
        <span
          key={m}
          className={`aa-chip text-[10px] ${
            m === 'text' ? 'bg-faint/15 text-muted' : 'bg-brand-soft text-brand'
          }`}
          title={`支持${MODALITY_LABEL[m] ?? m}输入`}
        >
          {MODALITY_LABEL[m] ?? m}
        </span>
      ))}
    </div>
  )
}

export default function ModelsView() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortState>({ key: 'releasedAt', desc: true })
  const [region, setRegion] = useState<'all' | 'china' | 'overseas'>('all')
  const [modal, setModal] = useState<Set<string>>(new Set())
  const [openWeightsOnly, setOpenWeightsOnly] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [batchOnly, setBatchOnly] = useState(false)
  const [routerOnly, setRouterOnly] = useState(false)
  const [detail, setDetail] = useState<LLMModel | null>(null)

  /*
   * Escape 关闭详情浮层。
   *
   * 少了这个会出现很典型的「死循环」：详情是 fixed 浮层，
   * 关不掉就只能刷新页面，而页面状态（筛选、排序、视图模式）全部丢失。
   * 浮层的语义是「临时看一眼」，Escape 是这类浮层的通用退出键，
   * 不用也得有——这不是快捷键偏好问题，是可用性问题。
   */
  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [detail])

  const stats = useMemo(() => {
    const cn = models.filter((m) => m.region === 'china').length
    const priced = models.filter((m) => !m.isRouter)
    return {
      total: models.length,
      cn,
      overseas: models.length - cn,
      vendors: new Set(models.map((m) => m.vendorSlug)).size,
      openWeights: models.filter((m) => m.openWeights).length,
      free: priced.filter((m) => m.priceInput === 0).length,
      multimodal: models.filter((m) => m.isMultimodal).length,
      routers: models.filter((m) => m.isRouter).length,
      batches: models.filter((m) => m.isBatch).length,
      maxContext: Math.max(...models.map((m) => m.contextWindow ?? 0)),
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const terms = q.split(/\s+/).filter(Boolean)
    let list = models.filter((m) => {
      if (region !== 'all' && m.region !== region) return false
      if (modal.size > 0 && !m.inputModalities.some((x) => modal.has(x))) return false
      if (openWeightsOnly && !m.openWeights) return false
      if (freeOnly && m.priceInput !== 0) return false
      if (batchOnly && !m.isBatch) return false
      if (routerOnly && !m.isRouter) return false
      if (terms.length > 0) {
        const hay = [m.name, m.vendor, m.openRouterId, m.description].join(' ').toLowerCase()
        if (!terms.every((t) => hay.includes(t))) return false
      }
      return true
    })
    list = sortModels(list, sort)
    return list
  }, [query, region, modal, openWeightsOnly, freeOnly, batchOnly, routerOnly, sort])

  const activeCount =
    (region !== 'all' ? 1 : 0) +
    modal.size +
    (openWeightsOnly ? 1 : 0) +
    (freeOnly ? 1 : 0) +
    (batchOnly ? 1 : 0) +
    (routerOnly ? 1 : 0)

  const toggleSort = (key: ModelSortKey) => {
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))
  }

  const toggleModal = (m: string) => {
    setModal((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  const reset = () => {
    setQuery('')
    setRegion('all')
    setModal(new Set())
    setOpenWeightsOnly(false)
    setFreeOnly(false)
    setBatchOnly(false)
    setRouterOnly(false)
  }

  return (
    <section className="space-y-4">
      {/* 标题区 */}
      <div className="animate-fade-in">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          大模型选型对比
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted">
          收录 <strong className="text-ink">{stats.total}</strong> 个可经 API 调用的模型，
          按<strong className="text-ink">价格</strong>、<strong className="text-ink">上下文长度</strong>、
          <strong className="text-ink">模态</strong>横向对比，帮你在选型时快速定位合适的模型。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted">
          <span className="aa-chip bg-faint/15">数据更新 {modelsMeta.lastUpdated}</span>
          <span className="aa-chip bg-faint/15">{stats.vendors} 家厂商</span>
          <span className="aa-chip bg-faint/15">
            {stats.cn} 国内 / {stats.overseas} 海外
          </span>
          <span className="aa-chip border border-brand/40 text-brand">
            上下文最长 {compactTokens(stats.maxContext)}
          </span>
          <AutoBadge
            detail="价格、上下文窗口与跑分均来自 OpenRouter 聚合数据，未经厂商官方确认，签约前请以官方定价页为准"
          />
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid animate-fade-in grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">收录模型</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{stats.total}</p>
          <p className="mt-0.5 text-2xs text-faint">{stats.vendors} 家厂商</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">国内模型</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-brand">
            {stats.cn}
          </p>
          <p className="mt-0.5 text-2xs text-faint">占 {Math.round((stats.cn / stats.total) * 100)}%</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">开源权重</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.openWeights}
          </p>
          <p className="mt-0.5 text-2xs text-faint">可自部署</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">完全免费</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.free}
          </p>
          <p className="mt-0.5 text-2xs text-faint">{stats.multimodal} 个支持多模态</p>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="aa-card animate-fade-in space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id="aa-model-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型名、厂商或描述…"
              className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs outline-none transition-colors placeholder:text-faint focus:border-brand"
            />
          </div>

          {/* 视图切换 */}
          <div className="flex shrink-0 rounded-lg border border-edge p-0.5">
            {(
              [
                ['grid', '卡片'],
                ['table', '表格'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                aria-pressed={mode === k}
                className={`rounded-md px-2.5 py-1 text-2xs font-medium transition-colors ${
                  mode === k ? 'bg-brand text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* 地区 */}
          {(
            [
              ['all', '全部地区'],
              ['china', '国内'],
              ['overseas', '海外'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRegion(k)}
              aria-pressed={region === k}
              className={`aa-chip transition-colors ${
                region === k ? 'bg-brand text-white' : 'bg-faint/15 text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}

          <span className="mx-1 h-3.5 w-px bg-edge" aria-hidden />

          {/* 模态（多选） */}
          {(['image', 'audio', 'video', 'file'] as const).map((m) => (
            <button
              key={m}
              onClick={() => toggleModal(m)}
              aria-pressed={modal.has(m)}
              className={`aa-chip transition-colors ${
                modal.has(m)
                  ? 'bg-brand-soft text-brand'
                  : 'bg-faint/15 text-muted hover:text-ink'
              }`}
            >
              {MODALITY_LABEL[m]}
            </button>
          ))}

          <span className="mx-1 h-3.5 w-px bg-edge" aria-hidden />

          <ToggleChip on={openWeightsOnly} onClick={() => setOpenWeightsOnly((v) => !v)}>
            开源权重
          </ToggleChip>
          <ToggleChip on={freeOnly} onClick={() => setFreeOnly((v) => !v)}>
            免费
          </ToggleChip>
          <ToggleChip on={batchOnly} onClick={() => setBatchOnly((v) => !v)}>
            批处理 {stats.batches}
          </ToggleChip>
          <ToggleChip on={routerOnly} onClick={() => setRouterOnly((v) => !v)}>
            路由器 {stats.routers}
          </ToggleChip>

          {activeCount > 0 && (
            <button
              onClick={reset}
              className="aa-chip text-muted transition-colors hover:text-brand"
            >
              清空筛选 ({activeCount})
            </button>
          )}

          <span className="ml-auto text-2xs text-faint">
            命中 <strong className="font-mono text-ink">{filtered.length}</strong> / {stats.total}
          </span>
        </div>
      </div>

      {/* 排序条 */}
      <div className="flex animate-fade-in flex-wrap items-center gap-1.5 text-2xs">
        <span className="text-faint">排序</span>
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => toggleSort(o.key)}
            title={o.title}
            aria-pressed={sort.key === o.key}
            className={`aa-chip transition-colors ${
              sort.key === o.key ? 'bg-brand-soft text-brand' : 'bg-faint/15 text-muted hover:text-ink'
            }`}
          >
            {o.label}
            {sort.key === o.key && <span className="ml-0.5">{sort.desc ? '↓' : '↑'}</span>}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <div className="aa-card p-10 text-center">
          <p className="text-sm text-muted">没有符合条件的模型</p>
          <button onClick={reset} className="mt-3 aa-chip bg-brand text-white hover:opacity-90">
            清空筛选
          </button>
        </div>
      ) : mode === 'grid' ? (
        <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.slice(0, 120).map((m) => (
            <ModelCard key={m.id} model={m} onOpen={() => setDetail(m)} />
          ))}
        </div>
      ) : (
        <div className="aa-card animate-fade-in overflow-x-auto p-0">
          <table className="w-full min-w-[1000px] text-xs">
            <thead>
              <tr className="border-b border-edge text-left text-2xs text-muted">
                {/*
                  表头列与下方 tbody 的 <td> 严格一一对应：
                  8 个可排序列 + 2 个固定列，共 10 列。
                  之前这里渲染 SORT_OPTIONS（8项）却又在后面补了「模态」「发布」，
                  而 tbody 里还额外插了「地区」列——表头与数据错位两列，
                  且「发布」出现两次。加固定列时务必同步 tbody。
                */}
                {SORT_OPTIONS.map((o, i) => (
                  <th key={o.key} className="whitespace-nowrap px-3 py-2 font-medium">
                    <button
                      onClick={() => toggleSort(o.key)}
                      title={o.title}
                      className={`inline-flex items-center gap-0.5 transition-colors hover:text-brand ${
                        sort.key === o.key ? 'text-brand' : ''
                      }`}
                    >
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          {o.label}
                          <span className="size-2 shrink-0 rounded-full bg-faint/40" aria-hidden />
                        </span>
                      ) : (
                        o.label
                      )}
                      {sort.key === o.key && <span>{sort.desc ? '↓' : '↑'}</span>}
                    </button>
                  </th>
                ))}
                {TABLE_EXTRA_COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    title={c.title}
                    className="whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 150).map((m) => (
                <tr
                  key={m.id}
                  onClick={() => setDetail(m)}
                  className="cursor-pointer border-b border-edge/60 transition-colors last:border-0 hover:bg-faint/10"
                >
                  {/* 名称 */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: vendorColor(m.vendorSlug) }}
                        aria-hidden
                      />
                      <span className="font-medium">{m.name}</span>
                      {m.isRouter && (
                        <span className="aa-chip bg-faint/15 text-[10px] text-muted">路由器</span>
                      )}
                      {m.isBatch && (
                        <span className="aa-chip bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-400">
                          批处理
                        </span>
                      )}
                      {m.openWeights && (
                        <span className="aa-chip bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                          开源
                        </span>
                      )}
                    </div>
                  </td>
                  {/* 厂商 */}
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{m.vendor}</td>
                  {/* 上下文 */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {compactTokens(m.contextWindow)}
                  </td>
                  {/* 输入价 */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {m.isRouter ? (
                      <span className="text-faint">按实际转发计费</span>
                    ) : (
                      priceLabel(m.priceInput)
                    )}
                  </td>
                  {/* 输出价 */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {m.isRouter ? '—' : priceLabel(m.priceOutput)}
                  </td>
                  {/* 智能指数 */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {m.scores?.intelligence ?? <span className="text-faint">—</span>}
                  </td>
                  {/* Agent 指数 */}
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">
                    {m.scores?.agentic ?? <span className="text-faint">—</span>}
                  </td>
                  {/* 发布 */}
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{m.releasedAt ?? '—'}</td>
                  {/* 固定列：地区 */}
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {m.region === 'china' ? <span className="text-brand">国内</span> : '海外'}
                  </td>
                  {/* 固定列：模态 */}
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {modalityLabel(m.inputModalities)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > (mode === 'grid' ? 120 : 150) && (
        <p className="text-center text-2xs text-faint">
          仅显示前 {mode === 'grid' ? 120 : 150} 条（共 {filtered.length} 条），
          用搜索或筛选缩小范围
        </p>
      )}

      <p className="animate-fade-in text-2xs leading-relaxed text-faint">
        {modelsMeta.disclaimer}
      </p>

      {detail && <ModelDetail model={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

function ToggleChip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`aa-chip transition-colors ${
        on ? 'bg-brand-soft text-brand' : 'bg-faint/15 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ModelCard({ model: m, onOpen }: { model: LLMModel; onOpen: () => void }) {
  const color = vendorColor(m.vendorSlug)
  return (
    <article
      className="aa-card group relative flex cursor-pointer flex-col p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-sm"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-brand">
            {m.name}
          </h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-muted">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="truncate">{m.vendor}</span>
            <span className="text-faint">·</span>
            <span className={m.region === 'china' ? 'text-brand' : ''}>
              {m.region === 'china' ? '国内' : '海外'}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex gap-1">
            {m.openWeights && (
              <span className="aa-chip bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                开源
              </span>
            )}
            {/*
              批处理角标必须显眼：同一模型的标准版与 batch 版
              在 467 条里名字只差一个后缀，不标记的话用户会当成重复数据。
              tooltip 说清成本差异，这才是它值得单独占一行存在的理由。
            */}
            {m.isBatch && (
              <span
                className="aa-chip bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-400"
                title="批处理通道：能力与标准版相同，价格通常低约50%，但为异步提交、不可中断"
              >
                批处理
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-2xs leading-relaxed text-faint">
        {m.description || '（该模型未提供描述）'}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="上下文" value={compactTokens(m.contextWindow)} />
        <Stat
          label="输入/百万"
          value={m.isRouter ? '浮动' : priceLabel(m.priceInput)}
          hint={m.isRouter ? '路由器按实际转发计费' : undefined}
        />
        <Stat label="输出/百万" value={m.isRouter ? '—' : priceLabel(m.priceOutput)} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <ModalityTags input={m.inputModalities} />
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {m.releasedAt ?? ''}
        </span>
      </div>

      {m.isRouter && (
        <p className="mt-2 border-t border-dashed border-edge pt-2 text-[10px] leading-relaxed text-faint">
          这是模型路由器/自动选型服务，不是模型本体，价格随实际转发目标浮动
        </p>
      )}
    </article>
  )
}

function ModelDetail({ model: m, onClose }: { model: LLMModel; onClose: () => void }) {
  return (
    <>
    <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${m.name} 详情`}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg animate-slide-in-right flex-col overflow-y-auto border-l border-edge bg-panel shadow-2xl"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {!m.verifiedBy && (
                <AutoBadge
                  date={m.autoAdmittedAt}
                  detail="价格、上下文窗口与跑分均来自 OpenRouter 聚合数据，未经厂商官方确认，签约前请以官方定价页为准"
                />
              )}
            </div>
            <h2 className="mt-2 text-lg font-semibold">{m.name}</h2>
            <p className="mt-1 text-xs text-muted">
              {m.vendor}
              <span className="mx-1.5 text-faint">·</span>
              {m.region === 'china' ? '国内' : '海外'}
              {m.releasedAt && (
                <>
                  <span className="mx-1.5 text-faint">·</span>
                  {m.releasedAt} 发布
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg border border-edge p-1 text-muted transition-colors hover:text-ink"
          >
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {!m.verifiedBy && (
          <div className="mt-4 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-3 text-2xs leading-relaxed text-amber-800 dark:text-amber-300">
            {m.autoAdmittedAt} 由每日脚本从 OpenRouter 自动收录，以下价格、上下文与跑分
            <strong>未经人工逐条核实</strong>。该平台是聚合器而非厂商官方源，
            同一模型在不同渠道的价格可能不同，签约与预算请以厂商官方定价页为准。
          </div>
        )}

        {m.isRouter && (
          <div className="mt-4 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-3 text-2xs leading-relaxed text-amber-800 dark:text-amber-300">
            这不是模型本体，而是模型路由器 / 自动选型服务。它按每次请求实际转发到的模型计费，
            因此没有可横向比较的固定价格。
          </div>
        )}

        {m.isBatch && (
          <div className="mt-4 rounded-lg border border-dashed border-sky-500/40 bg-sky-500/10 p-3 text-2xs leading-relaxed text-sky-800 dark:text-sky-300">
            这是批处理通道：能力与同系列标准版完全相同，但价格通常低约 50%。
            代价是异步提交——请求需排队等待，无法中断，也不保证即时返回。
            适合离线批量处理，不适合在线交互场景。
          </div>
        )}

        {m.description && (
          <p className="mt-4 text-xs leading-relaxed text-muted">{m.description}</p>
        )}

        {/* 关键指标 */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <MetricBox label="上下文窗口" value={compactTokens(m.contextWindow)} unit="token" />
          <MetricBox
            label="单次输出上限"
            value={m.maxOutputTokens ? compactTokens(m.maxOutputTokens) : '—'}
            unit={m.maxOutputTokens ? 'token' : ''}
          />
          <MetricBox label="输入价" value={m.isRouter ? '浮动' : priceLabel(m.priceInput)} unit={m.isRouter ? '' : '/ 百万 token'} />
          <MetricBox label="输出价" value={m.isRouter ? '—' : priceLabel(m.priceOutput)} unit={m.isRouter ? '' : '/ 百万 token'} />
          {m.priceCacheRead !== null && (
            <MetricBox label="缓存读取" value={priceLabel(m.priceCacheRead)} unit="/ 百万 token" />
          )}
          {m.knowledgeCutoff && (
            <MetricBox label="知识截止" value={m.knowledgeCutoff} unit="" />
          )}
        </div>

        {/* 模态 */}
        <Section title="模态支持">
          <div className="flex flex-wrap gap-1.5">
            {m.inputModalities.map((x) => (
              <span key={x} className="aa-chip bg-brand-soft text-brand">
                输入 {MODALITY_LABEL[x] ?? x}
              </span>
            ))}
            {m.outputModalities.map((x) => (
              <span key={x} className="aa-chip bg-faint/15 text-muted">
                输出 {MODALITY_LABEL[x] ?? x}
              </span>
            ))}
          </div>
          {m.supportsReasoning && (
            <p className="mt-2 text-2xs text-muted">
              支持推理强度调节{m.reasoningMandatory ? '（必须开启）' : '（可关闭）'}
            </p>
          )}
        </Section>

        {/* 跑分 */}
        {m.scores && (m.scores.intelligence !== null || m.scores.coding !== null || m.scores.agentic !== null) && (
          <Section title="第三方评测指数">
            <div className="space-y-2">
              <ScoreBar label="综合智能" value={m.scores.intelligence} />
              <ScoreBar label="编程" value={m.scores.coding} />
              <ScoreBar label="Agent 能力" value={m.scores.agentic} />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-faint">
              来自 Artificial Analysis 第三方评测，非厂商自评；仅覆盖部分模型，缺失不代表能力差。
            </p>
          </Section>
        )}

        {/* 开源 */}
        {m.openWeights && (
          <Section title="开源权重">
            <a
              href={m.openWeightsUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              className="aa-chip bg-emerald-500/10 text-emerald-700 hover:opacity-80 dark:text-emerald-400"
            >
              在 HuggingFace 查看 ↗
            </a>
          </Section>
        )}

        {/* 链接 */}
        <Section title="溯源">
          <a
            href={m.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="aa-chip bg-brand text-white hover:opacity-90"
          >
            {m.vendor} 官方模型页 ↗
          </a>
          <p className="mt-2 break-all text-[10px] text-faint">
            OpenRouter ID：{m.openRouterId}
          </p>
        </Section>
      </div>
    </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-2xs font-medium text-muted">{title}</h3>
      {children}
    </div>
  )
}

function MetricBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg border border-edge p-2.5">
      <p className="text-2xs text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{value}</p>
      {unit && <p className="text-[10px] text-faint">{unit}</p>}
    </div>
  )
}

/**
 * 跑分条。
 *
 * 上限固定 100：Artificial Analysis 的三个指数都是百分制量纲，
 * 但不同指标的实际分数区间不同（综合智能常见 20-40，
 * Agent 能力可到 60+），用同一刻度才能看出强弱。
 * 不设动态 max，否则同一页里两个模型的条长不可比。
 */
function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) {
    return (
      <div className="flex items-center justify-between text-2xs">
        <span className="text-muted">{label}</span>
        <span className="text-faint">无数据</span>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-baseline justify-between text-2xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-faint/15">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  )
}