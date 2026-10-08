/**
 * 大模型数据结构定义
 *
 * 与 Agent 数据的根本区别：这里几乎没有主观判断字段。
 * Agent 页的 autonomyLevel / tier 需要人工评级，所以有「待核实」机制；
 * 而模型的价格、上下文长度、模态都是接口给的客观值——
 * 真正需要小心的不是「字段是猜的」，而是「字段被错读或单位搞错」。
 *
 * 唯一带人工判断的是 vendor / region（厂商归属与国内外划分），
 * 它由脚本里的映射表决定，映射表滞后于厂商变动时就会出错，
 * 所以 models.meta.disclaimer 里写明了这一点。
 */

export type ModelRegion = 'overseas' | 'china'
export type Modality = 'text' | 'image' | 'audio' | 'video' | 'file' | '3d'

export interface ModelScores {
  /** Artificial Analysis 综合智能指数 */
  intelligence: number | null
  coding: number | null
  /** Agent 能力指数，与本站Agent 页的选型最相关 */
  agentic: number | null
}

export interface LLMModel {
  /** 稳定 id，由 OpenRouter id 转换而来（小写连字符） */
  id: string
  name: string
  vendor: string
  /** 归一化后的厂商 slug（已剥离 ~ 前缀），用于聚合同一厂商 */
  vendorSlug: string
  region: ModelRegion
  /** OpenRouter 原始 id，形如 openai/gpt-5 */
  openRouterId: string

  /** 上下文窗口（token），null = 接口未提供 */
  contextWindow: number | null
  /** 单次输出上限（token） */
  maxOutputTokens: number | null

  /** 每百万 token 输入价（美元）。null = 无固定价（路由器条目） */
  priceInput: number | null
  /** 每百万 token 输出价（美元） */
  priceOutput: number | null
  /** 每百万 token 缓存读取价，null = 不支持或未提供 */
  priceCacheRead: number | null
  /**
   * 是否为模型路由器/自动选型条目（OpenRouter 用负价格编码「无固定价」）。
   * 这类条目不是模型而是转发服务，价格随实际转发目标浮动，不可横向比较。
   */
  isRouter: boolean

  inputModalities: Modality[]
  outputModalities: Modality[]
  /** 是否多模态输入。恒等于 inputModalities.some(m => m !== 'text')，schema 会校验 */
  isMultimodal: boolean

  /** 是否有公开权重。判定依据是上游有 HuggingFace id，比厂商自称可靠 */
  openWeights: boolean
  openWeightsUrl: string | null

  /** 发布日期 YYYY-MM-DD */
  releasedAt: string | null
  /** 训练数据截止时间 YYYY-MM-DD */
  knowledgeCutoff: string | null

  /** 是否支持可调推理强度 */
  /**
   * 是否为批处理变体。
   * OpenRouter 把同一模型拆成标准版与 batch 版两个条目，
   * 二者能力相同但计费通道不同（batch 通常便宜约 50%，但异步提交）。
   * 独立标记而非删除：占实测数据 16%，是真实的成本优化信息。
   */
  isBatch: boolean

  supportsReasoning: boolean
  /** 是否必须开启推理（不能关闭） */
  reasoningMandatory: boolean

  scores: ModelScores | null

  /** OpenRouter 模型页，用于追溯 */
  officialUrl: string
  /** 上游描述原文（英文） */
  description: string

  /*
   * 核实状态——沿用 agents 的「自动收录·待核实」机制。
   * models.json 由脚本每日全量重写，没有人工撰写的环节，
   * 所以除了人工核实过的条目，其余全部标为待核实。
   *
   * `autoAdmittedAt` 记录首次收录日期：模型被下架又重新上架时，
   * 它会重新进入「待核实」状态（verifiedBy 不会被自动继承），
   * 此时这个日期能让读者知道它是不是「刚冒出来的条目」。
   */
  autoAdmitted: true
  autoAdmittedAt: string
  /** 人工核实人；null = 待核实 */
  verifiedBy: string | null
}

export interface ModelsMeta {
  lastUpdated: string
  source: string
  disclaimer: string
  /** 待核实条目数 */
  autoAdmitted: number
  /** 已人工核实条目数 */
  verified: number
}

export interface ModelsPayload {
  meta: ModelsMeta
  models: LLMModel[]
}

/** 排序字段 */
export type ModelSortKey =
  | 'name'
  | 'vendor'
  | 'releasedAt'
  | 'contextWindow'
  | 'priceInput'
  | 'priceOutput'
  | 'intelligence'
  | 'agentic'