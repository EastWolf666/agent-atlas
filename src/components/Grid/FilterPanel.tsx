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
      <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint lg:mb-2">
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
      className={`rounded-md border px-2.5 py-0.5 text-2xs font-medium transition-colors lg:py-1 ${
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
    <div className="aa-card aa-no-print p-3 lg:p-4">
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

      {/*
        响应式分组布局：
        - 手机/平板（<lg，筛选面板在折叠区里展开）：2 列网格，把「分类」和「开源」
          这种较高的分组跨满整行，其余矮分组配对并排，显著缩短展开后的纵向高度，
          避免一屏滚不到底。
        - 桌面（lg+，左侧吸附侧栏，宽约 248px）：回到单列宽松布局，保持原观感。
      */}
      {/*
        响应式分组布局：
        - 手机/平板（<lg）：2 列紧凑网格，所有分组都按格子放置（不再有跨整行的分组），
          「分类」在手机端改为横排 chip、桌面端仍是竖排整宽（观感不变），整体更短更紧凑。
        - 桌面（lg+，左侧吸附侧栏）：回到单列宽松布局，保持原观感。
      */}
      <div className="mt-3 grid grid-cols-1 gap-3 max-lg:grid-cols-2 max-lg:gap-2 max-lg:mt-3 lg:mt-5 lg:gap-y-5">
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
          <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
            {TIER_ORDER.map((t: Tier) => (
              <button
                key={t}
                onClick={() => actions.toggleTier(t)}
                aria-pressed={filters.tiers.has(t)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-2xs font-medium transition-colors lg:w-full lg:gap-2 lg:px-2.5 lg:py-1 ${
                  filters.tiers.has(t)
                    ? 'border-transparent text-white'
                    : 'border-edge bg-transparent text-muted hover:border-faint/40 hover:text-ink'
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
                <span className={filters.tiers.has(t) ? 'font-medium' : ''}>
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
                className={`rounded-md border px-2 py-0.5 text-2xs font-semibold transition-colors lg:py-1 ${
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
          <p className="mt-1 text-[10px] leading-relaxed text-faint max-lg:hidden lg:mt-1.5">
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

        <div className="max-lg:col-span-1">
          <button
            onClick={actions.toggleOpenSource}
            aria-pressed={filters.openSourceOnly}
            className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-2xs font-medium transition-colors lg:py-2 ${
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
        </div>

        <div className="max-lg:col-span-1">
          <button
            onClick={actions.toggleNonActive}
            aria-pressed={filters.nonActiveOnly}
            className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-2xs font-medium transition-colors lg:py-2 ${
              filters.nonActiveOnly
                ? 'border-transparent bg-brand text-white'
                : 'border-edge bg-transparent text-muted hover:border-faint/40'
            }`}
          >
            仅看非活跃
            <span
              className={`size-3 rounded-full border ${
                filters.nonActiveOnly ? 'border-white bg-white' : 'border-faint'
              }`}
            />
          </button>
        </div>

        {/*
          自动收录筛选用虚线边框 + 琥珀色，与其它实线筛选区分开。
          它筛的不是「某类属性」而是「这条数据可不可信」——所以视觉上
          刻意不同于普通条件，避免读者把它当成一个中立的分类维度。
        */}
        <div className="max-lg:col-span-1">
          <button
            onClick={actions.toggleAutoAdmitted}
            aria-pressed={filters.autoAdmittedOnly}
            title="只显示由每日脚本自动收录、尚未人工核实的条目"
            className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-2xs font-medium transition-colors lg:py-2 ${
              filters.autoAdmittedOnly
                ? 'border-dashed border-amber-500 bg-amber-500 text-white'
                : 'border-dashed border-amber-500/50 bg-transparent text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
            }`}
          >
            仅看待核实
            <span
              className={`size-3 rounded-full border ${
                filters.autoAdmittedOnly ? 'border-white bg-white' : 'border-amber-500/60'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
