// 打包服务端入口。用 JS API 而不是命令行参数，Windows / macOS / Linux 行为一致。
import { build } from 'esbuild'

await build({
  entryPoints: ['api/boot.ts'],
  platform: 'node',
  bundle: true,
  format: 'esm',
  outdir: 'dist',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
  logLevel: 'info',
})
