import { meta, TIER_ORDER, tierColor, AUTONOMY_COLORS } from '../../lib/agents'
import type { Filters } from '../../hooks/useAtlas'
import type { Tier, Deployment, Modality, PricingModel } from '../../types'

interface Props {
  filters: Filters
  actions: ReturnType<typeof import('../../hooks/useAtlas')['useFilters']>
  resultCount: number
}

const REGIONS = [
  { key: 'overseas' as const, label: '海外' },
  { key: 'china' as const, label: '国内' },
]

const DEPLOYMENTS = Object.keys(meta.deployments) as Deployment[]
const MODALITIES = Object.keys(meta.modalities) as Modality[]
const PRICING = Object.keys(meta.pricingModels) as PricingModel[]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">
        {title}
      </h4>
      {children}
    </div>
  )
}

/** 单选芯片：互斥维度专用。
 *  未选中态是纯文字（无底色），只有选中才上色并加内描边——
 *  避免一排灰底按钮看起来像「都已勾选」。 */
function SingleChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors ${
        active
          ? 'border-transparent text-white'
          : 'border-edge bg-transparent text-muted hover:border-faint/40 hover:text-ink'
      }`}
      style={active ? { backgroundColor: color || 'rgb(var(--brand))' } : undefined}
    >
      {children}
    </button>
  )
}

export function FilterPanel({ filters, actions, resultCount }: Props) {
  return (
    <div className="aa-card aa-no-print space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">筛选</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-2xs tabular-nums text-muted">
            {resultCount} 项
          </span>
          {actions.activeCount > 0 && (
            <button
              onClick={actions.reset}
              className="text-2xs text-brand hover:underline"
            >
              清空
            </button>
          )}
        </div>
      </div>

      <Group title="地区">
        <div className="flex gap-1.5">
          {REGIONS.map((r) => (
            <SingleChip
              key={r.key}
              active={filters.regions.has(r.key)}
              onClick={() => actions.toggleRegion(r.key)}
            >
              {r.label}
            </SingleChip>
          ))}
        </div>
      </Group>

      <Group title="分类">
        <div className="space-y-1">
          {TIER_ORDER.map((t: Tier) => (
            <button
              key={t}
              onClick={() => actions.toggleTier(t)}
              aria-pressed={filters.tiers.has(t)}
              className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-2xs transition-colors ${
                filters.tiers.has(t)
                  ? 'border-transparent text-white'
                  : 'border-edge bg-transparent hover:border-faint/40'
              }`}
              style={filters.tiers.has(t) ? { backgroundColor: tierColor(t) } : undefined}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: filters.tiers.has(t) ? '#fff' : tierColor(t),
                  opacity: filters.tiers.has(t) ? 1 : 0.45,
                }}
              />
              <span className={filters.tiers.has(t) ? 'font-medium' : 'text-muted'}>
                {meta.tiers[t].label}
              </span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={filters.autonomyMin ? `自主性 · L${filters.autonomyMin} 及以上` : '自主性'}>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((l) => (
            <button
              key={l}
              onClick={() => actions.setMinAutonomy(filters.autonomyMin === l ? 0 : l)}
              aria-pressed={filters.autonomyMin === l}
              className={`rounded-md border px-2 py-1 text-2xs font-semibold transition-colors ${
                filters.autonomyMin === l
                  ? 'border-transparent text-white'
                  : 'border-edge bg-transparent text-muted hover:border-faint/40 hover:text-ink'
              }`}
              style={filters.autonomyMin === l ? { backgroundColor: AUTONOMY_COLORS[l] } : undefined}
            >
              L{l}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
          {filters.autonomyMin === 0
            ? '不限制，显示全部等级'
            : `显示 L${filters.autonomyMin} – L5 的产品`}
        </p>
      </Group>

      <Group title="部署形态">
        <div className="flex flex-wrap gap-1.5">
          {DEPLOYMENTS.map((d) => (
            <SingleChip
              key={d}
              active={filters.deployments.has(d)}
              onClick={() => actions.toggleDeployment(d)}
            >
              {meta.deployments[d].label}
            </SingleChip>
          ))}
        </div>
      </Group>

      <Group title="模态">
        <div className="flex flex-wrap gap-1.5">
          {MODALITIES.map((m) => (
            <SingleChip
              key={m}
              active={filters.modalities.has(m)}
              onClick={() => actions.toggleModality(m)}
            >
              {meta.modalities[m].label}
            </SingleChip>
          ))}
        </div>
      </Group>

      <Group title="价格模式">
        <div className="flex flex-wrap gap-1.5">
          {PRICING.map((p) => (
            <SingleChip
              key={p}
              active={filters.pricing.has(p)}
              onClick={() => actions.togglePricing(p)}
            >
              {meta.pricingModels[p].label}
            </SingleChip>
          ))}
        </div>
      </Group>

      <Group title="开源">
        <button
          onClick={actions.toggleOpenSource}
          aria-pressed={filters.openSourceOnly}
          className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-2xs font-medium transition-colors ${
            filters.openSourceOnly
              ? 'border-transparent bg-brand text-white'
              : 'border-edge bg-transparent text-muted hover:border-faint/40'
          }`}
        >
          仅看开源项目
          <span
            className={`size-3 rounded-full border ${
              filters.openSourceOnly ? 'border-white bg-white' : 'border-faint'
            }`}
          />
        </button>
      </Group>
    </div>
  )
}
