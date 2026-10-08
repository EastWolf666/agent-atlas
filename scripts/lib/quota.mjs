/**
 * 入库配额与熔断
 * ================
 * 判据（admit.mjs）已经挡住了一批低质候选，但还不够：
 * 源正常的一天可能捞回几十个高分候选，一次性全塞进正式数据会：
 *   1. 稀释页面质量（读者看到一屏"待核实"）
 *   2. 让图谱和统计口径被机器条目淹没
 *   3. 一旦判据有 bug，批量污染难以回滚
 *
 * 所以加一层硬配额：
 *   - 单日入库上限（默认 5 条）
 *   - **源故障日上限降为 0**——GitHub 挂了/401了还照常入库，
 *     等于在没有健康数据源的情况下写正式数据，这是最危险的场景。
 *
 * 状态落在 data/.admission-state.json，跨天累计用于连续失败告警。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

/** 单日默认入库上限 */
export const DEFAULT_DAILY_LIMIT = 5

/**
 * 计算当天的实际上限。
 *
 * @param {object} opts
 *  @param {string[]} opts.failedSources 本次失败的源名（如 ['github']）
 *  @param {number} opts.limit 配置的上限
 */
export function effectiveLimit({ failedSources = [], limit = DEFAULT_DAILY_LIMIT } = {}) {
  // GitHub 是发现新品的主力源（官方来源 + 热度信号都靠它）。
  // 它挂了的时候入库判据的输入不完整，容易放行不合格条目 —— 直接停手。
  if (failedSources.includes('github')) {
    return { limit: 0, reason: 'GitHub 源故障，今日暂停自动入库（避免在不完整数据上写入）' }
  }
  return { limit, reason: null }
}

/**
 * 读入历史状态。
 * 记录连续「有健康源但入库 0 条」的天数 —— 连续多天0 条通常意味着
 * 判据过严或数据源变化了，值得提醒人工看一眼，而不是静静躺着。
 */
export function loadState(path) {
  if (!existsSync(path)) return { days: {}, zeroStreak: 0 }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { days: {}, zeroStreak: 0 }
  }
}

/** 写入当天状态，返回是否需要告警 */
export function saveState(path, today, { admitted, sourcesHealthy }) {
  const state = loadState(path)
  const days = { ...state.days }
  days[today] = { admitted, sourcesHealthy }

  // 只保留最近 30 天，避免文件无限增长
  const keys = Object.keys(days).sort()
  while (keys.length > 30) delete days[keys.shift()]

  // 连续 0 条的天数（只在源健康时计入，源挂了不算数）
  let streak = 0
  for (const k of keys.slice().reverse()) {
    const d = days[k]
    if (!d) break
    if (d.sourcesHealthy && d.admitted === 0) streak++
    else break
  }

  const next = { days, zeroStreak: streak }
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return { zeroStreak: streak, shouldWarn: streak >= 3 }
}