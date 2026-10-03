import { useEffect, useRef } from 'react'
import {
  tierColor,
  tierLabel,
  AUTONOMY_COLORS,
  pricingLabel,
  deploymentLabel,
  modalityLabel,
  statusLabel,
  meta,
} from '../../lib/agents'
import { ConfidenceMark } from '../bits'
import type { Agent } from '../../types'

interface Props {
  agents: Agent[]
  onClose: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onBrowse: () => void
}

interface RowDef {
  label: string
  render: (a: Agent) => React.ReactNode
  /** 提取用于差异比对的原始值 */
  key: (a: Agent) => string
}

const ROWS: RowDef[] = [
  {
    label: '定位',
    render: (a) => <span className="text-muted">{a.tagline}</span>,
    key: (a) => a.tagline,
  },
  { label: '厂商', render: (a) => a.vendor, key: (a) => a.vendor },
  {
    label: '地区',
    render: (a) => (a.region === 'china' ? '国内' : '海外'),
    key: (a) => a.region,
  },
  {
    label: '分类',
    render: (a) => (
      <span
        className="aa-chip"
        style={{ backgroundColor: `${tierColor(a.tier)}1a`, color: tierColor(a.tier) }}
      >
        {tierLabel(a.tier)}
      </span>
    ),
    key: (a) => a.tier,
  },
  {
    label: '自主性',
    render: (a) => {
      const c = AUTONOMY_COLORS[a.autonomyLevel]
      return (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex size-5 items-center justify-center rounded font-mono text-2xs font-bold"
            style={{ backgroundColor: `${c}1f`, color: c }}
          >
            {a.autonomyLevel}
          </span>
          <span className="text-muted">{meta.autonomyLevels[String(a.autonomyLevel)].name}</span>
        </span>
      )
    },
    key: (a) => String(a.autonomyLevel),
  },
  {
    label: '状态',
    render: (a) => (
      <span className={a.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
        {statusLabel(a.status)}
      </span>
    ),
    key: (a) => a.status,
  },
  {
    label: '部署形态',
    render: (a) => (
      <span className="flex flex-wrap gap-1">
        {a.deployment.map((d) => (
          <span key={d} className="aa-chip bg-faint/15 text-muted">
            {deploymentLabel(d)}
          </span>
        ))}
      </span>
    ),
    key: (a) => a.deployment.join(','),
  },
  {
    label: '价格模式',
    render: (a) => (
      <span>
        <span className="font-medium">{pricingLabel(a.pricingModel)}</span>
        <span className="mt-0.5 block text-2xs text-faint">{a.pricingNote}</span>
      </span>
    ),
    key: (a) => a.pricingModel,
  },
  {
    label: '上下文',
    render: (a) => <span className="font-mono">{a.contextWindow}</span>,
    key: (a) => a.contextWindow,
  },
  {
    label: '支持模态',
    render: (a) => (
      <span className="flex flex-wrap gap-1">
        {a.modalities.map((m) => (
          <span key={m} className="aa-chip bg-faint/15 text-muted">
            {modalityLabel(m)}
          </span>
        ))}
      </span>
    ),
    key: (a) => a.modalities.join(','),
  },
  {
    label: '开源',
    render: (a) =>
      a.openSource ? (
        <span className="text-emerald-600 dark:text-emerald-400">是</span>
      ) : (
        <span className="text-faint">否</span>
      ),
    key: (a) => String(a.openSource),
  },
  {
    label: '数据可信度',
    render: (a) => <ConfidenceMark confidence={a.dataConfidence} />,
    key: (a) => a.dataConfidence,
  },
  {
    label: '采集时间',
    render: (a) => <span className="font-mono text-muted">{a.lastVerified}</span>,
    key: (a) => a.lastVerified,
  },
]

export function CompareView({ agents, onClose, onRemove, onClear, onBrowse }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Tab 焦点陷阱，理由同详情面板：模态必须锁住焦点
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
    const prevFocus = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      prevFocus?.focus?.()
    }
  }, [onClose])

  // 找出取值不一致的行，这些行高亮
  const diffRows = new Set(
    ROWS.filter((r) => {
      const vals = agents.map((a) => r.key(a))
      return new Set(vals).size > 1
    }).map((r) => r.label)
  )

  const cols = agents.length

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
        aria-label="产品对比"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-5xl animate-slide-in-right flex-col border-l border-edge bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge p-4">
          <div>
            <h2 className="text-sm font-semibold">
              对比 {cols} 个产品
              {diffRows.size > 0 && (
                <span className="ml-2 text-2xs font-normal text-muted">
                  <span className="mr-1 inline-block size-2 rounded-sm bg-amber-400/40 align-middle" />
                  {diffRows.size} 项存在差异
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-2xs text-muted">差异行已高亮，最多可对比 4 个</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onClear}
              className="aa-no-print rounded-lg border border-edge px-2.5 py-1.5 text-2xs font-medium text-muted transition-colors hover:border-rose-400 hover:text-rose-500"
            >
              清空
            </button>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="aa-no-print rounded-lg p-1.5 text-muted transition-colors hover:bg-faint/10 hover:text-ink"
            >
              <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr>
                <th className="w-24 border-b border-edge p-3 text-2xs font-medium text-faint">
                  对比项
                </th>
                {agents.map((a) => (
                  <th
                    key={a.id}
                    className="min-w-[180px] border-b border-l border-edge p-3 align-top"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{a.name}</p>
                        {a.nameZh && (
                          <p className="truncate text-2xs text-faint">{a.nameZh}</p>
                        )}
                      </div>
                      <button
                        onClick={() => onRemove(a.id)}
                        aria-label={`移除 ${a.name}`}
                        className="aa-no-print shrink-0 rounded p-0.5 text-faint transition-colors hover:text-rose-500"
                      >
                        <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const diff = diffRows.has(row.label)
                return (
                  <tr key={row.label} className={diff ? 'bg-amber-400/[.06]' : ''}>
                    <th
                      scope="row"
                      className="border-b border-edge p-3 text-2xs font-normal text-faint"
                    >
                      {row.label}
                      {diff && (
                        <span className="ml-1 inline-block size-1.5 rounded-full bg-amber-400 align-middle" />
                      )}
                    </th>
                    {agents.map((a) => (
                      <td
                        key={a.id}
                        className="border-b border-l border-edge p-3 align-top text-xs"
                      >
                        {row.render(a)}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {/* 推荐场景单独放在底部，横向铺开更易读 */}
              <tr>
                <th
                  scope="row"
                  className="border-b border-edge p-3 text-2xs font-normal text-faint"
                >
                  选型建议
                </th>
                {agents.map((a) => (
                  <td
                    key={a.id}
                    className="border-b border-l border-edge p-3 align-top text-xs leading-relaxed"
                  >
                    {a.bestFor}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="aa-no-print flex items-center justify-between gap-3 border-t border-edge p-3">
          <p className="text-2xs text-faint">
            价格与状态变动较快，采购前请回到官网确认
          </p>
          <button
            onClick={() => {
              onClose()
              onBrowse()
            }}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            继续挑选
          </button>
        </div>
      </div>
    </>
  )
}
