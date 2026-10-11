import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary, PaneError } from "../../src/app/ErrorBoundary";

describe("ErrorBoundary", () => {
  it("any thrown value becomes an Error", () => {
    const state = ErrorBoundary.getDerivedStateFromError("plain string");
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe("plain string");
  });

  it("fallback markup", () => {
    const html = renderToStaticMarkup(
      createElement(PaneError, { pane: "Sky view", message: "WebGL lost", onRetry: () => {} }),
    );
    expect(html).toContain('<div role="alert">');
    expect(html).toContain("Sky view stopped working: WebGL lost");
    expect(html).toContain('<button type="button">Retry Sky view</button>');
  });
});
