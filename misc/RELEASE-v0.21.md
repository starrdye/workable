# Workable — Release Notes v0.21

**Date:** March 2026
**Branch:** `v0.21`
**Base:** `main` (post 0.50-personal merge)

---

## Overview

v0.21 delivers four independent improvement clusters: hierarchical group summaries that reduce AI token consumption for large workflows, view-mode-aware bottleneck and suggestion rendering, output node visual differentiation, and the snapshot builder extraction that makes both AI routes testable. All changes are backward-compatible and covered by an expanded test suite (56 tests, +33 new).

---

## What's New

### 1 — Hierarchical Group Summaries (Track 14b-i)

**Problem:** Both AI routes repeated group display names on every member node, consuming redundant tokens and breaking silently on group renames.

**Changes:**
- New shared library `src/lib/snapshotBuilder.ts` extracts snapshot-building logic from both routes
- Per-node group references now use stable **group IDs** (e.g. `"grp_compliance"`) instead of mutable display names
- Group block enriched with three new pre-computed fields:
  - `nodeCount` — member count (saves AI inference tokens)
  - `roleSummary` — role distribution string, e.g. `"2 person, 1 tool"`
  - `constraintCount` — number of members with operational constraints
- `/api/ai/optimize` and `/api/ai/update` both import from the shared lib (~80 lines of duplicated code removed per route)
- PROPOSAL.md updated with full before/after spec, token savings table, and implementation notes under `### 14b-i`

**Token savings estimate:**

| Workflow size | Estimated saving |
|---|---|
| 10 nodes, 2 groups | ~150 tokens |
| 30 nodes, 5 groups | ~600 tokens |
| 80 nodes, 10 groups | ~2 000 tokens |

---

### 2 — View-Mode-Aware Suggestion Rendering

**Problem:** Applied AI connections (added via the AI Analyze modal) were visible as plain grey edges in both view modes. Unapplied suggestion arcs were already gated but applied ones leaked into Current Workflow as an unexplained grey line.

**Changes (`GraphCanvas.tsx` + `useAIHandlers.ts`):**
- Applied AI connections (`handleAddConnection`) now set `isImprovementOnly: true`
- `buildEdges` skips improvement-only edges **entirely** in Current Workflow mode (no faint line, no visual artifact)
- In Optimised Workflow mode, improvement-only edges are added with `isUpgraded: true` → **emerald stroke, opacity 0.90, green glow, flow animation** — identical to the built-in bypass arc
- Unapplied suggestion arcs (dashed SVG paths) were already gated by `showImprovements` and remain unchanged

**Before/After:**

| Edge type | Current Workflow (before) | Current Workflow (after) | Optimised Workflow (before) | Optimised Workflow (after) |
|---|---|---|---|---|
| Applied AI connection | Faint grey line | Completely hidden | Grey resting edge | Emerald + glow |
| Unapplied suggestion arc | Hidden ✓ | Hidden ✓ | Dashed emerald ✓ | Dashed emerald ✓ |

---

### 3 — Bottleneck Node Visual Fix

**Problem:** In Optimised Workflow mode, the bottleneck node (Edward) was turning grey and faded (`isDep = true`) and the amber glow was suppressed (`isBotl` required `!isDep`). The result: no amber colouring and no glow in the mode where the bottleneck indicator matters most. In Current Workflow mode the glow was always on regardless of mode.

**Changes (`GraphCanvas.tsx`):**
- `isDep` no longer applies to the bottleneck node — edges through Edward still fade in Optimised mode (handled independently in `buildEdges`), but the node itself maintains its amber border and font in both modes
- Amber glow (`bottleneck-glow` CSS class + `box-shadow`) now gated by `showImprovements`:
  - **Current Workflow:** white fill, amber `#F59E0B` border + font, no glow — reads as a normal node
  - **Optimised Workflow:** white fill, amber `#F59E0B` border + font, amber pulse glow — bottleneck is visually alarming exactly when it should be

---

### 4 — Output Node Colour Differentiation

**Problem:** Output nodes used orange `#F97316` which sits very close to the bottleneck amber `#F59E0B` on the spectrum, causing visual ambiguity between a bottleneck and an output artifact.

**Changes:**
- `ROLE_COLOR.output` in `constants.ts`: `#F97316` → `#0EA5E9` (sky-500)
- `BASE_STYLE.cy` border and text in `GraphCanvas.tsx`: grey `#CBD5E1`/`#475569` → `#0EA5E9`
- Output-role custom nodes now use sky blue consistently with the hardcoded Dashboard node

Sky blue sits opposite amber on the colour wheel — the two node types are now immediately distinguishable at a glance.

---

### 5 — View Mode Toggle Icons

**Changes (`page.tsx`):**
- `Clock` icon added alongside the "Current Workflow" label
- `Zap` icon added alongside the "Optimised Workflow" label
- Both icons inherit the active/inactive colour states of their parent button

---

### 6 — Regression Tests (+33 new)

New test file `src/__tests__/snapshot.test.ts` covering both snapshot builders:

| Suite | Tests |
|---|---|
| `buildRoleSummary` | empty, single, multi-count, mixed roles, case normalisation |
| `buildGroupIdLookup` | empty groups, single group, multi-group membership, ID-not-name assertion |
| `buildOptimizeSnapshot` — group IDs on nodes | ID output, no name leakage, ungrouped nodes |
| `buildOptimizeSnapshot` — enriched groupSummary | nodeCount, roleSummary, constraintCount, empty group, zero constraints |
| `buildOptimizeSnapshot` — hidden nodes | core node exclusion, edge filtering when both endpoints hidden |
| `buildOptimizeSnapshot` — improvement-only edges | stripped from snapshot |
| `buildOptimizeSnapshot` — custom nodes | groupIds assigned correctly |
| `buildUpdateSnapshot` — Groups line | IDs not names, `–` for ungrouped |
| `buildUpdateSnapshot` — GROUPS section | enriched summary line, empty groups, zero constraints |
| `buildUpdateSnapshot` — tasks | formatting with note, omitted when empty |
| `buildUpdateSnapshot` — constraints | shown when set, omitted when absent |
| `buildUpdateSnapshot` — custom nodes/edges | label, role, edge label |
| JSON roundtrip | `workflowSnapshot` parses cleanly; groups array matches `groupSummary` |

**Total: 56 tests passing (23 pre-existing + 33 new), 0 TypeScript errors.**

---

## Files Changed

| File | Type | Summary |
|---|---|---|
| `src/lib/snapshotBuilder.ts` | **New** | Shared snapshot builders with hierarchical group summaries |
| `src/__tests__/snapshot.test.ts` | **New** | 33 regression tests for both snapshot builders |
| `misc/RELEASE-v0.21.md` | **New** | This file |
| `PROPOSAL.md` | Modified | Added `### 14b-i — Hierarchical Group Summaries` under Track 14b |
| `src/app/api/ai/optimize/route.ts` | Modified | Import `buildOptimizeSnapshot` from lib; removed ~80 lines of inline snapshot code |
| `src/app/api/ai/update/route.ts` | Modified | Import `buildUpdateSnapshot` from lib; removed inline `buildSnapshot` function |
| `src/components/GraphCanvas.tsx` | Modified | `isDep` removed from bottleneck node; improvement-only edge skip in Current mode; output node sky blue; `isUpgraded` on improvement-only edges in Optimised mode |
| `src/hooks/useAIHandlers.ts` | Modified | Applied AI connections use `isImprovementOnly: true` |
| `src/app/page.tsx` | Modified | `Clock` icon on Current Workflow button; `Zap` icon on Optimised Workflow button |
| `src/lib/constants.ts` | Modified | `ROLE_COLOR.output` → `#0EA5E9` |

---

## Breaking Changes

None. All changes are additive or visual-only. Existing persisted graph state (localStorage / server) continues to load without migration.

---

## Known Limitations

- `snapshotBuilder.ts` exports are tested against the default Ridgeview core dataset; custom-only workflows (all core nodes hidden) follow the same code paths but are not separately benchmarked for token savings
- The sky-blue output colour applies to the hardcoded `cy` node and all custom `output`-role nodes; if a user has manually set a node's `textColor` to orange via metadata overrides, that override takes precedence
