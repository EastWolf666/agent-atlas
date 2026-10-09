import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AltCategory, AltTool } from '../../types-alternative'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../../lib/alternatives'

/*
 * 替代关系图：9 个场景同屏网格，每格内「海外(左) ← 国产(右)」用 SVG 连线表示替代关系。
 *
 * 为什么用 DOM 节点 + SVG 连线、而不是纯 SVG：
 *   节点要可点击跳详情、可悬停高亮，纯 SVG 文本交互比 HTML 麻烦得多；
 *   连线用一层绝对定位的 SVG overlay 画，节点坐标在渲染后用 getBoundingClientRect 量出来，
 *   这样响应式改宽高时连线自动跟着重算（ResizeObserver 兜底）。
 */

type LinkDef = { from: string; to: string }
type LinkPath = { from: string; to: string; d: string }

/** 单场景的关系子图 */
function ScenarioDiagram({
  category,
  items,
  onOpen,
}: {
  category: AltCategory
  items: AltTool[]
  onOpen: (t: AltTool) => void
}) {
  const overseas = items.filter((i) => i.region === 'overseas')
  const domestic = items.filter((i) => i.region === 'china')

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
        const f = nodeEls.current.get(from)
        const t = nodeEls.current.get(to)
        if (!f || !t) return null
        const fr = f.getBoundingClientRect()
        const tr = t.getBoundingClientRect()
        // 国产在右 → 取其左边缘；海外在左 → 取其右边缘；连线从国产指向海外
        const x1 = fr.left - cr.left
        const y1 = fr.top - cr.top + fr.height / 2
        const x2 = tr.right - cr.left
        const y2 = tr.top - cr.top + tr.height / 2
        const dx = Math.max(36, (x1 - x2) * 0.4)
        const d = `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}`
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
    // 字体/布局稳定后再量一次，避免首帧错位
    const raf = requestAnimationFrame(() => measure())
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [measure])

  const arrowId = `aa-arrow-${category}`

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
              markerWidth="6"
              markerHeight="6"
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
                strokeWidth={active ? 2.2 : 1.3}
                markerEnd={`url(#${arrowId})`}
                className="transition-[stroke,stroke-width] duration-150"
              />
            )
          })}
        </svg>

        <div className="relative z-10 flex gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {overseas.map((o) => (
              <Node
                key={o.id}
                item={o}
                register={(el) => {
                  if (el) nodeEls.current.set(o.id, el)
                  else nodeEls.current.delete(o.id)
                }}
                onOpen={onOpen}
                onHover={setHovered}
              />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {domestic.map((d) => (
              <Node
                key={d.id}
                item={d}
                register={(el) => {
                  if (el) nodeEls.current.set(d.id, el)
                  else nodeEls.current.delete(d.id)
                }}
                onOpen={onOpen}
                onHover={setHovered}
              />
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
      className={`group w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
        isCN
          ? 'border-brand/40 bg-brand-soft text-brand hover:border-brand'
          : 'border-blue-500/40 bg-blue-500/10 text-blue-700 hover:border-blue-500 dark:text-blue-300'
      }`}
    >
      <span className="block truncate text-2xs font-medium">{item.name}</span>
      <span className="block truncate text-[10px] opacity-70">{item.vendor}</span>
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
    <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
const PANEL_H = 252
const GAP = 18
const PAD = 24
const TITLE_H = 36
const NODE_W = 150
const NODE_H = 24
const NODE_GAP = 10

function posterSize() {
  const rows = Math.ceil(CATEGORY_ORDER.length / COLS)
  return {
    w: PAD * 2 + COLS * PANEL_W + (COLS - 1) * GAP,
    h: PAD * 2 + rows * PANEL_H + (rows - 1) * GAP,
  }
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

    rects.push(
      `<rect x="${px}" y="${py}" width="${PANEL_W}" height="${PANEL_H}" rx="12" fill="#ffffff" stroke="#e2e8f0"/>`
    )
    texts.push(
      `<text x="${px + PANEL_W / 2}" y="${py + 24}" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a" font-family="sans-serif">${esc(
        CATEGORY_LABEL[c]
      )}</text>`
    )

    const overseas = list.filter((i) => i.region === 'overseas')
    const domestic = list.filter((i) => i.region === 'china')
    const areaTop = py + TITLE_H + 12
    const avail = PANEL_H - TITLE_H - 24
    const blockH = (n: number) => n * NODE_H + (n - 1) * NODE_GAP

    const ovX = px + 14
    const dnX = px + PANEL_W - 14 - NODE_W
    const ovStart = areaTop + Math.max(0, (avail - blockH(overseas.length)) / 2)
    const dnStart = areaTop + Math.max(0, (avail - blockH(domestic.length)) / 2)

    const ovCenters: number[] = []
    overseas.forEach((o, i) => {
      const y = ovStart + i * (NODE_H + NODE_GAP)
      ovCenters.push(y + NODE_H / 2)
      rects.push(
        `<rect x="${ovX}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="#dbeafe" stroke="#3b82f6"/>`
      )
      texts.push(
        `<text x="${ovX + NODE_W / 2}" y="${y + NODE_H / 2 + 4}" text-anchor="middle" font-size="12" fill="#1e3a8a" font-family="sans-serif">${esc(
          o.name
        )}</text>`
      )
    })

    const dnCenters: number[] = []
    domestic.forEach((d, i) => {
      const y = dnStart + i * (NODE_H + NODE_GAP)
      dnCenters.push(y + NODE_H / 2)
      rects.push(
        `<rect x="${dnX}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="#f3e8ff" stroke="#a855f7"/>`
      )
      texts.push(
        `<text x="${dnX + NODE_W / 2}" y="${y + NODE_H / 2 + 4}" text-anchor="middle" font-size="12" fill="#6b21a8" font-family="sans-serif">${esc(
          d.name
        )}</text>`
      )
    })

    // 连线：国产(右) → 海外(左)
    const nameToIdx = new Map(overseas.map((o, i) => [o.id, i]))
    domestic.forEach((d, di) => {
      for (const oid of d.replaces) {
        const oi = nameToIdx.get(oid)
        if (oi === undefined) continue
        const x1 = dnX
        const y1 = dnCenters[di]
        const x2 = ovX + NODE_W
        const y2 = ovCenters[oi]
        const dx = Math.max(36, (x1 - x2) * 0.4)
        paths.push(
          `<path d="M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}" fill="none" stroke="#cbd5e1" stroke-width="1.4" marker-end="url(#aaArrow)"/>`
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
