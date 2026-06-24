import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api/v1/events": {
        target: `http://127.0.0.1:${process.env.INKOS_API_PORT ?? "3000"}`,
        changeOrigin: true,
      },
      "/api": {
        target: `http://127.0.0.1:${process.env.INKOS_API_PORT ?? "3000"}`,
        changeOrigin: true,
      },
    },
  },
});
