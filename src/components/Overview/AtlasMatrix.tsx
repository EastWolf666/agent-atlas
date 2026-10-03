import { useMemo, useState } from 'react'
import {
  TIER_ORDER,
  AUTONOMY_LEVELS,
  tierColor,
  formOf,
  FORM_META,
  meta,
} from '../../lib/agents'
import type { Agent } from '../../types'

interface Props {
  agents: Agent[]
  onSelect: (id: string) => void
}

/**
 * 同格内多个产品时的散布偏移。
 * 关键：按「中心 → 右 → 左 → 更右 → 更左…」顺序取值，
 * 保证任意前 n 项的横向偏移和为 0——这样每个格子的气泡群重心
 * 都落在网格线上，竖线与视觉中心始终对齐。
 * （早期用固定椭圆轨迹表，第 n 项永远拿同一个偏移，
 *   L4 开发工具这类密集格的偏移和不为 0，竖线便偏离了气泡群中心。）
 */
const JITTER: [number, number][] = (() => {
  // 每档的横向幅度递增，环向散开；纵向正负交替避免挤在一条线上
  const STEP: [number, number][] = [
    [0, 0],
    [26, -12],
    [26, 14],
    [15, -22],
    [15, 20],
    [34, -5],
    [34, 6],
    [8, -26],
    [8, 25],
    [38, 0],
  ]
  const out: [number, number][] = []
  out.push(STEP[0])
  // 交替取右/左，幅度逐档递增
  for (let i = 1; i < STEP.length; i++) {
    const [mag, dy] = STEP[i]
    out.push([mag, dy])
    out.push([-mag, dy > 0 ? dy - 4 : dy + 4])
  }
  return out
})()

/** 标签占位估算：中文按全宽、英文按半宽计 */
function labelWidth(name: string, fontSize: number): number {
  let w = 0
  for (const ch of name) w += /[\u4e00-\u9fff]/.test(ch) ? fontSize : fontSize * 0.55
  return w
}

export function AtlasMatrix({ agents, onSelect }: Props) {
  const [colorByForm, setColorByForm] = useState(false)
  const [hover, setHover] = useState<string | null>(null)

  const W = 1000
  const H = 700
  // 边距必须容纳最大气泡（r=15）+ 抖动偏移（±34px）+ 标签宽度，
  // 否则 L5 列与垂直行业行会被画布边界裁掉；上下多留空间给名字标签
  const M = { top: 58, right: 56, bottom: 48, left: 96 }
  const iw = W - M.left - M.right
  const ih = H - M.top - M.bottom

  const xOf = (level: number) => M.left + ((level - 1) / 4) * iw
  // 行位置按数据量加权：条目多的领域（办公 16、垂直 20）分配更厚的行高，
  // 避免稀疏行（如企业平台 8 条）浪费空间、密集行气泡互相压盖
  const TIER_COUNTS = TIER_ORDER.map(
    (t) => agents.filter((a) => a.tier === t).length
  )
  const TOTAL = TIER_COUNTS.reduce((s, c) => s + c, 0) || 1
  const yOf = (tierIdx: number) => {
    let acc = 0
    for (let i = 0; i < tierIdx; i++) acc += TIER_COUNTS[i]
    return M.top + (acc / TOTAL) * ih
  }
  /** 行的垂直中心 —— 标签与网格线应对齐这里，而非行顶边 */
  const yMidOf = (tierIdx: number) => {
    const h = (TIER_COUNTS[tierIdx] / TOTAL) * ih
    return yOf(tierIdx) + h / 2
  }

  // 按 (tier, level) 分组，同格内分配抖动偏移
  const placed = useMemo(() => {
    const buckets = new Map<string, number>()
    return agents.map((a) => {
      const ti = TIER_ORDER.indexOf(a.tier)
      const key = `${a.tier}-${a.autonomyLevel}`
      const n = buckets.get(key) ?? 0
      buckets.set(key, n + 1)
      const [dx, dy] = JITTER[n % JITTER.length]
      // prominence 1-10 → 半径 5-15
      const r = 5 + (a.prominence / 10) * 10

      // 夹紧到绘图区内，保证气泡（含半径）完整可见——
      // 否则 L5 列和垂直行业行的边缘气泡会被 viewBox 裁掉
      const pad = r + 4
      const cx = Math.min(
        Math.max(xOf(a.autonomyLevel) + dx, M.left + pad),
        M.left + iw - pad
      )
      const cy = Math.min(
        Math.max(yMidOf(ti) + dy, M.top + pad),
        M.top + ih - pad
      )

      return { a, cx, cy, r, ti }
    })
  }, [agents])

  /**
   * 标签层见下方 `labels`（依赖 axisXOf，故置于其后定义）。
   */



  const colorOf = (a: Agent) =>
    colorByForm ? FORM_META[formOf(a)].color : tierColor(a.tier)

  const hovered = hover ? agents.find((a) => a.id === hover) : null
  const legend = colorByForm
    ? Object.entries(FORM_META).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))
    : TIER_ORDER.map((t) => ({ key: t, label: meta.tiers[t].label, color: tierColor(t) }))

  /**
   * 每根竖线的实际绘制位置 = 该列所有气泡的 x 重心。
   * 边缘列（L1/L5）的气泡会被安全边距夹紧而偏离理论网格线，
   * 若竖线仍画在理论位置，就会与视觉中心错开。跟随重心可保证对齐。
   */
  const axisXOf = useMemo(() => {
    const map = new Map<number, number>()
    for (let l = 1; l <= 5; l++) {
      const xs = placed.filter((p) => p.a.autonomyLevel === l).map((p) => p.cx)
      map.set(l, xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : xOf(l))
    }
    return map
  }, [placed])

  /**
   * 全量标注：每个气泡都对应一个名字标签，并用细引线连回圆点，
   * 保证在密集区也不会把名字误认到别的圆点上。
   * 按知名度从高到低贪心放置：优先贴着气泡（无引线），放不下再向外推并用引线连接。
   */
  const labels = useMemo(() => {
    const FS = 8.5
    const ordered = [...placed].sort((a, b) => b.a.prominence - a.a.prominence)

    type Box = { x1: number; y1: number; x2: number; y2: number }
    const taken: Box[] = []
    // 预留纵轴（领域）标签与顶部（自主性）标签的占位，避免被名字压住
    for (let i = 0; i < TIER_ORDER.length; i++) {
      const w = labelWidth(meta.tiers[TIER_ORDER[i]].label, 11)
      taken.push({ x1: M.left - 18 - w, y1: yMidOf(i) - 9, x2: M.left - 12, y2: yMidOf(i) + 9 })
    }
    for (const l of AUTONOMY_LEVELS) {
      const x = axisXOf.get(l)!
      taken.push({ x1: x - 14, y1: M.top - 34, x2: x + 14, y2: M.top - 4 })
    }

    const collide = (b: Box): boolean => {
      if (
        b.x1 < M.left - 2 ||
        b.x2 > M.left + iw + 2 ||
        b.y1 < M.top - 40 ||
        b.y2 > M.top + ih + 28
      )
        return true
      for (const t of taken)
        if (b.x1 < t.x2 && b.x2 > t.x1 && b.y1 < t.y2 && b.y2 > t.y1) return true
      for (const q of placed)
        if (
          b.x1 < q.cx + q.r + 1 &&
          b.x2 > q.cx - q.r - 1 &&
          b.y1 < q.cy + q.r + 1 &&
          b.y2 > q.cy - q.r - 1
        )
          return true
      return false
    }

    const out: {
      id: string
      name: string
      x: number
      y: number
      anchor: 'middle' | 'start' | 'end'
      leader?: { x1: number; y1: number; x2: number; y2: number }
    }[] = []

    for (const p of ordered) {
      // 优先用中文名（更短更直观），过长则退回英文名
      const name = p.a.nameZh && p.a.nameZh.length <= 12 ? p.a.nameZh : p.a.name
      const w = labelWidth(name, FS)
      const h = FS + 2
      const cands: { dx: number; dy: number; anchor: 'middle' | 'start' | 'end'; side: string }[] = [
        { dx: 0, dy: -(p.r + 3), anchor: 'middle', side: 'top' },
        { dx: 0, dy: p.r + 3 + h, anchor: 'middle', side: 'bottom' },
        { dx: p.r + 5, dy: h / 2, anchor: 'start', side: 'right' },
        { dx: -(p.r + 5), dy: h / 2, anchor: 'end', side: 'left' },
        { dx: 0, dy: -(p.r + 16), anchor: 'middle', side: 'top2' },
        { dx: 0, dy: p.r + 16 + h, anchor: 'middle', side: 'bottom2' },
      ]
      let pick:
        | { bx1: number; by1: number; bx2: number; by2: number; anchor: 'middle' | 'start' | 'end'; side: string }
        | null = null
      for (const c of cands) {
        let bx1: number, bx2: number, by1: number, by2: number
        if (c.anchor === 'middle') {
          bx1 = p.cx + c.dx - w / 2
          bx2 = p.cx + c.dx + w / 2
        } else if (c.anchor === 'start') {
          bx1 = p.cx + c.dx
          bx2 = p.cx + c.dx + w
        } else {
          bx2 = p.cx + c.dx
          bx1 = p.cx + c.dx - w
        }
        by1 = p.cy + c.dy - h
        by2 = p.cy + c.dy
        const box: Box = { x1: bx1 - 1, y1: by1 - 1, x2: bx2 + 1, y2: by2 + 1 }
        if (collide(box)) continue
        pick = { bx1, by1, bx2, by2, anchor: c.anchor, side: c.side }
        break
      }
      // 兜底：实在放不下也强制定在正上方（密集区难免叠字，但引线保证对应正确）
      if (!pick) {
        pick = {
          bx1: p.cx - w / 2,
          bx2: p.cx + w / 2,
          by1: p.cy - (p.r + 3) - h,
          by2: p.cy - (p.r + 3),
          anchor: 'middle',
          side: 'top',
        }
      }
      taken.push({ x1: pick.bx1 - 1, y1: pick.by1 - 1, x2: pick.bx2 + 1, y2: pick.by2 + 1 })

      const labelX =
        pick.anchor === 'middle' ? p.cx : pick.anchor === 'start' ? pick.bx1 : pick.bx2
      const labelY = pick.by2 - 2

      let leader: { x1: number; y1: number; x2: number; y2: number } | undefined
      if (pick.side === 'right')
        leader = { x1: pick.bx1 - 1, y1: pick.by1 + h / 2, x2: p.cx + p.r, y2: p.cy }
      else if (pick.side === 'left')
        leader = { x1: pick.bx2 + 1, y1: pick.by1 + h / 2, x2: p.cx - p.r, y2: p.cy }
      else if (pick.side === 'top2')
        leader = { x1: p.cx, y1: pick.by2 + 1, x2: p.cx, y2: p.cy - p.r }
      else if (pick.side === 'bottom2')
        leader = { x1: p.cx, y1: pick.by1 - 1, x2: p.cx, y2: p.cy + p.r }

      out.push({ id: p.a.id, name, x: labelX, y: labelY, anchor: pick.anchor, leader })
    }
    return out
  }, [placed, iw, axisXOf])

  return (
    <div className="aa-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">能力 × 领域图谱</h3>
          <p className="mt-0.5 text-2xs text-muted">
            横轴自主性等级，纵轴应用领域，气泡大小代表相对知名度
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-faint">
            {colorByForm ? '颜色：按形态' : '颜色：按领域'}
          </span>
          <button
            onClick={() => setColorByForm((v) => !v)}
            aria-pressed={colorByForm}
            className={`rounded-md px-2.5 py-1 text-2xs font-medium transition-colors ${
              colorByForm ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            按形态着色
          </button>
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 720 }}
          role="img"
          aria-label="Agent 能力与领域分布图谱"
        >
          {/* 网格与坐标轴 */}
          {TIER_ORDER.map((t, i) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={M.left + iw}
                y1={yMidOf(i)}
                y2={yMidOf(i)}
                stroke="currentColor"
                className="text-edge"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : '3 4'}
              />
              <text
                x={M.left - 12}
                y={yMidOf(i)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted text-[11px]"
              >
                {meta.tiers[t].label}
              </text>
            </g>
          ))}

          {AUTONOMY_LEVELS.map((l) => (
            <g key={l}>
              <line
                x1={axisXOf.get(l)}
                x2={axisXOf.get(l)}
                y1={M.top}
                y2={M.top + ih}
                stroke="currentColor"
                className="text-edge"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              {/* 轴标签放在顶部：底部是最后一行气泡区，标签会被压住 */}
              <text
                x={axisXOf.get(l)}
                y={M.top - 14}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {meta.autonomyLevels[String(l)].name}
              </text>
              <text
                x={axisXOf.get(l)}
                y={M.top - 3}
                textAnchor="middle"
                className="fill-ink text-[12px] font-semibold"
              >
                L{l}
              </text>
            </g>
          ))}

          {/* 悬浮提示层 */}
          {hovered && (() => {
            const p = placed.find((x) => x.a.id === hovered.id)!
            const boxW = 210
            const flip = p.cx > W - boxW - 40
            return (
              <g pointerEvents="none">
                <rect
                  x={flip ? p.cx - boxW - 12 : p.cx + 12}
                  y={Math.max(4, p.cy - 46)}
                  width={boxW}
                  height={58}
                  rx={8}
                  className="fill-panel stroke-edge"
                  strokeWidth={1}
                />
                <text
                  x={flip ? p.cx - boxW - 2 : p.cx + 22}
                  y={Math.max(4, p.cy - 46) + 21}
                  className="fill-ink text-[12px] font-semibold"
                >
                  {hovered.name}
                </text>
                <text
                  x={flip ? p.cx - boxW - 2 : p.cx + 22}
                  y={Math.max(4, p.cy - 46) + 37}
                  className="fill-muted text-[10px]"
                >
                  {hovered.vendor} · L{hovered.autonomyLevel}
                </text>
                <text
                  x={flip ? p.cx - boxW - 2 : p.cx + 22}
                  y={Math.max(4, p.cy - 46) + 50}
                  className="fill-faint text-[10px] aa-line-clamp-2"
                >
                  {hovered.tagline}
                </text>
              </g>
            )
          })()}

          {/* 气泡：先画非高亮，再画高亮，避免被遮挡 */}
          {[...placed]
            .sort((a, b) => (a.a.id === hover ? 1 : b.a.id === hover ? -1 : 0))
            .map(({ a, cx, cy, r }) => {
              const dim = hover !== null && hover !== a.id
              return (
                <g key={a.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={colorOf(a)}
                    fillOpacity={dim ? 0.18 : 0.3}
                    stroke={colorOf(a)}
                    strokeWidth={hover === a.id ? 2 : 1.2}
                    strokeOpacity={dim ? 0.25 : 0.85}
                    className="cursor-pointer transition-opacity"
                    onMouseEnter={() => setHover(a.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelect(a.id)}
                  />
                </g>
              )
            })}

          {/* 标注层：每个气泡一个名字，细引线连回圆点，密集区也不混淆 */}
          {labels.map(({ id, x, y, anchor, leader, name }) => {
            const dim = hover !== null && hover !== id
            return (
              <g key={`lab-${id}`} pointerEvents="none">
                {leader && (
                  <line
                    x1={leader.x1}
                    y1={leader.y1}
                    x2={leader.x2}
                    y2={leader.y2}
                    className="text-faint"
                    stroke="currentColor"
                    strokeWidth={0.7}
                    strokeOpacity={dim ? 0.12 : 0.5}
                  />
                )}
                <text
                  x={x}
                  y={y}
                  textAnchor={anchor}
                  className="fill-ink text-[8.5px] font-medium"
                  opacity={dim ? 0.18 : 0.92}
                  style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2.4, strokeOpacity: 0.72 }}
                >
                  {name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-edge px-4 py-2.5">
        {legend.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5 text-2xs text-muted">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: l.color, opacity: 0.75 }}
            />
            {l.label}
          </span>
        ))}
        <span className="ml-auto text-2xs text-faint">
          {hover ? '点击查看详情' : `${placed.length} 个产品 · 点击气泡查看详情`}
        </span>
      </div>
    </div>
  )
}
