import { useEffect, useMemo, useState } from 'react'
import {
  alternatives,
  alternativesMeta,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PLATFORM_LABEL,
  PRICING_LABEL,
  REGION_LABEL,
  pricingClass,
  searchAlternatives,
} from '../../lib/alternatives'
import type { AltCategory, AltRegion, AltTool } from '../../types-alternative'
import { AutoBadge } from '../bits'

/*
 * 本模块由 index.tsx 动态 import，只有切到「AI 国产替代」标签页才会下载。
 * 保持和 Models 页一致的懒加载模式，避免手工数据也进入首屏 bundle。
 */

/*
 * 国产替代页布局：卡片网格 ↔ 表格 双视图切换。
 *
 * 为什么两种都要：
 *   卡片适合「按场景浏览」——一眼看到某类工具里有哪些国产选项、各自替代谁；
 *   表格适合「横向对比」——同一行里名称、厂商、定价、平台对齐，便于选型。
 * 不做排序条：54 条手工数据没有可量化的排序字段（无价格数值、无跑分），
 *   只有 lastVerified，硬加排序条是过度设计。
 */

type ViewMode = 'grid' | 'table'

export default function AlternativesView() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ViewMode>('grid')
  const [category, setCategory] = useState<AltCategory | 'all'>('all')
  const [region, setRegion] = useState<'all' | AltRegion>('all')
  const [detail, setDetail] = useState<AltTool | null>(null)

  /*
   * Escape 关闭详情浮层。
   * 浮层是 fixed 覆盖层，关不掉就只能刷新页面，而刷新会丢失筛选状态。
   * 这是可用性问题，不是快捷键偏好问题。
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
    const cn = alternatives.filter((a) => a.region === 'china').length
    return {
      total: alternatives.length,
      cn,
      overseas: alternatives.length - cn,
      categories: new Set(alternatives.map((a) => a.category)).size,
      free: alternatives.filter((a) => a.pricingModel === 'free').length,
    }
  }, [])

  const filtered = useMemo(() => {
    let list = alternatives.filter((a) => {
      if (category !== 'all' && a.category !== category) return false
      if (region !== 'all' && a.region !== region) return false
      return true
    })
    list = searchAlternatives(list, query)
    return list
  }, [query, category, region])

  const activeCount = (category !== 'all' ? 1 : 0) + (region !== 'all' ? 1 : 0)

  const reset = () => {
    setQuery('')
    setCategory('all')
    setRegion('all')
  }

  return (
    <section className="space-y-4">
      {/* 标题区 */}
      <div className="animate-fade-in">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">AI 国产替代方案地图</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted">
          按 <strong className="text-ink">9 个功能场景</strong> 整理国际主流 AI 工具与对应的国产替代选项，
          帮助选型时快速定位可落地的国内方案。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted">
          <span className="aa-chip bg-faint/15">数据更新 {alternativesMeta.lastUpdated}</span>
          <span className="aa-chip bg-faint/15">{stats.categories} 个场景</span>
          <span className="aa-chip bg-faint/15">
            {stats.cn} 国产 / {stats.overseas} 海外
          </span>
          <span className="aa-chip bg-faint/15">{stats.free} 个完全免费</span>
          <AutoBadge detail="替代关系与功能描述为人工整理的研究快照，具体能力、定价与可用性请以厂商官网为准" />
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid animate-fade-in grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">收录工具</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums">{stats.total}</p>
          <p className="mt-0.5 text-2xs text-faint">{stats.categories} 个场景</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">国产替代</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-brand">{stats.cn}</p>
          <p className="mt-0.5 text-2xs text-faint">占 {Math.round((stats.cn / stats.total) * 100)}%</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">国际主流</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
            {stats.overseas}
          </p>
          <p className="mt-0.5 text-2xs text-faint">被替代参考</p>
        </div>
        <div className="aa-card p-3.5">
          <p className="text-2xs text-muted">完全免费</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.free}
          </p>
          <p className="mt-0.5 text-2xs text-faint">其余多为免费增值</p>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="aa-card animate-fade-in space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id="aa-alt-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索工具名、厂商或场景…"
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
          {/* 场景单选 */}
          <button
            onClick={() => setCategory('all')}
            aria-pressed={category === 'all'}
            className={`aa-chip transition-colors ${
              category === 'all' ? 'bg-brand text-white' : 'bg-faint/15 text-muted hover:text-ink'
            }`}
          >
            全部场景
          </button>
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`aa-chip transition-colors ${
                category === c ? 'bg-brand text-white' : 'bg-faint/15 text-muted hover:text-ink'
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}

          <span className="mx-1 h-3.5 w-px bg-edge" aria-hidden />

          {/* 地区 */}
          {(
            [
              ['all', '全部地区'],
              ['china', '国产'],
              ['overseas', '海外'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRegion(k as 'all' | AltRegion)}
              aria-pressed={region === k}
              className={`aa-chip transition-colors ${
                region === k ? 'bg-brand text-white' : 'bg-faint/15 text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}

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

      {/* 列表 */}
      {filtered.length === 0 ? (
        <div className="aa-card p-10 text-center">
          <p className="text-sm text-muted">没有符合条件的工具</p>
          <button onClick={reset} className="mt-3 aa-chip bg-brand text-white hover:opacity-90">
            清空筛选
          </button>
        </div>
      ) : mode === 'grid' ? (
        <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => (
            <AltCard key={a.id} item={a} onOpen={() => setDetail(a)} />
          ))}
        </div>
      ) : (
        <div className="aa-card animate-fade-in overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-edge text-left text-2xs text-muted">
                <th className="whitespace-nowrap px-3 py-2 font-medium">名称</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">厂商</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">场景</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">替代对象</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">定价</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">平台</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">核实时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setDetail(a)}
                  className="cursor-pointer border-b border-edge/60 transition-colors last:border-0 hover:bg-faint/10"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          a.region === 'china' ? 'bg-brand' : 'bg-blue-500'
                        }`}
                        aria-hidden
                      />
                      <span className="font-medium">{a.name}</span>
                      {a.region === 'china' && (
                        <span className="aa-chip bg-brand-soft text-[10px] text-brand">国产</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{a.vendor}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{CATEGORY_LABEL[a.category]}</td>
                  <td className="px-3 py-2">
                    {a.replaces.length > 0 ? (
                      <span className="line-clamp-1 text-2xs text-muted">
                        {a.replaces.map((rid) => nameById(rid)).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`aa-chip text-[10px] ${pricingClass(a.pricingModel)}`}>
                      {PRICING_LABEL[a.pricingModel]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {a.platforms.map((p) => PLATFORM_LABEL[p]).join(' / ')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-faint">{a.lastVerified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="animate-fade-in text-2xs leading-relaxed text-faint">{alternativesMeta.disclaimer}</p>

      {detail && <AltDetail item={detail} onClose={() => setDetail(null)} onOpen={(id) => setDetail(toolById(id))} />}
    </section>
  )
}

/** 按 id 查找工具，找不到时返回一个占位对象避免崩溃 */
function toolById(id: string): AltTool {
  return alternatives.find((a) => a.id === id) ?? (alternatives[0] as AltTool)
}

function nameById(id: string): string {
  return alternatives.find((a) => a.id === id)?.name ?? id
}

function AltCard({ item: a, onOpen }: { item: AltTool; onOpen: () => void }) {
  return (
    <article
      className="aa-card group relative flex cursor-pointer flex-col p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-sm"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-brand">{a.name}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-2xs text-muted">
            <span
              className={`size-2 shrink-0 rounded-full ${a.region === 'china' ? 'bg-brand' : 'bg-blue-500'}`}
              aria-hidden
            />
            <span className="truncate">{a.vendor}</span>
            <span className="text-faint">·</span>
            <span className={a.region === 'china' ? 'text-brand' : ''}>{REGION_LABEL[a.region]}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {a.region === 'china' && (
            <span className="aa-chip bg-brand-soft text-[10px] text-brand" title="国产替代选项">
              国产
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-2xs leading-relaxed text-faint">{a.tagline}</p>

      {a.replaces.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] text-faint">替代</p>
          <p className="line-clamp-1 text-2xs text-muted">{a.replaces.map((rid) => nameById(rid)).join(' · ')}</p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="aa-chip bg-faint/15 text-[10px] text-muted">{CATEGORY_LABEL[a.category]}</span>
        <span className={`aa-chip text-[10px] ${pricingClass(a.pricingModel)}`}>{PRICING_LABEL[a.pricingModel]}</span>
      </div>
    </article>
  )
}

function AltDetail({
  item: a,
  onClose,
  onOpen,
}: {
  item: AltTool
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const replacedBy = useMemo(
    () => alternatives.filter((x) => x.region === 'china' && x.replaces.includes(a.id)),
    [a.id]
  )

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${a.name} 详情`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg animate-slide-in-right flex-col overflow-y-auto border-l border-edge bg-panel shadow-2xl"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`aa-chip text-[10px] ${a.region === 'china' ? 'bg-brand-soft text-brand' : 'bg-faint/15 text-muted'}`}
                >
                  {REGION_LABEL[a.region]}
                </span>
                {a.region === 'china' && (
                  <AutoBadge detail="替代关系、功能描述与定价为人工整理的研究快照，具体能力请以厂商官网为准" />
                )}
              </div>
              <h2 className="mt-2 text-lg font-semibold">{a.name}</h2>
              <p className="mt-1 text-xs text-muted">
                {a.vendor}
                <span className="mx-1.5 text-faint">·</span>
                {CATEGORY_LABEL[a.category]}
                <span className="mx-1.5 text-faint">·</span>
                核实于 {a.lastVerified}
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

          {/* 免责声明 */}
          <div className="mt-4 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 p-3 text-2xs leading-relaxed text-amber-800 dark:text-amber-300">
            「替代」仅表示功能场景上的国产对应选项，<strong>不等于能力等价</strong>。具体功能、定价与可用性请以厂商官网为准。
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">{a.description}</p>

          {/* 关键指标 */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetricBox label="定价模式" value={PRICING_LABEL[a.pricingModel]} unit={a.pricingNote} />
            <MetricBox label="支持平台" value={String(a.platforms.length)} unit={a.platforms.map((p) => PLATFORM_LABEL[p]).join(' / ')} />
            <MetricBox label="功能场景" value={CATEGORY_LABEL[a.category]} unit="" />
            <MetricBox label="核实时间" value={a.lastVerified} unit="" />
          </div>

          {/* 卖点 */}
          {a.highlights.length > 0 && (
            <Section title="核心卖点">
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
                {a.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* 替代关系 */}
          {a.region === 'china' && a.replaces.length > 0 && (
            <Section title="可替代的国际工具">
              <div className="flex flex-wrap gap-1.5">
                {a.replaces.map((rid) => {
                  const target = alternatives.find((x) => x.id === rid)
                  if (!target) return null
                  return (
                    <button
                      key={rid}
                      onClick={() => onOpen(rid)}
                      className="aa-chip bg-blue-500/10 text-blue-700 hover:opacity-80 dark:text-blue-400"
                    >
                      {target.name} →
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {a.region === 'overseas' && replacedBy.length > 0 && (
            <Section title="国产替代选项">
              <div className="flex flex-wrap gap-1.5">
                {replacedBy.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => onOpen(x.id)}
                    className="aa-chip bg-brand-soft text-brand hover:opacity-80"
                  >
                    {x.name} →
                  </button>
                ))}
              </div>
            </Section>
          )}

          {/* 链接 */}
          <Section title="官网">
            <a
              href={a.officialUrl}
              target="_blank"
              rel="noreferrer"
              className="aa-chip bg-brand text-white hover:opacity-90"
            >
              访问 {a.vendor} 官网 ↗
            </a>
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
      {unit && <p className="line-clamp-2 text-[10px] text-faint">{unit}</p>}
    </div>
  )
}
