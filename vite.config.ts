import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from 'vite-plugin-pwa'
import { inspectAttr } from 'kimi-plugin-inspect-react'

// 在安卓 Termux 上构建时，workbox 用 terser 压缩 Service Worker 会开工作线程，线程在 Termux 上会异常退出；
// 这时改为不压缩（文件只有几 KB），并关掉开发模式的调试日志。CIKE_SW_DEV=1 可在别处模拟。
const unminifiedSW = process.platform === 'android' || process.env.CIKE_SW_DEV === '1'

// https://vite.dev/config/
export default defineConfig({
  // 相对路径：静态托管在子路径（如 GitHub Pages 的 /cike/）也能装到手机桌面
  base: "./",
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      mode: unminifiedSW ? 'development' : 'production',
      filename: 'cike-offline.js',
      includeAssets: ['icon-192.png', 'icon-512.png', 'cike-sw-extra.js'],
      manifest: {
        name: '此刻 · 个人行动与复习',
        short_name: '此刻',
        description: '当你有空时，告诉你现在可以做点什么。',
        lang: 'zh-CN',
        theme_color: '#F6F4ED',
        background_color: '#F6F4ED',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // 后台提醒：定时唤醒时读每日摘要并弹通知，点通知回到应用
      workbox: { navigateFallback: 'index.html', importScripts: ['cike-sw-extra.js'], disableDevLogs: true },
    }),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
