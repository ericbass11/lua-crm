import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // JSX automático já é o default do transform esbuild no Vite 7+ (vitest 4);
  // a opção `esbuild.jsx` saiu do tipo — provado pelos testes de componente.
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    globals: true,
    coverage: { provider: "v8", reporter: ["text", "html"] },
    exclude: ["**/node_modules/**", ".next", "dist", ".claude/**", "tests/e2e/**", "tests/invariants/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
