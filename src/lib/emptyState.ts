/**
 * BS-4.1 / UX3-#9 EMPTY-STATE single source of copy (spec: courier
 * UX3_SPEC_BS23_20261124.md, sha256-LF caa9d521d31efbc26f80c2605e3958fdb0cdcfe88f37411c021444e0f6534649).
 * The component and its goldens both import from here — copy drift becomes
 * a file diff, never a debate (portalAnchors doctrine, ADR-0010 sibling).
 */
export const EMPTY_STATE_COPY = {
  headline: "Split the tab without the awkward.",
  body: "Make a circle, agree the amount, fund it together. The money only moves when everyone confirms.",
  subnote:
    "Round-trip in two steps: fund your share, then confirm. No one can pull funds until the group executes.",
  ctaPrimary: "Create a bill",
  ctaSecondary: "See how it works",
  previewChip: "Tap to preview",
  explainerSteps: [
    { title: "Create", note: "Name the circle and its amount." },
    { title: "Fund", note: "Everyone pays their share into escrow." },
    { title: "Confirm", note: "Money moves only after all confirm." },
  ],
  exampleCircle: {
    title: "Sushi Night",
    meta: "4 of 4 confirmed — $60.00 each",
  },
} as const;

/** §4b forbidden strings — marketing honesty law (M5) + jargon quarantine (A3). */
export const FORBIDDEN_STRINGS: readonly string[] = [
  "enforceable debt",
  "programmable trade settlement",
  "nullifier",
  "seat rotation mask",
];
