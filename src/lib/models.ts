import modelsData from '../data/models.json'
import type { LLMModel, ModelsPayload } from '../types-model'

/*
 * 为什么模型数据也要做运行时断言：
 * 与 agents 同样的理由——类型断言对 JSON 没有校验力。
 * 但这里要挡的不是枚举越界（模型数据的枚举都在 types-model 里固定），
 * 而是「数量级离谱」：上下文长度变成 0 或负数、价格变成天文数字。
 * 这类错误不会让页面崩，只会让读者看到错误的对比数据——更危险。
 *
 * 完整校验在 scripts/lib/models-schema.mjs（npm run validate:models）。
 * 这里只做关键字段的快速断言，把问题从「线上静默显示错数据」
 * 提前到「dev 立即失败」。
 */
function validateAtRuntime(payload: ModelsPayload): LLMModel[] {
  const list = payload?.models
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('models.json 的 models 字段必须是非空数组')
  }
  const first = list[0]
  if (!first?.id || typeof first.contextWindow !== 'number') {
    throw new Error(
      `models.json 数据非法：第 1 条缺 id 或 contextWindow不是数字。请运行 npm run validate:models`
    )
  }
  if (first.contextWindow <= 0) {
    throw new Error(
      `models.json 数据非法：contextWindow=${first.contextWindow}，应为单位错乱导致。请运行 npm run validate:models`
    )
  }
  return list
}

export const models: LLMModel[] = validateAtRuntime(modelsData as ModelsPayload)
export const modelsMeta: ModelsPayload['meta'] = (modelsData as ModelsPayload).meta

/** 模态中文名 */
export const MODALITY_LABEL: Record<string, string> = {
  text: '文本',
  image: '图像',
  audio: '音频',
  video: '视频',
  file: '文件',
  '3d': '3D',
}

/** 上下文的紧凑展示：2000000 → 2M、262144 → 256K */
export function compactTokens(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/** 价格展示。区分免费 / 无固定价 / 正常价三态 */
export function priceLabel(v: number | null): string {
  if (v === null) return '—'
  if (v === 0) return '免费'
  if (v < 0.01) return `$${v.toFixed(4)}`
  if (v < 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}

/** 模态展示：text+image+file→text 简化为「文/图/文」形式 */
export function modalityLabel(input: string[]): string {
  const map: Record<string, string> = { text: '文', image: '图', audio: '音', video: '视', file: '档' }
  return input.map((m) => map[m] ?? m).join('+') || '—'
}

/** 搜索：模型名、厂商、描述 */
export function searchModels(list: LLMModel[], query: string): LLMModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  const terms = q.split(/\s+/).filter(Boolean)
  return list.filter((m) => {
    const hay = [m.name, m.vendor, m.openRouterId, m.description].join(' ').toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}