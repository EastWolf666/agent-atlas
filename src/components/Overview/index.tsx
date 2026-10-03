import { useMemo } from 'react'
import { agents as allAgents, meta, TIER_ORDER, tierColor } from '../../lib/agents'
import { AtlasMatrix } from './AtlasMatrix'

interface Props {
  onSelect: (id: string) => void
  onBrowse: () => void
  onCompare: () => void
  compareCount: number
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub: string
  accent?: string
}) {
  return (
    <div className="aa-card p-4">
      <p className="text-2xs text-muted">{label}</p>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </p>
      <p className="mt-1 text-2xs text-faint">{sub}</p>
    </div>
  )
}

export function Overview({ onSelect, onBrowse, onCompare, compareCount }: Props) {
  const stats = useMemo(() => {
    const total = allAgents.length
    const china = allAgents.filter((a) => a.region === 'china').length
    const oss = allAgents.filter((a) => a.openSource).length
    const l45 = allAgents.filter((a) => a.autonomyLevel >= 4).length
    const nonActive = allAgents.filter((a) => a.status !== 'active').length
    const official = allAgents.filter((a) =>
      a.sources.some((s) => s.type === 'official')
    ).length
    return { total, china, oss, l45, nonActive, official, overseas: total - china }
  }, [])

  const tierDist = useMemo(
    () =>
      TIER_ORDER.map((t) => ({
        tier: t,
        count: allAgents.filter((a) => a.tier === t).length,
      })),
    []
  )

  return (
    <section className="space-y-5">
      {/* 标题区 */}
      <div className="animate-fade-in">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          全球 AI Agent 应用图谱
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          按<strong className="text-ink">能力自主性</strong>与
          <strong className="text-ink">应用领域</strong>两个维度探索 {stats.total}{' '}
          个国内外 Agent 产品。每条数据标注自主性评级依据、来源链接与采集时间。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted">
          <span className="aa-chip bg-faint/15">
            数据更新 {meta.lastUpdated}
          </span>
          <span className="aa-chip bg-faint/15">
            {stats.official}/{stats.total} 条有官方来源
          </span>
          <button
            onClick={onBrowse}
            className="aa-chip bg-brand text-white transition-opacity hover:opacity-90"
          >
            浏览全部 {stats.total} 个 →
          </button>
          {compareCount > 0 && (
            <button
              onClick={onCompare}
              className="aa-chip border border-brand text-brand transition-colors hover:bg-brand-soft"
            >
              已选 {compareCount} 个，查看对比
            </button>
          )}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid animate-fade-in grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="收录产品"
          value={stats.total}
          sub={`${stats.china} 国内 / ${stats.overseas} 海外`}
        />
        <StatCard
          label="达到 L4 及以上"
          value={stats.l45}
          sub={`占比 ${Math.round((stats.l45 / stats.total) * 100)}%，具备长程自治`}
          accent="#fbbf24"
        />
        <StatCard
          label="开源项目"
          value={stats.oss}
          sub="可自部署、可二次开发"
          accent="#34d399"
        />
        <StatCard
          label="非活跃状态"
          value={stats.nonActive}
          sub="已停止 / 并购 / 仅维护"
          accent="#fb7185"
        />
      </div>

      {/* 图谱 */}
      <div className="animate-fade-in">
        <AtlasMatrix agents={allAgents} onSelect={onSelect} />
      </div>

      {/* 分类分布 + 洞察 */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="aa-card animate-fade-in p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold">分类分布</h3>
          <p className="mt-0.5 text-2xs text-muted">各Tier 的条目数</p>
          <ul className="mt-4 space-y-2.5">
            {tierDist.map(({ tier, count }) => {
              const pct = Math.round((count / stats.total) * 100)
              return (
                <li key={tier}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium">{meta.tiers[tier].label}</span>
                    <span className="font-mono tabular-nums text-muted">
                      {count}
                      <span className="ml-1 text-faint">{pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-faint/15">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: tierColor(tier) }}
                    />
                  </div>
                  <p className="mt-1 text-2xs text-faint">{meta.tiers[tier].desc}</p>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="aa-card animate-fade-in p-4 lg:col-span-3">
          <h3 className="text-sm font-semibold">从数据中看到的</h3>
          <p className="mt-0.5 text-2xs text-muted">
            基于当前 {stats.total} 条数据的统计观察，非观点判断
          </p>
          <ol className="mt-4 space-y-3">
            {meta.insights.map((ins, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-brand-soft font-mono text-2xs font-semibold text-brand">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed">{ins.text}</p>
                  <p className="mt-0.5 text-2xs text-faint">依据：{ins.basis}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <p className="animate-fade-in text-2xs leading-relaxed text-faint">
        {meta.disclaimer}
      </p>
    </section>
  )
}
