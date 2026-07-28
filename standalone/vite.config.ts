import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: here,
  // 파일을 어디에 두고 열든 동작해야 하므로 절대 경로를 쓰지 않는다.
  base: "./",
  plugins: [react()],
  // 저장소 루트의 postcss.config.mjs(Tailwind)를 그대로 쓴다.
  css: { postcss: repoRoot },
  build: {
    outDir: fileURLToPath(new URL("../dist-standalone", import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    // 이미지·폰트 등 남는 자산이 있으면 모두 data URI 로 묻는다.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        // file:// 에서는 <script type="module"> 이 CORS 로 차단된다.
        // 반드시 단일 IIFE 번들이어야 더블클릭 실행이 된다.
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});
