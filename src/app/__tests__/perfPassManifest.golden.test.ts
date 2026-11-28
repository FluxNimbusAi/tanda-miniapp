// PERF-PASS golden (brief dayshift_PERF-PASS_20261128_1115): the manifest hop
// must be warm. Two halves of the finding, both pinned:
//   1) the metadata exposes /manifest.webmanifest,
//   2) the render path emits a preload link for the same URL, so the browser
//      opens the connection at navigation instead of post-parse discovery.
// Golden extends, never replaces (qualityWave1 goldens remain green).
// Layout is read as source text, not runtime import: layout.tsx pulls in
// next-auth → next/server, which the vitest ESM resolver cannot load.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const LAYOUT_SRC = readFileSync(
  fileURLToPath(new URL("../layout.tsx", import.meta.url)),
  "utf8",
);

const MANIFEST_URL = "/manifest.webmanifest";

describe("perf-pass - manifest is not a cold-discovery hop", () => {
  it("metadata declares the PWA manifest URL", () => {
    // Single-source law: metadata must reference the constant, and the literal
    // exists exactly once (the constant definition). Both halves pinned.
    expect(LAYOUT_SRC).toContain("manifest: MANIFEST_URL");
    // Single-source law is about CODE lines: the literal must exist exactly once
    // (the constant definition); comment prose mentioning the URL is not a source.
    const codeLines = LAYOUT_SRC.split("\n").filter((l) => !l.trimStart().startsWith("//"));
    expect((codeLines.join("\n").match(/\/manifest\.webmanifest/g) ?? []).length).toBe(1);
  });

  it("render path emits a preload link for the manifest URL", () => {
    const src = LAYOUT_SRC;
    expect(src).toContain('rel="preload"');
    expect(src).toContain(MANIFEST_URL);
    // as="fetch" + crossOrigin is what makes the manifest fetch warm, not
    // merely hinted — a preload without the right `as` double-fetches.
    expect(src).toContain('as="fetch"');
    expect(src).toContain('crossOrigin="anonymous"');
  });
});
