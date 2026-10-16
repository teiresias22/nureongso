import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // next/link 는 보이는 링크마다 prefetch 해서 크롤러 한 쪽에 함수가 여럿 돈다(src/lib/link.tsx).
  {
    ignores: ["src/lib/link.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "next/link", message: "@/lib/link 를 쓴다 — prefetch 가 기본으로 꺼져 있다." }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
