import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ["echarts", "echarts-for-react"],
          map: ["leaflet", "react-leaflet"],
          motion: ["framer-motion"],
        },
      },
    },
  },
  server: { proxy: { "/api": process.env.VITE_API_TARGET ?? "http://localhost:8080", "/tiles": process.env.VITE_API_TARGET ?? "http://localhost:8080" } },
});
