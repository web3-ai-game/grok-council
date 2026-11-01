import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const hmrDomain = process.env.VITE_HMR_DOMAIN;

export default defineConfig(({ mode }) => ({
  base: mode === "demo" ? "/grok-council/" : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      allow: [root, path.resolve(root, "..")],
    },
    hmr: hmrDomain
      ? { host: hmrDomain, protocol: "wss" as const, clientPort: 443 }
      : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8800",
        changeOrigin: true,
      },
    },
  },
}));
