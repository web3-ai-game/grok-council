import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hmrDomain = process.env.VITE_HMR_DOMAIN;

export default defineConfig({
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
    hmr: hmrDomain
      ? { host: hmrDomain, protocol: "wss", clientPort: 443 }
      : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8800",
        changeOrigin: true,
      },
    },
  },
});
