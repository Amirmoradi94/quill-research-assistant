import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const generatedCss = path.join(root, 'src', 'generated-tailwind.css')
const assetsDir = path.join(root, 'dist', 'assets')

const assets = await fs.readdir(assetsDir)
const cssAssets = assets.filter((name) => /^index-.*\.css$/.test(name))

if (cssAssets.length !== 1) {
  throw new Error(`Expected one dist index CSS asset, found ${cssAssets.length}: ${cssAssets.join(', ')}`)
}

await fs.copyFile(generatedCss, path.join(assetsDir, cssAssets[0]))
console.log(`Patched dist/assets/${cssAssets[0]} with generated Tailwind CSS.`)
