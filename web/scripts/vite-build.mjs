#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const viteBin = process.platform === 'win32'
  ? 'node_modules/.bin/vite.cmd'
  : 'node_modules/.bin/vite'

const result = spawnSync(viteBin, ['build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DISABLE_TAILWIND_VITE: '1',
  },
})

process.exit(result.status ?? 1)
