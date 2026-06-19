#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const [target, bundleRootArg = 'web/src-tauri/target/release/bundle'] = process.argv.slice(2)

if (!target) {
  console.error('Usage: node scripts/prepare_updater_artifacts.mjs <target> [bundle-root]')
  process.exit(1)
}

const root = resolve(process.cwd())
const bundleRoot = resolve(root, bundleRootArg)
const config = JSON.parse(readFileSync(resolve(root, 'web/src-tauri/tauri.conf.json'), 'utf8'))
const version = config.version
const outDir = join(bundleRoot, 'updater')
const productSlug = String(config.productName || 'Quill AI').replace(/\s+/g, '-')

mkdirSync(outDir, { recursive: true })

const source = findSource()
const destination = join(outDir, `${productSlug}_${version}_${target}${source.extension}`)

if (existsSync(destination)) rmSync(destination)

if (source.kind === 'macos-app') {
  const appName = basename(source.path)
  const tar = spawnSync('tar', ['-czf', destination, '-C', source.parent, appName], { stdio: 'inherit' })
  if (tar.status !== 0) process.exit(tar.status ?? 1)
} else {
  copyFileSync(source.path, destination)
}

signFile(destination)
console.log(`Prepared updater artifact: ${destination}`)

function findSource() {
  if (target.startsWith('darwin-')) {
    const macosDir = join(bundleRoot, 'macos')
    const app = findFirst(macosDir, (file) => file.endsWith('.app'), { directories: true })
    if (!app) fail(`Could not find a macOS .app bundle under ${macosDir}`)
    return { kind: 'macos-app', path: app, parent: macosDir, extension: '.app.tar.gz' }
  }

  if (target.startsWith('linux-')) {
    const appImage = findFirst(join(bundleRoot, 'appimage'), (file) => file.endsWith('.AppImage'))
    if (!appImage) fail(`Could not find an AppImage under ${join(bundleRoot, 'appimage')}`)
    return { kind: 'copy', path: appImage, extension: '.AppImage' }
  }

  if (target.startsWith('windows-')) {
    const msi = findFirst(join(bundleRoot, 'msi'), (file) => file.endsWith('.msi'))
    if (msi) return { kind: 'copy', path: msi, extension: '.msi' }
    const nsis = findFirst(join(bundleRoot, 'nsis'), (file) => file.endsWith('.exe'))
    if (nsis) return { kind: 'copy', path: nsis, extension: '.exe' }
    fail(`Could not find a Windows MSI or NSIS installer under ${bundleRoot}`)
  }

  fail(`Unsupported updater target: ${target}`)
}

function signFile(file) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    fail('TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required to sign updater artifacts')
  }

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''
  const result = spawnSync(
    npx,
    ['--yes', '@tauri-apps/cli@2', 'signer', 'sign', '-p', password, file],
    { stdio: 'inherit', env: process.env },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function findFirst(dir, predicate, options = {}) {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (options.directories && predicate(path)) return path
      const nested = findFirst(path, predicate, options)
      if (nested) return nested
    } else if (predicate(path)) {
      return path
    }
  }
  return null
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
