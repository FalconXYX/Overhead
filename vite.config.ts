/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/Overhead/",
  plugins: [react()],
  // Required: Vite 8 defaults to "iife" workers, and the build then fails as soon as anything
  // imports satellite.js (top-level await in its WASM loader). See docs/DECISIONS.md, Tooling.
  worker: { format: "es" },
  // [M9] Just above the measured entry chunk (852.2 kB minified, 261.4 kB gzipped on 2026-10-11, with ajv split
  // out by validateGeoPose's import() and the tour lazy): OpenLayers, React and astronomy-engine are all needed for
  // first paint. A warning means the startup chunk grew; see docs/DECISIONS.md (M9, step 7).
  build: { chunkSizeWarningLimit: 860 },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
  },
});
