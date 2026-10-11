/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/overhead/",
  plugins: [react()],
  // Required: Vite 8 defaults to "iife" workers, and the build then fails as soon as anything
  // imports satellite.js (top-level await in its WASM loader). See docs/DECISIONS.md, Tooling.
  worker: { format: "es" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
  },
});
