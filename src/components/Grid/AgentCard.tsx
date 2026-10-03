import { tierColor, tierLabel } from '../../lib/agents'
import { AutonomyBadge, StatusBadge, RegionTag, Tag } from '../bits'
import type { Agent } from '../../types'

interface Props {
  agent: Agent
  onOpen: (id: string) => void
  onToggleCompare: (id: string) => void
  selected: boolean
  compareFull: boolean
}

export function AgentCard({ agent, onOpen, onToggleCompare, selected, compareFull }: Props) {
  const disabled = compareFull && !selected

  return (
    <article
      className={`aa-card group relative flex flex-col p-4 ${
        selected ? 'border-brand ring-1 ring-brand' : 'hover:border-brand/40'
      }`}
    >
      {/*
        整卡可点：用一张铺满卡片的透明按钮作点击层（z-[1]），
        标题区不再单独包按钮，避免「只能点名字」的狭窄命中区。
        「对比」等交互控件通过 relative z-10 浮在点击层之上，
        各自独立可点，不会被整卡点击劫持。
      */}
      <button
        type="button"
        onClick={() => onOpen(agent.id)}
        aria-label={`查看 ${agent.name} 详情`}
        className="absolute inset-0 z-[1] cursor-pointer rounded-[inherit]"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold transition-colors group-hover:text-brand">
            {agent.name}
          </h3>
          {agent.nameZh && (
            <p className="truncate text-2xs text-faint">{agent.nameZh}</p>
          )}
          <p className="mt-1 truncate text-2xs text-muted">{agent.vendor}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RegionTag region={agent.region} />
          <AutonomyBadge level={agent.autonomyLevel} />
        </div>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-muted">{agent.tagline}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span
          className="aa-chip"
          style={{
            backgroundColor: `${tierColor(agent.tier)}1a`,
            color: tierColor(agent.tier),
          }}
        >
          {tierLabel(agent.tier)}
        </span>
        {agent.verticalDomain && <Tag>{agent.verticalDomain}</Tag>}
        {agent.highlights.slice(0, 2).map((h) => (
          <Tag key={h}>{h}</Tag>
        ))}
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={agent.status} />
          {agent.openSource && (
            <span className="aa-chip bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              开源
            </span>
          )}
        </div>
        <button
          onClick={() => onToggleCompare(agent.id)}
          disabled={disabled}
          title={
            disabled ? '对比最多 4 个，请先取消一个' : selected ? '从对比中移除' : '加入对比'
          }
          aria-pressed={selected}
          className={`aa-no-print relative z-10 rounded-md border px-2 py-1 text-2xs font-medium transition-colors ${
            selected
              ? 'border-brand bg-brand text-white'
              : disabled
                ? 'cursor-not-allowed border-edge text-faint opacity-50'
                : 'border-edge text-muted hover:border-brand hover:text-brand'
          }`}
        >
          {selected ? '已选' : '对比'}
        </button>
      </div>
    </article>
  )
}
