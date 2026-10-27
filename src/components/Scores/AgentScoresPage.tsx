import { useMemo, useState } from 'react'
import scoreData from '../../data/agent-scores.json'

/*
 * Agent 评分页
 *
 * 数据来自两个公开评分站，口径不同、互不换算：
 *   - Assistant Analysis：49 项真实任务的「验证通过率」，偏结果可信度；
 *   - The Agentic Leaderboard：开源 Agent 的加权综合分，偏工程可用性。
 * 所以页面按来源分成两区，不做一个「合并总分」——那种数字看着权威，其实无法解释。
 */

type Commercial = {
  rank: number
  name: string
  developer: string | null
  score: number
  reliability: number | null
  coverage: string | null
  lastEvaluated: string | null
  status: string | null
  url: string | null
}

type OpenSource = {
  rank: number
  slug: string
  name: string
  developer: string | null
  category: string
  score: number
  reliability: number | null
  toolSelection: number | null
  avgSteps: number | null
  costPerTask: number | null
  latencyMs: number | null
  stars: number | null
  mindshare: number | null
  description: string | null
  url: string
}

const data = scoreData as unknown as {
  meta: {
    lastUpdated: string
    sources: {
      key: string
      name: string
      url: string
      version: string | null
      note: string
      evaluatedAt: string | null
      count: number
    }[]
    disclaimer: string
  }
  commercial: Commercial[]
  openSource: OpenSource[]
}

const fmtStars = (n: number | null) => {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
const fmtCost = (n: number | null) => (n == null ? '—' : `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`)
const fmtLatency = (n: number | null) => {
  if (n == null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

/** 分数条：0–100，颜色随区间变化（弱红→中黄→强绿） */
function ScoreBar({ value, className = '' }: { value: number; className?: string }) {
  const color = value >= 90 ? 'bg-emerald-500' : value >= 80 ? 'bg-amber-500' : 'bg-rose-400'
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-faint/20 sm:w-24">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="min-w-[2.2rem] text-right font-mono text-xs font-semibold tabular-nums text-ink">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

function SourceCard({ s }: { s: (typeof data.meta.sources)[number] }) {
  return (
    <a
      href={s.url}
      target="_blank"
      rel="noreferrer"
      className="aa-card group flex flex-col gap-1.5 p-3 transition-colors hover:border-brand/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink group-hover:text-brand">{s.name}</span>
        <span className="text-2xs text-faint">{s.count} 条</span>
      </div>
      <p className="text-2xs leading-relaxed text-muted">{s.note}</p>
      <div className="mt-auto flex items-center gap-2 pt-1 text-2xs text-faint">
        {s.version && <span className="rounded bg-faint/10 px-1 py-0.5">{s.version}</span>}
        {s.evaluatedAt && <span>评测 {s.evaluatedAt}</span>}
        <span className="ml-auto">原榜单 ↗</span>
      </div>
    </a>
  )
}

export default function AgentScoresPage() {
  const { meta, commercial, openSource } = data
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of openSource) m.set(r.category, (m.get(r.category) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [openSource])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return openSource.filter((r) => {
      if (cat !== 'all' && r.category !== cat) return false
      if (!kw) return true
      return (
        r.name.toLowerCase().includes(kw) ||
        (r.developer ?? '').toLowerCase().includes(kw) ||
        (r.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [openSource, q, cat])

  return (
    <div className="animate-fade-in space-y-5">
      {/* 头部：口径说明 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Agent 评分</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            汇总两个公开 Agent 评分榜的实测结果：一组是商业助手的<strong className="text-ink">任务验证通过率</strong>
            ，一组是开源 Agent 的<strong className="text-ink">加权综合分</strong>
            。两边口径不同，页面<strong className="text-ink">不做跨榜合并</strong>，避免造出无法解释的“总分”。
          </p>
        </div>
        <div className="text-2xs text-faint">
          数据更新 <span className="font-medium text-ink">{meta.lastUpdated}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {meta.sources.map((s) => (
          <SourceCard key={s.key} s={s} />
        ))}
      </div>

      {/* 商业 Agent 实测榜 */}
      <section className="aa-card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">商业 Agent 实测榜</h2>
            <p className="mt-0.5 text-2xs text-muted">
              Assistant Analysis · 49 项真实任务 · 通过率 = 达成目标且无越权/安全违规的比例
            </p>
          </div>
          <span className="text-2xs text-faint">{commercial.length} 个系统</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge text-2xs uppercase tracking-wide text-faint">
                <th className="w-12 px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">助手 / 厂商</th>
                <th className="px-2 py-2 font-medium">验证通过率</th>
                <th className="px-2 py-2 text-right font-medium">可靠性</th>
                <th className="px-2 py-2 text-right font-medium">覆盖</th>
                <th className="px-4 py-2 text-right font-medium">评测</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {commercial.map((r) => (
                <tr key={r.name} className="group transition-colors hover:bg-faint/5">
                  <td className="px-4 py-2.5 font-mono text-xs font-bold text-faint">{r.rank}</td>
                  <td className="px-2 py-2.5">
                    <a
                      href={r.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="group-hover:text-brand"
                    >
                      <div className="text-xs font-medium text-ink">{r.name}</div>
                      <div className="text-2xs text-faint">{r.developer ?? '—'}</div>
                    </a>
                  </td>
                  <td className="px-2 py-2.5">
                    <ScoreBar value={r.score} />
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                    {r.reliability == null ? '—' : `${r.reliability.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                    {r.coverage ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-2xs text-faint">{r.lastEvaluated ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 开源 Agent 综合榜 */}
      <section className="aa-card overflow-hidden">
        <div className="border-b border-edge px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">开源 Agent 综合评分</h2>
              <p className="mt-0.5 text-2xs text-muted">
                The Agentic Leaderboard · 每周一重算 · 综合分含可靠性、工具选择质量、平均步数、成本等权重
              </p>
            </div>
            <span className="text-2xs text-faint">{openSource.length} 个 Agent</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              id="aa-score-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 Agent / 开发者 / 描述"
              className="h-8 w-full rounded-lg border border-edge bg-panel px-2.5 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none sm:w-64"
            />
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setCat('all')}
                className={`rounded-md px-2 py-1 text-2xs font-medium transition-colors ${
                  cat === 'all' ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-faint/10'
                }`}
              >
                全部 {openSource.length}
              </button>
              {categories.map(([name, n]) => (
                <button
                  key={name}
                  onClick={() => setCat(name)}
                  className={`rounded-md px-2 py-1 text-2xs font-medium transition-colors ${
                    cat === name ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-faint/10'
                  }`}
                >
                  {name} {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge text-2xs uppercase tracking-wide text-faint">
                <th className="w-12 px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Agent</th>
                <th className="px-2 py-2 font-medium">分类</th>
                <th className="px-2 py-2 font-medium">综合分</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">可靠性</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">工具选择</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">成本/任务</th>
                <th className="hidden px-2 py-2 text-right font-medium lg:table-cell">延迟</th>
                <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Stars</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {list.map((r) => (
                <tr key={r.slug} className="group transition-colors hover:bg-faint/5">
                  <td className="px-4 py-2.5 font-mono text-xs font-bold text-faint">{r.rank}</td>
                  <td className="px-2 py-2.5">
                    <a href={r.url} target="_blank" rel="noreferrer" className="block max-w-[16rem]">
                      <div className="truncate text-xs font-medium text-ink group-hover:text-brand">{r.name}</div>
                      <div className="truncate text-2xs text-faint">{r.developer ?? '—'}</div>
                    </a>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="whitespace-nowrap rounded bg-faint/10 px-1.5 py-0.5 text-2xs text-muted">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <ScoreBar value={r.score} />
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
                    {r.reliability == null ? '—' : `${r.reliability.toFixed(0)}%`}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
                    {r.toolSelection == null ? '—' : `${r.toolSelection.toFixed(1)}%`}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted md:table-cell">
                    {fmtCost(r.costPerTask)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted lg:table-cell">
                    {fmtLatency(r.latencyMs)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted md:table-cell">
                    {fmtStars(r.stars)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted">
              没有匹配的 Agent，换个关键词或分类试试。
            </div>
          )}
        </div>

        <div className="border-t border-edge px-4 py-2.5 text-2xs leading-relaxed text-faint">
          综合分不是任务通过率：它把可靠性、工具选择质量、平均步数、成本等指标加权成一个 0–100 的数，
          适合横向看“工程可用性”，不适合直接当作成功率引用。点击名称可查看原榜单的分项与历史排名。
        </div>
      </section>

      <p className="text-2xs leading-relaxed text-faint">{meta.disclaimer}</p>
    </div>
  )
}
