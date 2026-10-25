import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{packages,apps}/*/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "apps/demoboard/**", "apps/web/.next/**"],
    environment: "node",
    passWithNoTests: true,
    // No network from tests: compositions use the fonts Chrome has instead of fetching the brand's.
    env: { AGENTCAST_FONTS: "off" },
  },
});
