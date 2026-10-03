import { useEffect, useState } from 'react'
import { Overview } from './components/Overview'
import { FilterPanel } from './components/Grid/FilterPanel'
import { AgentCard } from './components/Grid/AgentCard'
import { DetailPanel } from './components/Detail'
import { CompareView } from './components/Compare'
import { EmptyState } from './components/bits'
import { useFilters, useCompare, useTheme } from './hooks/useAtlas'
import { agents } from './lib/agents'
import type { Agent } from './types'

type View = 'overview' | 'browse'

export default function App() {
  const atlas = useFilters()
  const cmp = useCompare()
  const { theme, toggle: toggleTheme } = useTheme()
  const [view, setView] = useState<View>('overview')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  const detail: Agent | null = detailId ? agents.find((a) => a.id === detailId) ?? null : null

  // "/" 聚焦搜索框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        setView('browse')
        requestAnimationFrame(() => {
          document.getElementById('aa-search')?.focus()
        })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const openDetail = (id: string) => setDetailId(id)
  const goBrowse = () => setView('browse')

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="aa-no-print sticky top-0 z-30 border-b border-edge bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => setView('overview')}
            className="flex items-center gap-2 font-semibold"
            aria-label="返回概览"
          >
            <img src="./favicon.svg" alt="" className="size-6" />
            <span className="hidden text-sm tracking-tight sm:inline">Agent Atlas</span>
          </button>

          <nav className="ml-2 flex items-center gap-0.5">
            {(
              [
                ['overview', '概览'],
                ['browse', '浏览'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                aria-current={view === k ? 'page' : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  view === k ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={goBrowse}
              className="hidden items-center gap-2 rounded-lg border border-edge px-2.5 py-1.5 text-2xs text-faint transition-colors hover:border-brand hover:text-brand sm:flex"
              title="按 / 快速聚焦搜索"
            >
              <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="5" cy="5" r="3.5" />
                <path d="M7.5 7.5L10.5 10.5" strokeLinecap="round" />
              </svg>
              搜索
              <kbd className="rounded border border-edge px-1 font-mono text-[10px]">/</kbd>
            </button>

            {cmp.selected.length > 0 && (
              <button
                onClick={() => setShowCompare(true)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                对比 {cmp.selected.length}/4
              </button>
            )}

            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
              className="rounded-lg border border-edge p-1.5 text-muted transition-colors hover:text-ink"
            >
              {theme === 'dark' ? (
                <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="3" />
                  <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        {view === 'overview' ? (
          <Overview
            onSelect={openDetail}
            onBrowse={goBrowse}
            onCompare={() => setShowCompare(true)}
            compareCount={cmp.selected.length}
          />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
            {/*
              桌面侧栏：吸附到视口顶部并占满剩余高度，内部独立滚动。
              筛选项较多时（视口 ≤900px 就会超出），若不限制高度，
              侧栏会随整页一起滚走——用户滚筛选时右侧结果区也跟着动，
              无法对照。max-h 用 dvh 动态视口单位，移动端地址栏收起时也准确。
            */}
            <aside
              className="aa-panel-scroll hidden min-w-0 lg:sticky lg:top-20 lg:block lg:self-start lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
            >
              <FilterPanel
                filters={atlas.filters}
                actions={atlas}
                resultCount={atlas.results.length}
              />
            </aside>

            <div className="min-w-0">
              {/* 移动端筛选入口：默认折叠，避免占满首屏看不到卡片 */}
              <details className="aa-no-print mb-4 lg:hidden">
                <summary className="aa-card flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-medium">
                  <span>
                    筛选
                    {atlas.activeCount > 0 && (
                      <span className="ml-1.5 text-brand">（{atlas.activeCount} 项生效）</span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    {atlas.results.length} 个结果
                    <svg className="size-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </summary>
                <div className="mt-2">
                  <FilterPanel
                    filters={atlas.filters}
                    actions={atlas}
                    resultCount={atlas.results.length}
                  />
                </div>
              </details>

              <div className="aa-no-print mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="M10.5 10.5L14 14" strokeLinecap="round" />
                  </svg>
                  <input
                    id="aa-search"
                    type="search"
                    value={atlas.filters.query}
                    onChange={(e) => atlas.setQuery(e.target.value)}
                    placeholder="搜索名称、厂商或能力…"
                    className="w-full rounded-lg border border-edge bg-panel py-2 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-faint focus:border-brand"
                  />
                </div>
              </div>

              {atlas.results.length === 0 ? (
                <EmptyState onReset={atlas.reset} />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {atlas.results.map((a) => (
                      <AgentCard
                        key={a.id}
                        agent={a}
                        onOpen={openDetail}
                        onToggleCompare={cmp.toggle}
                        selected={cmp.selected.includes(a.id)}
                        compareFull={cmp.isFull}
                      />
                    ))}
                  </div>
                  <p className="mt-5 text-center text-2xs text-faint">
                    显示 {atlas.results.length} / {agents.length} 个产品
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="aa-no-print mt-8 border-t border-edge py-5 text-center text-2xs text-faint">
        <p>
          Agent Atlas · 数据更新 {agents.length > 0 ? '' : ''}
          <span>共收录 {agents.length} 个产品</span>
        </p>
        <p className="mt-1">
          本项目为独立研究索引，与任何厂商无隶属关系。Agent 领域迭代极快，请以官方信息为准。
        </p>
      </footer>

      {detail && (
        <DetailPanel
          agent={detail}
          onClose={() => setDetailId(null)}
          onSelect={openDetail}
          onToggleCompare={cmp.toggle}
          inCompare={cmp.selected.includes(detail.id)}
        />
      )}

      {showCompare && cmp.agents.length > 0 && (
        <CompareView
          agents={cmp.agents}
          onClose={() => setShowCompare(false)}
          onRemove={cmp.toggle}
          onClear={cmp.clear}
          onBrowse={goBrowse}
        />
      )}
    </div>
  )
}
