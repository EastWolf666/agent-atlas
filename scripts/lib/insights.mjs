/**
 * 洞察文案与统计数字重算
 *
 * meta.json 里有几处硬编码数字（"全部 64 条""49 条官方来源"），
 * 数据一扩容就失真。这里把它们改成从数据实时统计。
 *
 * 关键取舍：「全部 N 条均附来源链接」不能改成断言式表达——
 * 脚本自动加进来的候选可能缺 official 来源，硬写"全部"就是撒谎。
 * 所以改为「官方来源覆盖 X/Y 条」，由计数生成，是陈述事实而非承诺。
 */

/** 重算需要写入 meta 的数字字段 */
export function refreshMetaNumbers(metaJson, agents) {
  const officialCount = agents.filter((a) =>
    (a.sources ?? []).some((s) => s.type === 'official')
  ).length
  const confidence = countBy(agents, (a) => a.dataConfidence)
  const nonActive = agents.filter((a) => a.status !== 'active').length
  const today = new Date().toISOString().slice(0, 10)

  metaJson.meta.total = agents.length
  metaJson.meta.lastUpdated = today

  return { officialCount, confidence, nonActive, today, total: agents.length }
}

/** 改写含硬编码数字的洞察文案 */
export function refreshInsights(metaJson, agents, stats) {
  const insights = metaJson.meta.insights
  if (!Array.isArray(insights)) return []

  const changed = []
  const total = agents.length
  const official = stats.officialCount
  const c = stats.confidence

  insights.forEach((ins, i) => {
    const before = ins.text
    const basisBefore = ins.basis

    // 洞察 5：来源覆盖度。用计数而非断言，缺来源时也不会变成空话。
    if (/全部\s*\d+\s*条均附来源链接/.test(before)) {
      ins.text =
        `官方来源覆盖 ${official}/${total} 条，${total} 条均附可追溯的来源链接。` +
        `价格与状态变动极快，采购前仍需回到官方页面确认。`
      ins.basis = `按 sources[].type 统计：${official} 条含 type=official 的一手来源`
      ins.auto = true
    }

    // 洞察 1：L5 占比。只换数字，原文的判断部分一字不改。
    else if (/仅\s*\d+%\s*的产品达到 L5/.test(before)) {
      const l5 = agents.filter((a) => a.autonomyLevel === 5).length
      const pct = total ? Math.round((l5 / total) * 100) : 0
      ins.text = before
        .replace(/仅\s*\d+%\s*的产品达到 L5/, `仅 ${pct}% 的产品达到 L5`)
        .replace(/。$/, '')
      ins.text += `。`
      ins.basis = `L5 共 ${l5} 条 / 总计 ${total} 条`
      ins.auto = true
    }

    // 洞察 4：非活跃状态数。
    // 只替换开头的数字，保留后半句的具体案例（Robin AI 被 acqui-hire
    // 这类细节是文案的信息量所在，自动生成名字替代它反而更弱）。
    else if (/(\d+)\s*条产品已停止、并购或仅在维护/.test(before)) {
      ins.text = before.replace(
        /^\d+\s*条产品已停止、并购或仅在维护/,
        `${stats.nonActive} 条产品已停止、并购或仅在维护`
      )
      ins.basis = `status 为 discontinued / acquired / maintenance / preview 的条目`
      ins.auto = true
    }

    // 洞察 2：平台类 L2 分布。只替换两个数字，结论部分保留原文
    else if (/\d+\s*个企业平台中 \d+\s*个评为 L2/.test(before)) {
      const platforms = agents.filter((a) => a.tier === 'platform')
      const l2 = platforms.filter((a) => a.autonomyLevel === 2).length
      ins.text = before.replace(
        /\d+\s*个企业平台中 \d+\s*个评为 L2/,
        `${platforms.length} 个企业平台中 ${l2} 个评为 L2`
      )
      ins.basis = `platform 类共 ${platforms.length} 条，其中 L2 ${l2} 条`
      ins.auto = true
    }

    if (ins.text !== before || ins.basis !== basisBefore) {
      changed.push({ index: i, before, after: ins.text })
    }
  })

  return changed
}

/** 统计置信度分布，供summary 使用 */
export function confidenceBreakdown(agents) {
  return countBy(agents, (a) => a.dataConfidence)
}

function countBy(list, keyFn) {
  const out = {}
  for (const item of list) {
    const k = keyFn(item) ?? 'unknown'
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}