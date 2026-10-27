import { useMemo, useState } from 'react'
import scoreData from '../../data/model-scores.json'

/*
 * 大模型评分页
 *
 * 数据来自 Artificial Analysis 的 Intelligence Index（v4.3.2）——独立第三方评测，
 * 不是厂商自报成绩，也不是本站打分。同一模型的多个推理档位（Max / Xhigh…）
 * 在抓取时已按最高分去重，variant 字段保留档位，方便理解“这个分数是哪一档跑出来的”。
 */

type ModelScore = {
  rank: number
  slug: string
  name: string
  variant: string | null
  creator: string
  score: number
  estimated: boolean
  coding: number | null
  frontierCode: number | null
  multimodal: number | null
  automation: number | null
  science: number | null
  costPerTask: number | null
  speed: number | null
  ttft: number | null
  priceIn: number | null
  priceOut: number | null
  context: number | null
  openWeights: boolean
  reasoning: boolean
}

const data = scoreData as unknown as {
  meta: {
    lastUpdated: string
    source: string
    sourceUrl: string
    indexName: string
    indexVersion: string
    count: number
    methodology: string
    disclaimer: string
  }
  models: ModelScore[]
}

const fmtCtx = (n: number | null) => {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  return `${Math.round(n / 1000)}K`
}
const fmtPrice = (n: number | null) => (n == null ? '—' : `$${n < 0.1 ? n.toFixed(3) : n}`)
const fmtCost = (n: number | null) => (n == null ? '—' : `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`)
const fmtSpeed = (n: number | null) => (n == null ? '—' : `${Math.round(n)} t/s`)

function ScoreBar({ value, max = 60 }: { value: number; max?: number }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100))
  const color = value >= 50 ? 'bg-brand' : value >= 30 ? 'bg-amber-500' : 'bg-slate-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-faint/20 sm:w-24">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="min-w-[2.4rem] text-right font-mono text-xs font-semibold tabular-nums text-ink">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="aa-card px-3 py-2.5">
      <div className="text-2xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-2xs text-faint">{sub}</div>}
    </div>
  )
}

export default function ModelScoresPage() {
  const { meta, models } = data
  const [q, setQ] = useState('')
  const [creator, setCreator] = useState('all')
  const [openOnly, setOpenOnly] = useState(false)

  const creators = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of models) m.set(r.creator, (m.get(r.creator) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [models])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return models.filter((r) => {
      if (creator !== 'all' && r.creator !== creator) return false
      if (openOnly && !r.openWeights) return false
      if (!kw) return true
      return r.name.toLowerCase().includes(kw) || r.creator.toLowerCase().includes(kw)
    })
  }, [models, q, creator, openOnly])

  const stats = useMemo(() => {
    const top = Math.max(...models.map((m) => m.score))
    const open = models.filter((m) => m.openWeights).length
    return { top, open, vendors: creators.length }
  }, [models, creators])

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">大模型评分</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            第三方独立评测 <strong className="text-ink">{meta.indexName} {meta.indexVersion}</strong> 的完整榜单，
            综合语言、编码、多模态、自动化与长上下文等多项评测加权得出。
            {meta.source} 复测，非厂商自报；同一模型的多个推理档位只保留最高分一档。
          </p>
        </div>
        <div className="text-2xs text-faint">
          数据更新 <span className="font-medium text-ink">{meta.lastUpdated}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="收录模型" value={String(models.length)} sub="已按档位去重" />
        <MiniStat label="最高综合分" value={stats.top.toFixed(1)} sub="满分 100" />
        <MiniStat label="开源权重" value={String(stats.open)} sub="可本地部署" />
        <MiniStat label="覆盖厂商" value={String(stats.vendors)} sub="独立实验室 / 公司" />
      </div>

      <section className="aa-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
          <input
            id="aa-model-score-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模型 / 厂商"
            className="h-8 w-full rounded-lg border border-edge bg-panel px-2.5 text-xs text-ink placeholder:text-faint focus:border-brand focus:outline-none sm:w-56"
          />
          <select
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            className="h-8 rounded-lg border border-edge bg-panel px-2 text-xs text-ink focus:border-brand focus:outline-none"
          >
            <option value="all">全部厂商（{creators.length}）</option>
            {creators.map(([name, n]) => (
              <option key={name} value={name}>
                {name}（{n}）
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge px-2 py-1.5 text-2xs text-muted">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="size-3 accent-[rgb(var(--brand))]"
            />
            仅开源权重
          </label>
          <span className="ml-auto text-2xs text-faint">{list.length} 个结果</span>
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-edge text-2xs uppercase tracking-wide text-faint">
                <th className="w-12 px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">模型 / 厂商</th>
                <th className="px-2 py-2 font-medium">综合分</th>
                <th className="px-2 py-2 text-right font-medium">编码</th>
                <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">多模态</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">自动化</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">成本/任务</th>
                <th className="hidden px-2 py-2 text-right font-medium lg:table-cell">输入/输出</th>
                <th className="hidden px-2 py-2 text-right font-medium lg:table-cell">速度</th>
                <th className="hidden px-4 py-2 text-right font-medium xl:table-cell">上下文</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {list.map((r) => (
                <tr key={r.slug} className="group transition-colors hover:bg-faint/5">
                  <td className="px-4 py-2.5 font-mono text-xs font-bold text-faint">{r.rank}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex max-w-[17rem] items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-ink group-hover:text-brand">{r.name}</span>
                      {r.openWeights && (
                        <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          开源
                        </span>
                      )}
                      {r.reasoning && (
                        <span className="shrink-0 rounded bg-faint/10 px-1 py-0.5 text-[10px] text-faint">推理</span>
                      )}
                    </div>
                    <div className="truncate text-2xs text-faint">
                      {r.creator}
                      {r.variant ? ` · ${r.variant}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <ScoreBar value={r.score} />
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">
                    {r.coding == null ? '—' : r.coding.toFixed(1)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
                    {r.multimodal == null ? '—' : r.multimodal.toFixed(1)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted md:table-cell">
                    {r.automation == null ? '—' : r.automation.toFixed(1)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted md:table-cell">
                    {fmtCost(r.costPerTask)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted lg:table-cell">
                    {fmtPrice(r.priceIn)} / {fmtPrice(r.priceOut)}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted lg:table-cell">
                    {fmtSpeed(r.speed)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted xl:table-cell">
                    {fmtCtx(r.context)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted">没有匹配的模型，换个关键词或厂商试试。</div>
          )}
        </div>

        {/* 手机端：卡片式行，避免宽表格横向裁切 */}
        <div className="divide-y divide-edge sm:hidden">
          {list.map((r) => (
            <div key={r.slug} className="px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="w-5 shrink-0 font-mono text-2xs font-bold text-faint">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{r.name}</span>
                {r.openWeights && (
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    开源
                  </span>
                )}
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
                  {r.score.toFixed(1)}
                </span>
              </div>
              <div className="ml-7 mt-0.5 truncate text-2xs text-faint">
                {r.creator}
                {r.variant ? ` · ${r.variant}` : ''}
              </div>
              <div className="ml-7 mt-1.5 h-1 w-full overflow-hidden rounded-full bg-faint/15">
                <div
                  className={`h-full rounded-full ${r.score >= 50 ? 'bg-brand' : r.score >= 30 ? 'bg-amber-500' : 'bg-slate-400'}`}
                  style={{ width: `${Math.max(2, Math.min(100, (r.score / 60) * 100))}%` }}
                />
              </div>
              <div className="ml-7 mt-1.5 flex items-center gap-2.5 text-2xs text-muted">
                <span>编码 {r.coding == null ? '—' : r.coding.toFixed(1)}</span>
                <span>多模态 {r.multimodal == null ? '—' : r.multimodal.toFixed(1)}</span>
                <span className="ml-auto font-mono">{fmtCost(r.costPerTask)}/任务</span>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-edge px-4 py-2.5 text-2xs leading-relaxed text-faint">
          编码 = Terminal-Bench 4.0 通过率；多模态 = MMMU-Pro；自动化 = AutomationBench（Zapier 端到端业务任务）；
          成本/任务 = 完成 Intelligence Index 单次评测的综合成本。分项为单项原始成绩，未二次加权；
          “—” 表示该模型未参加此项评测。
        </div>
      </section>

      <div className="aa-card space-y-1.5 p-3">
        <div className="text-2xs font-medium text-ink">{meta.indexName} 是什么？</div>
        <p className="text-2xs leading-relaxed text-muted">{meta.methodology}</p>
        <p className="text-2xs leading-relaxed text-faint">{meta.disclaimer}</p>
        <a
          href={meta.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block pt-0.5 text-2xs font-medium text-brand hover:underline"
        >
          查看 {meta.source} 原始榜单与方法论 ↗
        </a>
      </div>
    </div>
  )
}
