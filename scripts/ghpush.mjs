#!/usr/bin/env node
/*
 * 安全推送助手（github.com:443 直连被封时的替代方案）
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx npm run push
 *   或  GITHUB_TOKEN=ghp_xxx node scripts/ghpush.mjs
 *
 * 行为：
 *   - 以远端 main 的最新 tree 为基底，只把「最近一次本地提交改动的文件中、
 *     且在远端有差异的」叠加进去；其余文件全部继承远端。
 *   - 因此【不会回退】远端独有的变更（如每日自动更新改过的 models.json / agents.json）。
 *   - 只创建轻量提交，不 force push、不删文件。
 *
 * 为什么不用普通 git push：
 *   - 本沙箱到 github.com:443 不可达，只能走 api.github.com。
 *   - 旧版（全量铺 tree）会把远端自动更新覆盖掉，故改为「只 push 本次提交改动」。
 *
 * 变量：GITHUB_TOKEN（必填）、GH_REPO（默认 EastWolf666/agent-atlas）、GH_REF（默认 main）、
 *       GH_MSG（提交信息，默认用最近一次本地提交的信息）。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKEN = process.env.GITHUB_TOKEN
const REPO = process.env.GH_REPO || 'EastWolf666/agent-atlas'
const REF = process.env.GH_REF || 'main'
const ROOT = resolve(process.cwd())
const API = `https://api.github.com/repos/${REPO}`

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN（用法：GITHUB_TOKEN=xxx npm run push）')
  process.exit(1)
}

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

async function api(method, path, body, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'agent-atlas-push',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = { raw: text }
      }
      if (!res.ok) {
        console.error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
        if (i === retry - 1) process.exit(1)
        continue
      }
      return json
    } catch (e) {
      console.error(`网络异常(${method} ${path})，重试 ${i + 1}/${retry}: ${e.cause?.code || e.message}`)
      if (i === retry - 1) process.exit(1)
    }
  }
}

const run = async () => {
  const ref = await api('GET', `/git/ref/heads/${REF}`)
  const baseCommit = ref.object.sha
  const baseCommitObj = await api('GET', `/git/commits/${baseCommit}`)
  const baseTree = baseCommitObj.tree.sha
  console.log(`远端 ${REF} = ${baseCommit.slice(0, 7)}  (${String(baseCommitObj.message || '').split('\n')[0] || ''})`)

  // 只取最近一次本地提交改动的文件
  const files = sh('git show --name-only --format= HEAD')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (files.length === 0) {
    console.log('最近一次提交没有改动文件，无需推送')
    return
  }
  console.log(`本次提交改动文件 ${files.length} 个:`, files.join(', '))

  const entries = []
  for (const f of files) {
    const content = readFileSync(resolve(ROOT, f))
    const created = await api('POST', '/git/blobs', {
      content: content.toString('base64'),
      encoding: 'base64',
    })
    const mode = sh(`git ls-files -s -- ${JSON.stringify(f)}`).split(/\s+/)[0]
    entries.push({ path: f, mode: mode === '120000' ? '120000' : '100644', type: 'blob', sha: created.sha })
    console.log(`  ✓ 上传 ${f} -> ${created.sha.slice(0, 7)}`)
  }

  const newTree = await api('POST', '/git/trees', { base_tree: baseTree, tree: entries })
  console.log(`新 tree = ${newTree.sha.slice(0, 7)}`)

  if (newTree.sha === baseTree) {
    console.log('远端内容已与本次改动一致，无需提交')
    return
  }

  const msg = process.env.GH_MSG || sh('git log -1 --format=%s')
  const newCommit = await api('POST', '/git/commits', {
    message: msg,
    tree: newTree.sha,
    parents: [baseCommit],
  })
  console.log(`新 commit = ${newCommit.sha.slice(0, 7)}`)

  const upd = await api('PATCH', `/git/refs/heads/${REF}`, { sha: newCommit.sha, force: false })
  console.log(`✅ ${REF} 已更新到 ${upd.object.sha.slice(0, 7)}（仅叠加本次提交改动，远端其余变更保留）`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
