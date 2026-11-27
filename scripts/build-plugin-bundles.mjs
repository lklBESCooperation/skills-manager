import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  await Promise.all([
    build({
      entryPoints: [resolve(repoRoot, 'src/worker/plugin-worker.ts')],
      outfile: resolve(repoRoot, 'dist/plugin-worker.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: false,
      minify: false,
      legalComments: 'none'
    }),
    build({
      entryPoints: [resolve(repoRoot, 'src/ui/skills-page.ts')],
      outfile: resolve(repoRoot, 'ui/skills-page.js'),
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      minify: false,
      legalComments: 'none'
    }),
    build({
      entryPoints: [resolve(repoRoot, 'src/ui/skills-panel.ts')],
      outfile: resolve(repoRoot, 'ui/skills-panel.js'),
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      minify: false,
      legalComments: 'none'
    })
  ])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
