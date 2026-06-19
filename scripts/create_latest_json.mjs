#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [
  artifactRootArg = 'release-artifacts',
  outputArg = 'latest.json',
  repo = process.env.GITHUB_REPOSITORY,
  tag = process.env.GITHUB_REF_NAME,
] = process.argv.slice(2)

if (!repo || !tag) {
  console.error('Usage: node scripts/create_latest_json.mjs [artifact-root] [output] [repo] [tag]')
  process.exit(1)
}

const artifactRoot = resolve(process.cwd(), artifactRootArg)
const output = resolve(process.cwd(), outputArg)
const version = tag.replace(/^v/, '')
const requiredTargets = ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']
const platforms = {}

for (const file of walk(artifactRoot)) {
  if (file.endsWith('.sig')) continue
  const name = file.split(/[\\/]/).pop() || ''
  const match = name.match(/^Quill-AI_[^_]+_(darwin-aarch64|darwin-x86_64|linux-x86_64|windows-x86_64)(\.app\.tar\.gz|\.AppImage|\.msi|\.exe)$/)
  if (!match) continue

  const target = match[1]
  const signaturePath = `${file}.sig`
  if (!existsSync(signaturePath)) {
    console.error(`Missing signature for ${file}`)
    process.exit(1)
  }

  platforms[target] = {
    signature: readFileSync(signaturePath, 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
  }
}

const missing = requiredTargets.filter((target) => !platforms[target])
if (missing.length > 0) {
  console.error(`Missing updater artifacts for: ${missing.join(', ')}`)
  process.exit(1)
}

const latest = {
  version,
  notes: `Quill AI ${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(latest, null, 2)}\n`)
console.log(`Wrote ${output}`)

function walk(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}
