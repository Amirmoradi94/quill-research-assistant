#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const vitePackageJson = require.resolve('vite/package.json')
const vitePackage = require(vitePackageJson)
const viteBin = resolve(
  dirname(vitePackageJson),
  typeof vitePackage.bin === 'string' ? vitePackage.bin : vitePackage.bin.vite,
)

const result = spawnSync(process.execPath, [viteBin, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DISABLE_TAILWIND_VITE: '1',
  },
})

process.exit(result.status ?? 1)
