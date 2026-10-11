// tests/unit/setup.ts — no unit test reaches the network. Fixtures are read with node:fs.
const blockedFetch: typeof fetch = (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`fetch is blocked in unit tests: ${url}`);
};
globalThis.fetch = blockedFetch;
