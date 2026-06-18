import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')
const inputPath = path.join(srcDir, 'index.css')
const outputPath = path.join(srcDir, 'generated-tailwind.css')
const tailwindDir = path.join(root, '.tailwind-build-cache', 'tailwindcss')
const tailwindVersion = '4.2.4'

function ensureTailwindCompiler() {
  const compilerPath = path.join(tailwindDir, 'dist', 'lib.mjs')
  const indexPath = path.join(tailwindDir, 'index.css')
  if (fs.existsSync(compilerPath) && fs.existsSync(indexPath)) return compilerPath

  fs.rmSync(tailwindDir, { recursive: true, force: true })
  fs.mkdirSync(tailwindDir, { recursive: true })
  const archive = path.join(root, '.tailwind-build-cache', `tailwindcss-${tailwindVersion}.tgz`)
  execFileSync('curl', [
    '-fsSL',
    `https://registry.npmjs.org/tailwindcss/-/tailwindcss-${tailwindVersion}.tgz`,
    '-o',
    archive,
  ], { stdio: 'inherit' })
  execFileSync('tar', ['-xzf', archive, '-C', tailwindDir, '--strip-components=1'])
  return compilerPath
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
    } else if (/\.(ts|tsx|html)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function extractCandidates(source) {
  const candidates = new Set()
  for (const raw of source.split(/[\s"'`{}<>]+/)) {
    const token = raw.replace(/^[,;()]+|[,;()]+$/g, '')
    if (
      token.length > 1 &&
      !token.startsWith('http') &&
      !token.includes('..') &&
      (
        /[-:[\]/]/.test(token) ||
        /^[a-z][a-z0-9]*$/.test(token)
      )
    ) {
      candidates.add(token)
    }
  }
  return candidates
}

function cleanInput(css) {
  return css
    .replace(/@import\s+"tailwindcss"\s+source\(none\);/, '@import "tailwindcss";')
    .replace(/@source\s+[^;]+;/g, '')
}

async function loadStylesheet(id) {
  if (id === 'tailwindcss') {
    const file = path.join(tailwindDir, 'index.css')
    return { path: file, base: tailwindDir, content: await fsp.readFile(file, 'utf8') }
  }
  if (id.startsWith('tailwindcss/')) {
    const file = path.join(tailwindDir, `${id.slice('tailwindcss/'.length)}.css`)
    return { path: file, base: tailwindDir, content: await fsp.readFile(file, 'utf8') }
  }
  throw new Error(`Unsupported stylesheet import: ${id}`)
}

const input = cleanInput(await fsp.readFile(inputPath, 'utf8'))
console.log('Compiling Tailwind design system...')
const { compile } = await import(pathToFileURL(ensureTailwindCompiler()).href)
const compiler = await compile(input, { base: srcDir, loadStylesheet })
console.log('Scanning source files for utility candidates...')
const files = walk(srcDir)
const candidates = new Set()

for (const file of files) {
  if (file === outputPath) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const candidate of extractCandidates(text)) candidates.add(candidate)
}

console.log(`Building Tailwind CSS from ${candidates.size} candidates...`)
const css = compiler.build([...candidates])
await fsp.writeFile(outputPath, css)
console.log(`Generated ${path.relative(root, outputPath)} with ${candidates.size} candidates.`)
