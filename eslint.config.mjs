import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 로컬 개발 도구 산출물 — .claude/worktrees 는 이 저장소 자체의 nested checkout이라
    // 린트를 걸면 app/page.tsx 등이 통째로 중복 검사된다. dist/ 는 vinext build 산출물
    // (minify 된 번들)이라 여기서 나오는 수천 개의 경고가 실제 소스 문제를 가려 버린다.
    ".claude/**",
    "sample_serpent/**",
    "release/**",
    "dist-standalone/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
