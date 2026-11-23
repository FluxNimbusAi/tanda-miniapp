# Demo provenance — lifecycle e2e leg frames

| Fact | Value |
|---|---|
| What ran | `node e2e/lifecycle_leg.mts --mock` — the repo's own e2e leg, importing the shipped `src/lib/userOpStatus.ts` (the exact module the client hook wraps, Node 26 native type-stripping) |
| Result | 9/9 `ok` asserts, `lifecycle_leg: PASS`, `EXIT=0` |
| Capture host | PC node (Windows), Node `v26.12.1`, executed 2026-11-20 13:12 EST |
| Raw capture | [`transcripts/miniapp_lifecycle_leg_2026-11-20.log`](transcripts/miniapp_lifecycle_leg_2026-11-20.log) — sha256 `139e773d5767c4e814db5888daf356a00438cb42b1076f8aaf739914db0c3d42` |
| CI parity | The same leg runs in CI on every push: `ci.yml` step **“P-A lifecycle e2e (golden path vs mock relayer + indexer)”**; green `ci.yml` run on `main` head `de161fa`: run 44657429881 |

## What “mock” means here (and what it does not)

Mock mode stubs the two **external lanes** — the World relayer status endpoint and the `:8096`
indexer — behind loopback servers mounted on the **same proxy paths the app uses**. The state
machine under test is the real shipped module: stage sequence `pending → mined → indexed`,
relayer-failure → retry recovery, and the honest `indexedNa` guard (no fake indexed tick) are all
asserted through production code paths. If the machine drifts, this leg, the hook, and the golden
unit test fail together — one golden path by construction.

## Frame integrity

`lifecycle-leg_01..02.png` and `lifecycle-leg.gif` are viewport slices of the raw transcript above,
rendered by [`render_frames.py`](render_frames.py) (committed):

```
python render_frames.py transcripts/miniapp_lifecycle_leg_2026-11-20.log docs/demo lifecycle-leg --lines 12 --step 6
```

No line is added, removed, or edited. Anyone can regenerate and diff.
