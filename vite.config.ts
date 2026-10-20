import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: [
        "**/data/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/docs/**",
        "**/README.md",
        "**/AGENTS.md",
        "**/coverage/**",
        "**/output/**",
        "**/.playwright-mcp/**",
      ],
    },
    port: Number(process.env.VITE_PORT ?? 4310),
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 4311}` },
  },
});
