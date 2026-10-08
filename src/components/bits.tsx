import type { ReactNode } from 'react'
import { AUTONOMY_COLORS, statusLabel, confidenceLabel } from '../lib/agents'
import type { Agent, Status, Confidence } from '../types'

/* ---------- 自主性徽章 ---------- */
export function AutonomyBadge({ level, size = 'sm' }: { level: number; size?: 'xs' | 'sm' }) {
  const color = AUTONOMY_COLORS[level]
  return (
    <span
      className={`aa-chip font-mono font-semibold ${
        size === 'xs' ? 'text-[10px]' : 'text-2xs'
      }`}
      style={{ backgroundColor: `${color}1f`, color }}
      title={`自主性等级 L${level}`}
    >
      L{level}
    </span>
  )
}

/* ---------- 状态徽章 ---------- */
const STATUS_STYLES: Record<Status, string> = {
  active: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  preview: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  maintenance: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  acquired: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  discontinued: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
}

export function StatusBadge({ status, showDot = true }: { status: Status; showDot?: boolean }) {
  const nonActive = status !== 'active'
  if (!nonActive) return null
  return (
    <span className={`aa-chip ${STATUS_STYLES[status]}`}>
      {showDot && <span className="size-1 rounded-full bg-current" />}
      {statusLabel(status)}
    </span>
  )
}

/* ---------- 可信度标识 ---------- */
const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-rose-600 dark:text-rose-400',
}

const CONFIDENCE_DOT: Record<Confidence, string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-rose-500',
}

export function ConfidenceMark({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-2xs ${CONFIDENCE_STYLES[confidence]}`}
      title={`数据可信度：${confidenceLabel(confidence)}`}
    >
      <span className={`size-1.5 rounded-full ${CONFIDENCE_DOT[confidence]}`} />
      {confidenceLabel(confidence)}
    </span>
  )
}

/* ---------- 区域标签 ---------- */
export function RegionTag({ region }: { region: Agent['region'] }) {
  return (
    <span className="aa-chip bg-brand-soft text-brand">
      {region === 'china' ? '国内' : '海外'}
    </span>
  )
}

/* ---------- 自动收录标识 ---------- */
/**
 * 标记「这条是每日脚本自动收录的，定级与描述还没人核实过」。
 *
 * 为什么用独立徽章而不是复用 dataConfidence：
 *   dataConfidence 是三档枚举（high/medium/low），low 已经有「待核实」语义，
 *   但它表达的是「来源可信度低」，不表达「这条是机器生成的、编辑字段是模板」。
 *   混为一谈会让读者以为「高置信度 = 人工核实过」，而自动收录的条目
 *   恰恰常有官方来源（github.com 仓库本身就算official）却是模板填充的。
 */
export function AutoBadge({
  date,
  size = 'sm',
  detail,
}: {
  date?: string
  size?: 'xs' | 'sm'
  /**
   * 「未核实」的具体含义。Agent 与模型的未核实点完全不同：
   *   Agent 是编辑字段（定级/描述/适用场景）靠规则推断；
   *   模型是价格与上下文窗口靠第三方聚合器，未经厂商官方确认。
   * 不区分的话，同一个徽章在两个页面会给出误导性的解释。
   */
  detail?: string
}) {
  const reason =
    detail ??
    '定级、描述与适用场景均为规则推断，尚未人工核实，请以官方文档为准'
  return (
    <span
      className={`aa-chip border border-dashed border-amber-500/50 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300 ${
        size === 'xs' ? 'text-[10px]' : 'text-2xs'
      }`}
      title={date ? `${date} 由每日更新脚本自动收录：${reason}` : `由每日更新脚本自动收录：${reason}`}
    >
      自动收录 · 待核实
    </span>
  )
}

/* ---------- 通用标签 ---------- */
export function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`aa-chip bg-faint/15 text-muted ${className}`}>{children}</span>
  )
}

/* ---------- 源链接 ---------- */
export function SourceLinks({ sources }: { sources: Agent['sources'] }) {
  const typeLabel = {
    official: '官方',
    media: '媒体',
    community: '社区',
    research: '研究',
  } as const

  return (
    <ul className="space-y-1.5">
      {sources.map((s, i) => (
        <li key={i}>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 text-xs text-muted hover:text-brand"
          >
            <span className="aa-chip mt-px shrink-0 bg-faint/15 text-2xs text-faint">
              {typeLabel[s.type]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="aa-line-clamp-2 group-hover:underline">{s.title}</span>
              <span className="ml-1 text-2xs text-faint">{s.date}</span>
            </span>
            <svg
              className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" strokeLinecap="round" />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  )
}

/* ---------- 空状态 ---------- */
export function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-20 text-center">
      <div className="mb-3 text-3xl opacity-40">◇</div>
      <p className="text-sm font-medium">没有匹配的产品</p>
      <p className="mt-1 text-xs text-muted">试着放宽筛选条件，或清空后重新浏览</p>
      <button
        onClick={onReset}
        className="mt-4 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand hover:text-brand"
      >
        清空筛选
      </button>
    </div>
  )
}
