import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = `http://127.0.0.1:${process.env.RAILS_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.RAILS_HOST ?? "127.0.0.1",
    // Keep the browser's Host header (changeOrigin: false): the server refuses API writes and WebSocket
    // upgrades whose Origin doesn't match Host. The string shorthand would rewrite Host to the target.
    proxy: {
      "/api": { target, changeOrigin: false },
      "/ws": { target, ws: true, changeOrigin: false },
    },
  },
});
