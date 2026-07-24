import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { inspectAttr } from "kimi-plugin-inspect-react";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    proxy: {
      "/shinemonitor": {
        target: "http://api.shinemonitor.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/shinemonitor/, "/public/"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
