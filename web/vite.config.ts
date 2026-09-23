import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_ELAMX_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_ELAMX_BUILD': JSON.stringify(commit()),
  },
})
