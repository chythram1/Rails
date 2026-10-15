import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = `http://127.0.0.1:${process.env.RAILS_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.RAILS_HOST ?? "127.0.0.1",
    proxy: {
      "/api": target,
      "/ws": { target, ws: true },
    },
  },
});
