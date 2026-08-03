import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const port = env.PORT || 3002;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${port}`,
          changeOrigin: true,
        },
        "/ws": {
          target: `ws://localhost:${port}`,
          ws: true,
        },
      },
    },
  };
});

