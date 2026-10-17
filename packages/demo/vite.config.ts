import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

/**
 * サーバをブラウザ内で動かすデモ版のビルド。
 * サーバのコードが使う Node/Bun の API をブラウザ向けの代替実装に差し替える。
 */
export default defineConfig({
  // GitHub Pages のサブパス(/<リポジトリ名>/)でもそのまま動くよう相対パスで出力する
  base: "./",
  publicDir: "../client/public",
  plugins: [react()],
  resolve: {
    alias: {
      "node:fs": shim("fs"),
      "node:path": shim("path"),
      "node:crypto": shim("crypto"),
      "@hono/bun": shim("hono-bun"),
      "iconv-lite": shim("iconv"),
    },
  },
  define: {
    "process.env.LOG_LEVEL": JSON.stringify("warn"),
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4000,
  },
});
