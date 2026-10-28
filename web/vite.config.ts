import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Built into dist/, which the server serves at /. `npm run dev` serves the page with hot reload on 5199 and sends
// /api to a running server on 4280, so its buttons act for real.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined) } },
    chunkSizeWarningLimit: 800,
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true, proxy: { "/api": "http://127.0.0.1:4280" } },
})
