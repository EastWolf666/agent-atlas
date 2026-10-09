import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AltCategory, AltTool } from '../../types-alternative'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../../lib/alternatives'
import { LOGOS } from '../../data/logos'

/*
 * 替代关系图：9 个场景同屏网格。每格内「海外(上排) ← 国产(下排)」用 SVG 连线表示替代关系。
 * 三列布局：上排 3 个海外、下排 3 个国产，横向铺满，中间连线区不再留空白。
 *
 * 节点用 DOM（可点击跳详情、可悬停高亮），连线用一层绝对定位 SVG overlay 画，
 * 节点坐标渲染后用 getBoundingClientRect 量出，响应式改宽高时连线自动重算（ResizeObserver 兜底）。
 * 节点图标：LOGOS 收录的品牌渲染真实 SVG 标（品牌色），其余回退到首字母头像。
 */

type LinkDef = { from: string; to: string }
type LinkPath = { from: string; to: string; d: string }

/** 品牌标：库里有则渲染真实 SVG，否则回退首字母 */
function LogoGlyph({ item, size = 18 }: { item: AltTool; size?: number }) {
  const logo = LOGOS[item.id]
  const letter = (item.name || item.vendor || '?').trim().charAt(0).toUpperCase()
  const isCN = item.region === 'china'
  if (logo) {
    const cls = `shrink-0`
    if (logo.kind === 'mono') {
      return (
        <svg
          viewBox={logo.viewBox}
          width={size}
          height={size}
          className={cls}
          aria-hidden
        >
          <g fill={logo.color} dangerouslySetInnerHTML={{ __html: logo.inner }} />
        </svg>
      )
    }
    return (
      <svg
        viewBox={logo.viewBox}
        width={size}
        height={size}
        className={cls}
        aria-hidden
        dangerouslySetInnerHTML={{ __html: logo.inner }}
      />
    )
  }
  return (
    <span
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-md text-[11px] font-bold leading-none text-white ${
        isCN ? 'bg-brand' : 'bg-blue-500'
      }`}
    >
      {letter}
    </span>
  )
}

/** 单场景的关系子图（三列：海外上排 / 国产下排） */
function ScenarioDiagram({
  category,
  items,
  onOpen,
}: {
  category: AltCategory
  items: AltTool[]
  onOpen: (t: AltTool) => void
}) {
  // useMemo 缓存，依赖 items 引用稳定 —— 否则每次渲染 .filter() 都生成新数组，
  // 会让 linkDefs / measure 每帧变引用，useLayoutEffect 无限重跑 → Maximum update depth exceeded。
  const overseas = useMemo(() => items.filter((i) => i.region === 'overseas'), [items])
  const domestic = useMemo(() => items.filter((i) => i.region === 'china'), [items])

  const containerRef = useRef<HTMLDivElement>(null)
  const nodeEls = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [links, setLinks] = useState<LinkPath[]>([])
  const [hovered, setHovered] = useState<string | null>(null)

  const linkDefs = useMemo<LinkDef[]>(() => {
    const defs: LinkDef[] = []
    for (const d of domestic) for (const o of d.replaces) defs.push({ from: d.id, to: o })
    return defs
  }, [domestic])

  const measure = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    const cr = c.getBoundingClientRect()
    const next = linkDefs
      .map(({ from, to }) => {
        const f = nodeEls.current.get(from) // 国产（下排）
        const t = nodeEls.current.get(to) // 海外（上排）
        if (!f || !t) return null
        const fr = f.getBoundingClientRect()
        const tr = t.getBoundingClientRect()
        // 国产在上排之下、海外在上排之上；连线从国产(下)指向上方海外
        const x1 = fr.left - cr.left + fr.width / 2
        const y1 = fr.top - cr.top
        const x2 = tr.left - cr.left + tr.width / 2
        const y2 = tr.bottom - cr.top
        const dx = Math.max(24, Math.abs(x1 - x2) * 0.5)
        const my = (y1 + y2) / 2
        const d = `M ${x1} ${y1} C ${x1 - dx} ${my}, ${x2 + dx} ${my}, ${x2} ${y2}`
        return { from, to, d }
      })
      .filter(Boolean) as LinkPath[]
    setSize({ w: cr.width, h: cr.height })
    setLinks(next)
  }, [linkDefs])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(c)
    const raf = requestAnimationFrame(() => measure())
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [measure])

  const arrowId = `aa-arrow-${category}`
  const register = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) nodeEls.current.set(id, el)
    else nodeEls.current.delete(id)
  }

  return (
    <div className="aa-card flex flex-col p-3">
      <h3 className="mb-2 text-xs font-semibold text-ink">{CATEGORY_LABEL[category]}</h3>
      <div ref={containerRef} className="relative min-h-[150px] flex-1">
        <svg
          className="pointer-events-none absolute inset-0"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          aria-hidden
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="#94a3b8" />
            </marker>
          </defs>
          {links.map((l) => {
            const active = hovered === l.from || hovered === l.to
            return (
              <path
                key={`${l.from}-${l.to}`}
                d={l.d}
                fill="none"
                stroke={active ? '#7c3aed' : '#cbd5e1'}
                strokeWidth={active ? 2.6 : 1.5}
                strokeOpacity={hovered && !active ? 0.3 : 1}
                markerEnd={`url(#${arrowId})`}
                className="transition-[stroke,stroke-width,stroke-opacity] duration-150"
              />
            )
          })}
        </svg>

        <div className="relative z-10 flex flex-col gap-3">
          {/* 上排：海外（蓝） */}
          <div className="grid grid-cols-3 gap-1.5">
            {overseas.map((o) => (
              <Node key={o.id} item={o} register={register(o.id)} onOpen={onOpen} onHover={setHovered} />
            ))}
          </div>
          {/* 下排：国产（品牌紫） */}
          <div className="grid grid-cols-3 gap-1.5">
            {domestic.map((d) => (
              <Node key={d.id} item={d} register={register(d.id)} onOpen={onOpen} onHover={setHovered} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Node({
  item,
  register,
  onOpen,
  onHover,
}: {
  item: AltTool
  register: (el: HTMLButtonElement | null) => void
  onOpen: (t: AltTool) => void
  onHover: (id: string | null) => void
}) {
  const isCN = item.region === 'china'
  return (
    <button
      ref={register}
      onClick={() => onOpen(item)}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      title={`${item.name} · ${item.vendor}`}
      className={`group flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors ${
        isCN
          ? 'border-brand/40 bg-brand-soft text-brand hover:border-brand'
          : 'border-blue-500/40 bg-blue-500/10 text-blue-700 hover:border-blue-500 dark:text-blue-300'
      }`}
    >
      <LogoGlyph item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-tight">{item.name}</span>
      </span>
    </button>
  )
}

/** 9 场景同屏网格 */
export default function ReplacementMap({
  items,
  onOpen,
}: {
  items: AltTool[]
  onOpen: (t: AltTool) => void
}) {
  const byCategory = useMemo(() => {
    const map = new Map<AltCategory, AltTool[]>()
    for (const c of CATEGORY_ORDER) map.set(c, [])
    for (const it of items) map.get(it.category)?.push(it)
    return map
  }, [items])

  return (
    <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CATEGORY_ORDER.map((c) => {
        const list = byCategory.get(c) ?? []
        if (list.length === 0) return null
        return <ScenarioDiagram key={c} category={c} items={list} onOpen={onOpen} />
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 导出大图（PNG）：用纯 SVG 海报 + canvas 栅格化，绕开 DOM 测量       */
/* ------------------------------------------------------------------ */

const COLS = 3
const PANEL_W = 384
const PANEL_H = 250
const GAP = 18
const PAD = 24
const TITLE_H = 34
const NODE_W = 112
const NODE_H = 26
const NODE_GAP = 10
const ROW_GAP = 22

function posterSize() {
  const rows = Math.ceil(CATEGORY_ORDER.length / COLS)
  return {
    w: PAD * 2 + COLS * PANEL_W + (COLS - 1) * GAP,
    h: PAD * 2 + rows * PANEL_H + (rows - 1) * GAP,
  }
}

function drawNode(
  rects: string[],
  texts: string[],
  x: number,
  y: number,
  item: AltTool,
  esc: (s: string) => string
) {
  const isCN = item.region === 'china'
  const bg = isCN ? '#f3e8ff' : '#dbeafe'
  const stroke = isCN ? '#a855f7' : '#3b82f6'
  rects.push(`<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${bg}" stroke="${stroke}"/>`)
  const logo = LOGOS[item.id]
  if (logo && logo.kind === 'mono') {
    const s = 16 / 24
    const lx = x + 6
    const ly = y + (NODE_H - 16) / 2
    rects.push(`<g transform="translate(${lx} ${ly}) scale(${s})" fill="${logo.color}">${logo.inner}</g>`)
  } else {
    const lx = x + 6
    const ly = y + (NODE_H - 16) / 2
    rects.push(`<rect x="${lx}" y="${ly}" width="16" height="16" rx="4" fill="${stroke}"/>`)
    texts.push(
      `<text x="${lx + 8}" y="${ly + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" font-family="sans-serif">${esc(
        (item.name || '?').trim().charAt(0).toUpperCase()
      )}</text>`
    )
  }
  texts.push(
    `<text x="${x + 26}" y="${y + NODE_H / 2 + 4}" text-anchor="start" font-size="12" fill="${
      isCN ? '#6b21a8' : '#1e3a8a'
    }" font-family="sans-serif">${esc(item.name)}</text>`
  )
}

/** 由数据确定性生成整张大图 SVG（不依赖屏幕布局） */
export function buildPosterSVG(items: AltTool[]): string {
  const { w, h } = posterSize()
  const byCategory = new Map<AltCategory, AltTool[]>()
  for (const c of CATEGORY_ORDER) byCategory.set(c, [])
  for (const it of items) byCategory.get(it.category)?.push(it)

  const rects: string[] = []
  const texts: string[] = []
  const paths: string[] = []
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  CATEGORY_ORDER.forEach((c, k) => {
    const list = byCategory.get(c) ?? []
    if (list.length === 0) return
    const col = k % COLS
    const row = Math.floor(k / COLS)
    const px = PAD + col * (PANEL_W + GAP)
    const py = PAD + row * (PANEL_H + GAP)

    rects.push(`<rect x="${px}" y="${py}" width="${PANEL_W}" height="${PANEL_H}" rx="12" fill="#ffffff" stroke="#e2e8f0"/>`)
    texts.push(
      `<text x="${px + PANEL_W / 2}" y="${py + 22}" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a" font-family="sans-serif">${esc(
        CATEGORY_LABEL[c]
      )}</text>`
    )

    const overseas = list.filter((i) => i.region === 'overseas')
    const domestic = list.filter((i) => i.region === 'china')
    const areaTop = py + TITLE_H
    const colW = (PANEL_W - 24 - (overseas.length - 1) * NODE_GAP) / overseas.length
    const nodeX = (i: number) => px + 12 + i * (colW + NODE_GAP)

    // 上排：海外
    const ovY = areaTop
    const ovCenters: number[] = []
    overseas.forEach((o, i) => {
      const x = nodeX(i)
      ovCenters.push(ovY + NODE_H / 2)
      drawNode(rects, texts, x, ovY, o, esc)
    })
    // 下排：国产
    const dnY = areaTop + NODE_H + ROW_GAP
    const dnCenters: number[] = []
    domestic.forEach((d, i) => {
      const x = nodeX(i)
      dnCenters.push(dnY + NODE_H / 2)
      drawNode(rects, texts, x, dnY, d, esc)
    })

    // 连线：国产(下) → 海外(上)
    const nameToIdx = new Map(overseas.map((o, i) => [o.id, i]))
    domestic.forEach((d, di) => {
      for (const oid of d.replaces) {
        const oi = nameToIdx.get(oid)
        if (oi === undefined) continue
        const x1 = nodeX(di) + colW / 2
        const y1 = dnY
        const x2 = nodeX(oi) + colW / 2
        const y2 = ovY + NODE_H
        const dx = Math.max(24, Math.abs(x1 - x2) * 0.5)
        const my = (y1 + y2) / 2
        paths.push(
          `<path d="M ${x1} ${y1} C ${x1 - dx} ${my}, ${x2 + dx} ${my}, ${x2} ${y2}" fill="none" stroke="#cbd5e1" stroke-width="1.4" marker-end="url(#aaArrow)"/>`
        )
      }
    })
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif">
<defs><marker id="aaArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/></marker></defs>
<rect x="0" y="0" width="${w}" height="${h}" fill="#f8fafc"/>
${rects.join('\n')}
${paths.join('\n')}
${texts.join('\n')}
</svg>`
}

/** 把大图渲染成 PNG 并触发下载（无 canvas 支持时回退为 SVG 下载） */
export function downloadPoster(items: AltTool[]) {
  const svg = buildPosterSVG(items)
  const { w, h } = posterSize()
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  const fallback = () => {
    const a = document.createElement('a')
    a.href = svgUrl
    a.download = 'ai-alternatives-map.svg'
    a.click()
  }
  img.onload = () => {
    try {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return fallback()
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((b) => {
        if (b) {
          const a = document.createElement('a')
          a.href = URL.createObjectURL(b)
          a.download = 'ai-alternatives-map.png'
          a.click()
          URL.revokeObjectURL(a.href)
        } else fallback()
        URL.revokeObjectURL(svgUrl)
      }, 'image/png')
    } catch {
      fallback()
    }
  }
  img.onerror = fallback
  img.src = svgUrl
}
