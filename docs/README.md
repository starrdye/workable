# Workable — Developer Guide

<p align="center">
  <em>Personal Workflow Mapper · Next.js 16 · React 19 · TypeScript 5 · Multi-provider AI</em>
</p>

> **Current branch:** `main`

> This guide covers the current production architecture. The original prototype (`prototype.html`) is kept for historical reference only — all active development happens in `src/`.

---

## 📚 Documentation Index

1. [Architecture Overview & Project Structure](./architecture.md)
2. [Core Systems (State, AI, Layout, Sidebar)](./core-systems.md)
3. [Distributed Agent System (vb0.1)](./distributed-agents.md)
4. [Development Patterns & Debugging](./development-patterns.md)
5. [Feature Status & Roadmap](./roadmap.md)
6. [Original Proposal](./PROPOSAL.md)
7. [Branch Review](./REVIEW.md)

---

## Getting Started

```bash
git clone https://github.com/starrdye/workable.git
cd workable
npm install
npm run dev        # → http://localhost:3000
```

No `.env` file required. AI API keys are entered at runtime in the UI and stored in browser `localStorage` only.

**Useful scripts:**

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |

---

## Branch & Version History

| Branch | Key changes |
|---|---|
| `0.1` | Foundation: Next.js scaffold, SVG canvas, node/edge CRUD, CSV export, polling |
| `0.2` | AI integration: Claude parse-workflow, AI analyze, Gemini support |
| `0.21` | Smart layout, ecosystem web-map, entity constraints field |
| `0.33-personal` | Doubao provider, workflow groups, group-aware physics layout, node tasks, all layout bug fixes |
| `0.34-personal` | 8k token budget, `extractJSON` + `jsonrepair`, AI Debug Log, hydration fix, char counter |
| `0.35-personal` | Configurable `baseUrl` per provider (Coding Plan support) |
| `0.36-personal` | Edge name/summary in sidebar, Data Flow Direction row, `edgeSourceLabel`/`edgeTargetLabel` |
| `0.37-personal` | Derived connections + workflow group memberships in metadata, template metadata overhaul, Workable brand icon + README |
| `0.38-personal` | Endpoint ID caching (Doubao no longer wiped on load), post-import `resetLayout` pass so first-generation layout matches Reset Layout, orphaned subgroup fix in `groupAwareLayout`, explicit `connections`/`processes` in `metadataOverrides` type |
| `0.39-personal` | AI Update feature: plain-English prompt applies any change to the live graph (add/update/remove nodes, edges, groups). Semantic snapshot context builder strips coordinates. Server-side patch validation guards protected nodes, validates IDs, auto-cascades edge removal. Two-panel modal: prompt input → colour-coded diff preview → sequential apply with `resetLayout` reflow. |
| `0.40-personal` | **Workflow Group Hierarchy**: Recursive node counting in sidebar, parent-subgroup relationship editor in left panel, cycle protection for nesting. **UI Polishing**: Click-based sidebar dropdowns for stability, centered group labels at all zoom levels, minimalist text-only group labeling. **Logic Fixes**: Removed node duplication in auto-nesting via "Move" behavior. |
| `vb0.1` | Distributed agent architecture (5 phases, all additive/feature-flagged). Phase 1: SQLite persistence layer (schema + adapter). Phase 2: NodeAgent + AgentOrchestrator — ego-centric per-node prompts (~700–1,200 input tokens each vs. monolithic ~3,500–8,000 tokens for the whole graph). Phase 3: EventEmitter MessageBroker + BFS CascadeSimulator. Phase 4: GroupAgent with boundary context and inter-group negotiation. Phase 5: R-tree spatial index, LOD system, viewport-filtered state endpoint. |
