import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AltCategory, AltTool } from '../../types-alternative'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../../lib/alternatives'
import { LOGOS } from '../../data/logos'

/*
 * 替代关系图：9 个场景同屏网格。每格内「海外(左) → 国产(右)」用中间走廊的 SVG 连线表示替代，
 * 箭头指向被替代的海外工具。左/右两列节点紧凑、中间走廊留白，连线清晰不挤。
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
        <svg viewBox={logo.viewBox} width={size} height={size} className={cls} aria-hidden>
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

/** 单场景的关系子图（左右排：海外左 / 国产右，中间走廊连线） */
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
        const f = nodeEls.current.get(from) // 国产（右列）
        const t = nodeEls.current.get(to) // 海外（左列）
        if (!f || !t) return null
        const fr = f.getBoundingClientRect()
        const tr = t.getBoundingClientRect()
        // 连线从国产(右列左缘)弯到海外(左列右缘)，箭头落在海外（被替代者）
        const xR = fr.left - cr.left
        const yR = fr.top - cr.top + fr.height / 2
        const xL = tr.right - cr.left
        const yL = tr.top - cr.top + tr.height / 2
        const dx = Math.max(22, (xR - xL) * 0.45)
        const d = `M ${xR} ${yR} C ${xR + dx} ${yR}, ${xL - dx} ${yL}, ${xL} ${yL}`
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
      <div ref={containerRef} className="relative flex min-h-[150px] items-stretch gap-2">
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

        {/* 左列：海外（蓝） */}
        <div className="relative z-10 flex w-[42%] flex-col justify-center gap-1.5">
          {overseas.map((o) => (
            <Node key={o.id} item={o} register={register(o.id)} onOpen={onOpen} onHover={setHovered} />
          ))}
        </div>
        {/* 中间走廊：仅作连线通道，节点不占位 */}
        <div className="relative z-0 flex-1" />
        {/* 右列：国产（品牌紫） */}
        <div className="relative z-10 flex w-[42%] flex-col justify-center gap-1.5">
          {domestic.map((d) => (
            <Node key={d.id} item={d} register={register(d.id)} onOpen={onOpen} onHover={setHovered} />
          ))}
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
const NODE_GAP = 12
const COL_PAD = 14

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
  } else if (logo) {
    // 彩色 SVG / 位图 data-URI：按 viewBox 等比缩到 16px 方框内，直接内嵌（自带颜色）
    const [_, __, vw = 24, vh = 24] = logo.viewBox.split(/\s+/).map(Number)
    const s = 16 / Math.max(vw, vh)
    const ox = (16 - vw * s) / 2
    const oy = (16 - vh * s) / 2
    const lx = x + 6
    const ly = y + (NODE_H - 16) / 2
    rects.push(`<g transform="translate(${lx + ox} ${ly + oy}) scale(${s})">${logo.inner}</g>`)
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

/** 由数据确定性生成整张大图 SVG（不依赖屏幕布局，左右排） */
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
    const areaTop = py + TITLE_H + 8
    // 左列节点 x、右列节点 x（中缝 CORRIDOR 留白）
    const leftX = px + COL_PAD
    const rightX = px + PANEL_W - COL_PAD - NODE_W
    const nodeY = (i: number) => areaTop + i * (NODE_H + NODE_GAP)

    overseas.forEach((o, i) => drawNode(rects, texts, leftX, nodeY(i), o, esc))
    domestic.forEach((d, i) => drawNode(rects, texts, rightX, nodeY(i), d, esc))

    // 连线：国产(右列左缘) → 海外(左列右缘)，箭头落在海外
    const nameToIdx = new Map(overseas.map((o, i) => [o.id, i]))
    domestic.forEach((d, di) => {
      for (const oid of d.replaces) {
        const oi = nameToIdx.get(oid)
        if (oi === undefined) continue
        const xR = rightX
        const yR = nodeY(di) + NODE_H / 2
        const xL = leftX + NODE_W
        const yL = nodeY(oi) + NODE_H / 2
        const dx = Math.max(22, (xR - xL) * 0.45)
        paths.push(
          `<path d="M ${xR} ${yR} C ${xR + dx} ${yR}, ${xL - dx} ${yL}, ${xL} ${yL}" fill="none" stroke="#cbd5e1" stroke-width="1.4" marker-end="url(#aaArrow)"/>`
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
