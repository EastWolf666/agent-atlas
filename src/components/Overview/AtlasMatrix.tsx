import { useMemo, useState } from 'react'
import {
  TIER_ORDER,
  AUTONOMY_COLORS,
  AUTONOMY_LEVELS,
  tierColor,
  formOf,
  FORM_META,
  meta,
} from '../../lib/agents'
import type { Agent, ColorMode } from '../../types'

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
  const [colorMode, setColorMode] = useState<ColorMode>('tier')
  const [hover, setHover] = useState<string | null>(null)

  const W = 1000
  const H = 560
  // 边距必须容纳最大气泡（r=15）+ 抖动偏移（±34px）+ 标签宽度，
  // 否则 L5 列与垂直行业行会被画布边界裁掉
  const M = { top: 58, right: 56, bottom: 34, left: 96 }
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
   * 标签避让：按知名度从高到低尝试放置，与已放置标签或轴标签相交则放弃。
   * 放弃的产品仅显示气泡，悬停时在提示框里看名字——保证密集区仍可读。
   */
  const labelledIds = useMemo(() => {
    const FS = 9
    const taken: { x1: number; y1: number; x2: number; y2: number }[] = []

    // 轴标签占位也要避开（留出4px 余量）
    for (let i = 0; i < TIER_ORDER.length; i++) {
      const label = meta.tiers[TIER_ORDER[i]].label
      const w = labelWidth(label, 11)
      taken.push({
        x1: M.left - 14 - w - 4,
        y1: yMidOf(i) - 10,
        x2: M.left - 12 + 4,
        y2: yMidOf(i) + 10,
      })
    }

    const out = new Set<string>()
    const sorted = [...placed].sort((a, b) => b.a.prominence - a.a.prominence)
    for (const p of sorted) {
      const name = p.a.name
      const w = labelWidth(name, FS)
      // 标签锚在气泡上方，向上偏移让文字落在气泡顶部之外
      const ty = p.cy - p.r - 4
      const box = {
        x1: p.cx - w / 2 - 2,
        y1: ty - FS,
        x2: p.cx + w / 2 + 2,
        y2: ty + 3,
      }
      // 与其他所有气泡（含未标-label 的）相交也算冲突，避免文字压在邻近气泡上
      const overlapsBubble = placed.some((q) => {
        if (q.a.id === p.a.id) return false
        return (
          box.x1 < q.cx + q.r &&
          box.x2 > q.cx - q.r &&
          box.y1 < q.cy + q.r &&
          box.y2 > q.cy - q.r
        )
      })
      const hit =
        box.x1 < M.left ||
        box.x2 > M.left + iw ||
        box.y1 < M.top - 4 ||
        overlapsBubble ||
        taken.some((t) => box.x1 < t.x2 && box.x2 > t.x1 && box.y1 < t.y2 && box.y2 > t.y1)
      if (hit) continue
      taken.push(box)
      out.add(p.a.id)
    }
    return out
  }, [placed, iw])


  const colorOf = (a: Agent) => {
    if (colorMode === 'tier') return tierColor(a.tier)
    if (colorMode === 'autonomy') return AUTONOMY_COLORS[a.autonomyLevel]
    return FORM_META[formOf(a)].color
  }

  const hovered = hover ? agents.find((a) => a.id === hover) : null
  const legend =
    colorMode === 'tier'
      ? TIER_ORDER.map((t) => ({ key: t, label: meta.tiers[t].label, color: tierColor(t) }))
      : colorMode === 'autonomy'
        ? AUTONOMY_LEVELS.map((l) => ({
            key: String(l),
            label: `L${l} ${meta.autonomyLevels[String(l)].name}`,
            color: AUTONOMY_COLORS[l],
          }))
        : Object.entries(FORM_META).map(([k, v]) => ({
            key: k,
            label: v.label,
            color: v.color,
          }))

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
   * 可切换的着色维度。
   * 不提供「按自主性」：X 轴本就是自主性等级，整列必然同色，
   * 与位置信息完全重复，看不到任何新信息。
   */
  const modes: { key: ColorMode; label: string; hint: string }[] = [
    { key: 'tier', label: '按领域', hint: '与纵轴一致' },
    { key: 'form', label: '按形态', hint: '形态是第三个独立维度，可看出分布' },
  ]

  return (
    <div className="aa-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">能力 × 领域图谱</h3>
          <p className="mt-0.5 text-2xs text-muted">
            横轴自主性等级，纵轴应用领域，气泡大小代表相对知名度
          </p>
        </div>
        <div
          className="flex items-center gap-2"
        >
          <span className="text-2xs text-faint">
            {modes.find((m) => m.key === colorMode)?.hint}
          </span>
          <div
            className="flex gap-0.5 rounded-lg bg-faint/10 p-0.5"
            role="tablist"
            aria-label="图谱着色维度"
          >
            {modes.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={colorMode === m.key}
                onClick={() => setColorMode(m.key)}
                className={`rounded-md px-2.5 py-1 text-2xs font-medium transition-colors ${
                  colorMode === m.key
                    ? 'bg-panel text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
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
                  {labelledIds.has(a.id) && !dim && (
                    <text
                      x={cx}
                      y={cy - r - 4}
                      textAnchor="middle"
                      className="pointer-events-none fill-ink text-[9px] font-medium"
                      opacity={0.85}
                    >
                      {a.name}
                    </text>
                  )}
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
          {hover ? '点击查看详情' : `${placed.length} 个产品 · 悬停查看名称`}
        </span>
      </div>
    </div>
  )
}
