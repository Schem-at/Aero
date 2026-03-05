import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  build: {
    minify: false,
    sourcemap: true,
  },
  server: {
    port: 5555,
    proxy: {
      "/api/mojang": {
        target: "https://sessionserver.mojang.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mojang/, ""),
        secure: true,
      },
      "/api/proxy": {
        target: "http://localhost:9090",
        changeOrigin: true,
      },
      "/api/servers": {
        target: "http://localhost:9090",
        changeOrigin: true,
      },
      "/api/auth": {
        target: "http://localhost:9090",
        changeOrigin: true,
      },
    },
  },
});
