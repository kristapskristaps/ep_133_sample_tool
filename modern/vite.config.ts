import path from "node:path";
import fs from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".pak": "application/octet-stream",
  ".hmls": "application/octet-stream",
};

export default defineConfig({
  root: path.resolve(__dirname),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "legacy-data-server",
      configureServer(server) {
        server.middlewares.use("/legacy", (req, res, next) => {
          const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
          const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
          const filePath = path.resolve(__dirname, "..", "data", cleanPath.slice(1));
          if (!filePath.startsWith(path.resolve(__dirname, "..", "data"))) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          fs.readFile(filePath, (error, data) => {
            if (error) {
              next();
              return;
            }
            res.setHeader("Content-Type", mimeTypes[path.extname(filePath)] || "application/octet-stream");
            res.end(data);
          });
        });
      },
    },
  ],
});
