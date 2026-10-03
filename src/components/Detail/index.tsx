import { useEffect, useRef } from 'react'
import {
  meta,
  tierColor,
  tierLabel,
  AUTONOMY_COLORS,
  pricingLabel,
  deploymentLabel,
  modalityLabel,
  relatedAgents,
  statusLabel,
} from '../../lib/agents'
import {
  AutonomyBadge,
  StatusBadge,
  RegionTag,
  ConfidenceMark,
  SourceLinks,
  Tag,
} from '../bits'
import type { Agent } from '../../types'

interface Props {
  agent: Agent
  onClose: () => void
  onSelect: (id: string) => void
  onToggleCompare: (id: string) => void
  inCompare: boolean
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3 py-2">
      <dt className="text-2xs text-faint">{label}</dt>
      <dd className="text-xs leading-relaxed">{children}</dd>
    </div>
  )
}

export function DetailPanel({ agent, onClose, onSelect, onToggleCompare, inCompare }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Tab 焦点陷阱：浮层是模态，焦点必须留在内部，
      // 否则 Tab 会走到被遮罩挡住的背景内容上（键盘用户看不见）。
      if (e.key !== 'Tab' || !ref.current) return
      const focusables = ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // 记住打开前的焦点，关闭后归还——否则焦点掉到 body，键盘用户会丢失位置
    const prevFocus = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    // 锁定背景滚动
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      prevFocus?.focus?.()
    }
  }, [onClose, agent.id])

  const related = relatedAgents(agent)
  const autoColor = AUTONOMY_COLORS[agent.autonomyLevel]

  return (
    <>
      <div
        className="aa-no-print fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} 详情`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg animate-slide-in-right flex-col border-l border-edge bg-panel shadow-2xl outline-none"
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3 border-b border-edge p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <RegionTag region={agent.region} />
              <StatusBadge status={agent.status} />
              {agent.openSource && (
                <span className="aa-chip bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  开源
                </span>
              )}
            </div>
            <h2 className="mt-2 text-lg font-semibold">{agent.name}</h2>
            {agent.nameZh && <p className="text-xs text-faint">{agent.nameZh}</p>}
            <p className="mt-1 text-xs text-muted">{agent.vendor}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="aa-no-print shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-faint/10 hover:text-ink"
          >
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <p className="text-sm leading-relaxed">{agent.description}</p>

          {/* 自主性评级依据 */}
          <section className="rounded-lg border p-3" style={{ borderColor: `${autoColor}44` }}>
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-sm font-semibold"
                style={{ color: autoColor }}
              >
                L{agent.autonomyLevel}
              </span>
              <span className="text-xs font-medium">
                {meta.autonomyLevels[String(agent.autonomyLevel)].name}
              </span>
            </div>
            <p className="mt-1.5 text-2xs text-muted">{agent.autonomyReason}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-2xs text-faint hover:text-brand">
                查看该等级的判定标准
              </summary>
              <div className="mt-1.5 space-y-1 rounded-md bg-faint/8 p-2 text-2xs text-muted">
                <p>
                  <strong className="text-ink">标准：</strong>
                  {meta.autonomyLevels[String(agent.autonomyLevel)].criteria}
                </p>
                <p>
                  <strong className="text-ink">判定依据：</strong>
                  {meta.autonomyLevels[String(agent.autonomyLevel)].benchmark}
                </p>
              </div>
            </details>
          </section>

          {/* 亮点与局限 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-edge bg-emerald-500/[.04] p-3">
              <h4 className="text-2xs font-semibold text-emerald-600 dark:text-emerald-400">
                亮点
              </h4>
              <ul className="mt-1.5 space-y-1">
                {agent.highlights.map((h) => (
                  <li key={h} className="flex gap-1.5 text-2xs leading-relaxed">
                    <span className="text-emerald-500">+</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-edge bg-rose-500/[.04] p-3">
              <h4 className="text-2xs font-semibold text-rose-600 dark:text-rose-400">
                局限
              </h4>
              <ul className="mt-1.5 space-y-1">
                {agent.limitations.map((l) => (
                  <li key={l} className="flex gap-1.5 text-2xs leading-relaxed">
                    <span className="text-rose-500">−</span>
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 推荐场景 */}
          <div className="rounded-lg border border-brand/30 bg-brand-soft p-3">
            <h4 className="text-2xs font-semibold text-brand">什么情况下选它</h4>
            <p className="mt-1 text-xs leading-relaxed">{agent.bestFor}</p>
          </div>

          {/* 结构化字段 */}
          <section>
            <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">
              技术与商业信息
            </h4>
            <dl className="divide-y divide-edge">
              <Row label="分类">
                <span
                  className="aa-chip"
                  style={{
                    backgroundColor: `${tierColor(agent.tier)}1a`,
                    color: tierColor(agent.tier),
                  }}
                >
                  {tierLabel(agent.tier)}
                </span>
                {agent.verticalDomain && (
                  <span className="ml-1.5">{agent.verticalDomain}</span>
                )}
              </Row>
              <Row label="状态">
                {statusLabel(agent.status)}
                <span className="ml-1.5 text-faint">
                  — {meta.statuses[agent.status].desc}
                </span>
              </Row>
              <Row label="部署形态">
                <div className="flex flex-wrap gap-1">
                  {agent.deployment.map((d) => (
                    <Tag key={d}>{deploymentLabel(d)}</Tag>
                  ))}
                </div>
              </Row>
              <Row label="价格模式">
                {pricingLabel(agent.pricingModel)}
                <span className="ml-1.5 text-faint">{agent.pricingNote}</span>
              </Row>
              <Row label="上下文">
                <span className="font-mono">{agent.contextWindow}</span>
              </Row>
              <Row label="支持模态">
                <div className="flex flex-wrap gap-1">
                  {agent.modalities.map((m) => (
                    <Tag key={m}>{modalityLabel(m)}</Tag>
                  ))}
                </div>
              </Row>
              <Row label="数据可信度">
                <ConfidenceMark confidence={agent.dataConfidence} />
                <span className="ml-1.5 text-faint">
                  {meta.dataConfidence[agent.dataConfidence].desc}
                </span>
              </Row>
              <Row label="采集时间">
                <span className="font-mono">{agent.lastVerified}</span>
              </Row>
            </dl>
          </section>

          {/* 来源 */}
          <section>
            <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">
              数据来源（{agent.sources.length}）
            </h4>
            <SourceLinks sources={agent.sources} />
          </section>

          {/* 相关产品 */}
          {related.length > 0 && (
            <section>
              <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">
                相关产品
              </h4>
              <div className="space-y-1.5">
                {related.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-edge px-2.5 py-2 text-left transition-colors hover:border-brand/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{r.name}</span>
                      <span className="block truncate text-2xs text-faint">
                        {r.vendor} · {tierLabel(r.tier)}
                      </span>
                    </span>
                    <AutonomyBadge level={r.autonomyLevel} size="xs" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* 底部操作 */}
        <div className="aa-no-print flex items-center gap-2 border-t border-edge p-3">
          <button
            onClick={() => onToggleCompare(agent.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              inCompare
                ? 'border-brand bg-brand text-white'
                : 'border-edge hover:border-brand hover:text-brand'
            }`}
          >
            {inCompare ? '已在对比中' : '加入对比'}
          </button>
          <a
            href={agent.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            访问官网 ↗
          </a>
        </div>
      </div>
    </>
  )
}
