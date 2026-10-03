/**
 * 增量水位线
 *
 * 每个源记录上次成功拉到的时间戳，下次只处理这个时间点之后的内容。
 * 存 data/.watermark.json（提交进仓库，这样 Actions 每次都能读到上一次的位置）。
 *
 * 为什么初值回填 7 天：首次运行时水位线是空的，
 * 全量抓 Show HN 会捞回几千条噪声，反而淹没有效候选。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_DAYS_BACK = 7

export function loadWatermarks(path) {
  if (!existsSync(path)) return { initialisedAt: null, sources: {} }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // 文件损坏时不能直接崩——退回初值重新初始化，比让整个 workflow 挂掉好
    return { initialisedAt: null, sources: {} }
  }
}

export function saveWatermarks(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/**
 * 取某个源的水位线；没有就用「现在往前 N 天」作为初值。
 * @returns {{ since: string, isInitial: boolean }}
 */
export function sinceFor(watermarks, sourceKey, now = new Date()) {
  const saved = watermarks?.sources?.[sourceKey]
  if (saved) return { since: saved, isInitial: false }
  const d = new Date(now.getTime() - DEFAULT_DAYS_BACK * 24 * 3600 * 1000)
  return { since: d.toISOString(), isInitial: true }
}

/**
 * 只把水位线往前推到「本次已确认处理到的时间」，
 * 而且不能倒退——某个源这次失败了，不能把它的水位线清回去。
 */
export function advanceWatermark(watermarks, sourceKey, isoTime, now = new Date()) {
  const prev = watermarks.sources?.[sourceKey]
  if (prev && prev >= isoTime) return false
  watermarks.sources = watermarks.sources ?? {}
  watermarks.sources[sourceKey] = isoTime
  watermarks.initialisedAt = watermarks.initialisedAt ?? now.toISOString()
  return true
}