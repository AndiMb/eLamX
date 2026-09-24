import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The version and the commit a build was made from, for the report's header:
// a PDF that names the build it came from can be traced back to the code.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// What the page may load and run - the same policy the desktop shell sends as a
// header (desktop/main.js), less frame-ancestors, which a meta tag cannot set.
// Only in the build: the dev server injects inline scripts of its own.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy: Plugin = {
  name: 'elamx-content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
      injectTo: 'head-prepend',
    },
  ],
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy],
  // MathJax's font ranges are loaded by path (see lib/report/pdf/math.ts) and
  // register themselves with the font module they import. Pre-bundled, the
  // font module the app imports would be a second copy the ranges never see,
  // and every glyph of a range would silently be missing in the dev server.
  optimizeDeps: { exclude: ['@mathjax/mathjax-newcm-font'] },
  define: {
    'import.meta.env.VITE_ELAMX_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_ELAMX_BUILD': JSON.stringify(commit()),
  },
})
