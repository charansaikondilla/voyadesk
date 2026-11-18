import { defineConfig } from "vitest/config";

// PGlite seeds a full demo agency per test; on slower machines that alone takes ~4–5 s.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
