/**
 * 大模型数据源 —— OpenRouter /api/v1/models
 *
 * 为什么选 OpenRouter：
 *   它是唯一一个免鉴权就能同时拿到「上下文长度 + 输入输出单价 + 多模态 +
 *   开源权重 HF id + 第三方跑分」的公开接口。这几项恰好是选型时最需要对比的，
 *   不用为了拿价格去注册四家厂商的 API key。
 *   实测 2026-10-09 返回 467 个模型，其中国内厂商 118 个（Qwen/DeepSeek/Kimi/
 *   GLM/StepFun/MiniMax 等），覆盖率足够支撑中文选型场景。
 *
 * 它的定位要说明白：**OpenRouter 是聚合器不是厂商官方源**。
 * 价格是聚合商的实际售价，可能与厂商官网直销价不同（通常更贵一点）。
 * 所以价格字段统一标注来源，页面上也要写明，不能让人误以为是官方定价。
 *
 * 数据性质决定了一切处理方式：
 *   价格、上下文长度、发布日期 —— 接口直接给的客观值，可自动覆盖刷新；
 *   「哪个更强」「适合什么场景」—— 主观判断，只能机器初判 + 标待核实。
 *
 * 保持零第三方依赖，只用 fetch（见 http.mjs）。
 */

import { fetchJson } from '../http.mjs'

const API = 'https://openrouter.ai/api/v1/models'

/**
 * 国内厂商判定表。
 *
 * 为什么必须显式列厂商而不用「描述里有中文就算国内」：
 *   模型描述一律是英文，中文检测在这里完全失效。而厂商归属直接影响
 *   「国内模型占比」这个核心统计，判错会误导读者判断国产化进度。
 *
 *   反过来也有坑：Llama 是 Meta 的开源模型，Qwen 是阿里的，Mistral 是法国的——
 *   三者在国内市场都很常见，但只有 Qwen 算国产。所以这张表按「厂商归属」
 *   判，不按「使用地区」判。
 *
 * 这个表踩过一次坑：初版漏了 deepseek 和 xiaomi，
 * 于是「国内 127 个」里其实混着 15 个 DeepSeek + 5 个小米 MiMo 被当成海外，
 * 统计口径直接错了。这类枚举表必须对着真实数据核：
 * 先打印所有出现过的 vendorSlug（`node -e` 去重列表），逐个确认归属。
 */
const DOMESTIC_VENDORS = new Set([
  'qwen', 'deepseek', 'moonshotai', 'z-ai', 'zhipu', 'minimax', 'stepfun',
  'baichuan', 'tencent', 'bytedance-seed', 'bytedance', 'baidu', '01-ai',
  'thudm', 'internlm', 'inclusionai', 'skywork', 'opengvlab', 'ibm-granite',
  'xiaomi', 'meituan',
])

/**
 * 剥掉 "Latest" 别名的 ~ 前缀，映射到本体厂商。
 *
 * OpenRouter 有两类 id：具体版本（openai/gpt-5）与滚动别名
 * （~openai/gpt-mini-latest）。别名会随厂商发布自动指向新版本，
 * 它们和本体是不同条目、都要收录（「最新稳定版」本身就是选型常用的锚点），
 * 但厂商归属必须跟本体一致——否则 8 个 ~ 别名会被算成 8 家新厂商，
 * 「共 N 家厂商」这个数字直接虚高。
 */
function baseVendorSlug(slug) {
  return slug.startsWith('~') ? slug.slice(1) : slug
}

/**
 * 厂商显示名映射：OpenRouter 的 owner slug 直接当厂商名会很生硬
 * （z-ai / bytedance-seed / 01-ai 这类），中文用户更难认。
 * 只映射确实有歧义的，没列的直接用 slug（openai/anthropic 这类本身就很干净）。
 */
const VENDOR_NAMES = {
  'z-ai': '智谱 Z.ai',
  zhipu: '智谱 AI',
  '01-ai': '零一万物',
  'bytedance-seed': '字节 Seed',
  bytedance: '字节跳动',
  baichuan: '百川智能',
  thudm: '智源研究院',
  internlm: '书生·浦语',
  skywork: '昆仑万维',
  'moonshotai': '月之暗面 Moonshot',
  'minimax': 'MiniMax',
  'stepfun': '阶跃星辰',
  deepseek: 'DeepSeek 深度求索',
  xiaomi: '小米 MiMo',
  meituan: '美团 LongCat',
  tencent: '腾讯混元',
  qwen: '阿里通义千问',
  'openai': 'OpenAI',
  'meta-llama': 'Meta',
  'mistralai': 'Mistral AI',
  'x-ai': 'xAI',
  'perplexity-ai': 'Perplexity',
  'aion-labs': 'Aion Labs',
  'inclusionai': '蚂蚁 InclusionAI',
  'opengvlab': '启智 OpenGVLab',
  'ibm-granite': 'IBM Granite',
}

/** OpenRouter 的模态串（text+image+file->text）拆成输入/输出集合 */
function parseModality(architecture) {
  const modality = architecture?.modality ?? 'text->text'
  const [inPart, outPart] = modality.split('->')
  const input = (inPart || '').split('+').filter(Boolean)
  const output = (outPart || '').split('+').filter(Boolean)
  return {
    inputModalities: input.length ? input : ['text'],
    outputModalities: output.length ? output : ['text'],
    /** 是否多模态输入（纯文本模型按 0 存，便于排序时区分档位） */
    isMultimodal: input.some((m) => m !== 'text'),
  }
}

/**
 * 价格换算成「每百万 token 美元」。
 *
 * OpenRouter 用「每 token 美元」的小数字（0.00000125），
 * 直接展示会出现一长串小数没法读。统一 ×1e6 转成行业通用口径。
 * 保留 4 位小数：便宜模型之间要靠第 4 位才能分出高下。
 *
 * 负数一律转null，不当0 处理。实测 2026-10-09 有 7 条
 * （openrouter/auto、nvidia/switchyard、typesafe/jev-router 等）
 * 的 pricing 是 -1 —— 这是 OpenRouter 表示「无固定价格」的哨兵值，
 * 因为这些条目不是真模型，而是**模型路由器/自动选择服务**
 * （"picks the best model for each request"），按实际转发到的模型计费。
 * 若照单全收会算出 priceInput = -1000000这种荒谬数字并展示给读者。
 */
function pricePerMillion(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1e6 * 10000) / 10000
}

/**
 * 是否为「路由器 / 自动选型」条目而非真模型。
 *
 * 为什么要单独识别：这类条目混在模型列表里，若不标注，
 * 读者会以为 NVIDIA Switchyard 是个新模型，实际上它是个转发器。
 * 它们的价格随实际选中的模型浮动，没有可比性。
 * 识别方式：直接看价格是否为负数（OpenRouter 唯一给负价的场景），
 * 不用关键词猜——「router」这类词会误伤真正的 router 类模型。
 */
function isRouterEntry(m) {
  const prompt = Number(m.pricing?.prompt)
  const completion = Number(m.pricing?.completion)
  return Number.isFinite(prompt) && prompt < 0 &&
    Number.isFinite(completion) && completion < 0
}

/**
 * 跑分归一化。
 *
 * OpenRouter 的 benchmarks 是个大杂烩：design_arena（各类图形生成 ELO）、
 * artificial_analysis（intelligence/coding/agentic index）。
 * 全量塞进 JSON 会有几百 KB，前端只用得上其中三个数值指数，
 * 所以只抽 artificial_analysis 那三项——它们对 Agent 选型最有参考价值
 * （agentic_index 尤其直接对应「能不能当Agent 的大脑」）。
 */
function extractScores(m) {
  const aa = m.benchmarks?.artificial_analysis
  if (!aa) return null
  return {
    intelligence: aa.intelligence_index ?? null,
    coding: aa.coding_index ?? null,
    agentic: aa.agentic_index ?? null,
  }
}

/** 发布时间：OpenRouter 给 Unix 秒 */
function toDate(unixSec) {
  const n = Number(unixSec)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000).toISOString().slice(0, 10)
}

/** OpenRouter 模型页，作为该条目的可追溯链接 */
function modelPageUrl(id) {
  return `https://openrouter.ai/${id}`
}

/**
 * 生成稳定的模型 id。
 *
 * 直接把 owner/repo 里的斜杠换成连字符（gpt-5 → openai-gpt-5）。
 * 用完整 owner 前缀而不是裸模型名，是因为 `gpt-4` 这类名字
 * 不同厂商可能重复（openai/gpt-4 与 azure 的同名变体），
 * 只用裸名会撞 id。
 */
function modelId(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/**
 * 是否为批处理变体。
 *
 * OpenRouter 把同一模型拆成「标准」和「batch」两个条目，
 * 比如 anthropic/claude-haiku-5.5 与 anthropic/claude-haiku-5.5-batch。
 * 它们不是不同模型，而是同一模型的两套计费通道——
 * batch 通常便宜 50%，但异步提交、不可取消，适合离线批处理。
 *
 * 为什么要标记而不是过滤掉：
 *   它们占实测数据 16%（74/467），删掉会丢掉一块真实的成本优化信息；
 *   但不标记的话，467 个条目里两行「Claude Haiku 5.5」长得几乎一样，
 *   用户会以为是重复数据，怀疑整个站点的可信度。
 *   标记后卡片上显示「批处理」角标，价格差异也一目了然。
 */
function isBatchVariant(name) {
  return /\bbatch\b/i.test(String(name ?? ''))
}

/**
 * 描述清洗：去掉裸URL 和 Markdown 链接语法。
 *
 * 实测有 35 个模型的描述里直接嵌了 URL 或 [文本](链接) 语法
 * （厂商在 OpenRouter 上就是这么写的），卡片按两行截断后
 * 会显示成 "...positions below the flagship GPT-Astra in the GPT-…" 这种断句，
 * 半句话里夹个链接，很难读。
 *
 * 只做最小清洗，不改写语义——描述是厂商原文，删多了会丢信息。
 */
function cleanDescription(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [文本](url) → 文本
    .replace(/https?:\/\/\S+/g, '')              // 裸 URL
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 抓取全量模型列表。
 * @returns {{models: Array, meta: object}}
 */
export async function fetchModels() {
  const data = await fetchJson(API, { timeout: 30_000 })
  const raw = Array.isArray(data?.data) ? data.data : []

  const models = []
  for (const m of raw) {
    if (!m?.id) continue

    const vendorSlug = m.id.split('/')[0] ?? ''
    // ~openai/gpt-mini-latest 这类别名，厂商归属跟本体一致，只去掉 ~ 查表
    const baseSlug = baseVendorSlug(vendorSlug)
    const vendor = VENDOR_NAMES[baseSlug] ?? baseSlug
    const modality = parseModality(m.architecture)

    // 官方链接：hugging_face_id 指向开源权重，是开源模型最实在的一手来源
    const openWeightsUrl = m.hugging_face_id
      ? `https://huggingface.co/${m.hugging_face_id}`
      : null

    models.push({
      id: modelId(m.id),
      // OpenRouter 的 name 形如 "OpenAI: GPT-5"，取冒号后的部分作为展示名
      name: (m.name ?? '').includes(':') ? m.name.split(':').slice(1).join(':').trim() : m.name,
      vendor,
      vendorSlug: baseSlug,
      region: DOMESTIC_VENDORS.has(baseSlug) ? 'china' : 'overseas',
      /** OpenRouter 原始 id，用于回查 */
      openRouterId: m.id,
      contextWindow: Number.isFinite(m.context_length) ? m.context_length : null,
      maxOutputTokens: m.top_provider?.max_completion_tokens ?? null,
      priceInput: pricePerMillion(m.pricing?.prompt),
      priceOutput: pricePerMillion(m.pricing?.completion),
      priceCacheRead: pricePerMillion(m.pricing?.input_cache_read),
      /** 路由器条目：无固定价，价格随实际转发目标浮动 */
      isRouter: isRouterEntry(m),
      inputModalities: modality.inputModalities,
      outputModalities: modality.outputModalities,
      isMultimodal: modality.isMultimodal,
      /** 开源权重：只有有 HF id 的才算，这个信号比厂商自称可靠 */
      openWeights: Boolean(openWeightsUrl),
      openWeightsUrl,
      releasedAt: toDate(m.created),
      knowledgeCutoff: m.knowledge_cutoff ?? null,
      /** 是否支持可调推理强度（有 reasoning 字段=API 支持 reasoning 参数） */
      supportsReasoning: Boolean(m.reasoning),
      reasoningMandatory: Boolean(m.reasoning?.mandatory),
      scores: extractScores(m),
      officialUrl: modelPageUrl(m.id),
      isBatch: isBatchVariant(m.name),
      description: cleanDescription(m.description).slice(0, 600),
    })
  }

  // 按 id 排序保证输出稳定：上游返回顺序会变，直接写盘会导致每天都是「变更」
  models.sort((a, b) => a.id.localeCompare(b.id))

  return {
    models,
    meta: {
      fetchedAt: new Date().toISOString(),
      source: 'OpenRouter /api/v1/models',
      total: models.length,
    },
  }
}