#!/usr/bin/env node
/**
 * 模型数据的人工核实台账 —— CLI
 *
 * 跑法：
 *   node scripts/verify-model.mjs list                       列出已核实条目
 *   node scripts/verify-model.mjs add <modelId> [核实人]      标记某条已核实
 *   node scripts/verify-model.mjs remove <modelId>           撤销核实
 *
 * 为什么需要这个文件：
 *   models.json 有 400KB / 469 条，而且是每日全量重写的。
 *   如果核实标记直接存在里面，人工要去里面改一个字段，
 *   轻则在编辑器里手滑被覆盖，重则改坏 JSON 让整个页面挂掉。
 *   所以核实状态单独放这里（几十字节、git diff 清晰），脚本每次运行时读进来合并。
 *
 * 与 agents 的 data/auto-added.json 是同一个思路：
 *   自动收录的台账独立于正式数据，人工审核痕迹不该被自动流程冲掉。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const LEDGER_PATH = resolve(ROOT, 'data/models-verified.json')
const MODELS_PATH = resolve(ROOT, 'src/data/models.json')

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return { verified: [] }
  const j = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  const list = Array.isArray(j) ? j : (j.verified ?? [])
  return { verified: Array.isArray(list) ? list : [] }
}

function saveLedger(ledger) {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true })
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf8')
}

/** 从 models.json 取真实存在的 id，避免把台账写成无效引用 */
function knownIds() {
  if (!existsSync(MODELS_PATH)) return new Set()
  const j = JSON.parse(readFileSync(MODELS_PATH, 'utf8'))
  return new Set((j.models ?? []).map((m) => m.id))
}

const [, , cmd, ...args] = process.argv

if (cmd === 'list') {
  const { verified } = loadLedger()
  if (verified.length === 0) {
    console.log('尚无人工核实记录')
  } else {
    console.log(`已核实${verified.length} 条：`)
    for (const v of verified) {
      console.log(`  ${v.id}\t${v.verifiedBy}\t${v.verifiedAt}`)
    }
  }
} else if (cmd === 'add') {
  const [id, who = '人工核实'] = args
  if (!id) {
    console.error('用法: node scripts/verify-model.mjs add <modelId> [核实人]')
    process.exit(1)
  }
  const ids = knownIds()
  if (ids.size > 0 && !ids.has(id)) {
    console.error(`❌ models.json 里没有 "${id}"，先确认 id 是否写错`)
    console.error(`   可用 grep 搜索：node -e "console.log(require('./src/data/models.json').models.filter(m=>m.name.includes('关键词')).map(m=>m.id))"`)
    process.exit(1)
  }
  const ledger = loadLedger()
  if (ledger.verified.some((v) => v.id === id)) {
    console.log(`"${id}" 已在核实名单里（核实人：${ledger.verified.find((v) => v.id === id).verifiedBy}）`)
  } else {
    ledger.verified.push({
      id,
      verifiedBy: who,
      verifiedAt: new Date().toISOString().slice(0, 10),
    })
    saveLedger(ledger)
    console.log(`✅ 已标记 "${id}" 为已核实（核实人：${who}）`)
    console.log('   下次运行 fetch:models 时生效')
  }
} else if (cmd === 'remove') {
  const [id] = args
  if (!id) {
    console.error('用法: node scripts/verify-model.mjs remove <modelId>')
    process.exit(1)
  }
  const ledger = loadLedger()
  const before = ledger.verified.length
  ledger.verified = ledger.verified.filter((v) => v.id !== id)
  if (ledger.verified.length === before) {
    console.log(`"${id}" 不在核实名单里，无需操作`)
  } else {
    saveLedger(ledger)
    console.log(`已撤销 "${id}" 的核实标记，下次运行 fetch:models 时生效`)
  }
} else {
  console.log(`模型核实台账

用法:
  node scripts/verify-model.mjs list                    列出已核实条目
  node scripts/verify-model.mjs add <id> [核实人]标记已核实
  node scripts/verify-model.mjs remove <id>             撤销核实

台账文件: data/models-verified.json
核实前请确认厂商官方定价页，只核实客观字段（价格/上下文/模态），不要凭印象标。`)
}
