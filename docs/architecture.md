# Architecture Overview

```text
Browser
  └─ page.tsx ─────────────────────── Start Screen OR Canvas
       │                                       │
       ├─ StartScreen.tsx ─── POST /api/ai/parse-workflow
       │                               │
       │                        generateText()  (Anthropic / Gemini / Doubao)
       │                        extractJSON()   (brace-depth scanner)
       │                        jsonrepair()    (malformed model output)
       │                        hierarchicalLayout()
       │                        forceDirectedLayout()
       │                        groupAwareLayout()
       │                        importState()   ──▶ in-memory singleton
       │
       ├─ GraphCanvas.tsx ──── GET  /api/graph-state/stream (SSE sync)
       │                       PUT  /api/graph-state  (node drag, CRUD)
       │
       ├─ AnalysisSidebar.tsx ─ reads AnalysisData built in page.tsx
       │                         PUT /api/graph-state (updateMetadata / updateEdgeParams)
       │
       ├─ AIAnalysisModal.tsx ─ POST /api/ai/optimize (Monolithic)
       │                          OR   /api/ai/agent (Distributed)
       │
       ├─ AIEngineToggle.tsx ── context: AIEngineContext (Strategy Pattern)
       │
       └─ AISettingsModal.tsx ── localStorage: nwt_ai_config
                                  (provider, model, API key, baseUrl)
                                  endpoint ID preserved across sessions (no purge)
```

No database — server state is a module-level singleton (`src/lib/serverState.ts`). It resets on server restart. Swap the singleton with a real DB via the `importState` / `getGraphState` interface to add persistence.

---

## Project Structure

```text
src/
├── app/
│   ├── layout.tsx                  # Root layout — metadata, fonts, favicon
│   ├── page.tsx                    # App entry: start screen ↔ canvas routing,
│   │                               #   AnalysisData assembly, AI handlers
│   ├── globals.css
│   └── api/
│       ├── ai/
│       │   ├── parse-workflow/     # POST: plain text → full graph JSON
│       │   │   └── route.ts
│       │   ├── optimize/           # POST: current graph → bottleneck report
│       │   │   └── route.ts
│       │   └── update/             # POST: prompt + snapshot → validated patch
│       │       └── route.ts
│       ├── graph-state/            # GET / PUT: server state CRUD
│       │   └── route.ts
│       └── workflow/               # GET: static workflow data (legacy)
│           └── route.ts
│
├── components/
│   ├── GraphCanvas.tsx             # SVG canvas — nodes, edges, pulses,
│   │                               #   drag, right-click CRUD, group regions
│   ├── AnalysisSidebar.tsx         # Right slide-out panel — node & edge detail
│   ├── StartScreen.tsx             # Landing page — template gallery,
│   │                               #   AI textarea (8k char cap), CSV import
│   ├── AIAnalysisModal.tsx         # Bottleneck report + suggested changes modal
│   ├── AIUpdateModal.tsx           # Two-panel: prompt input → diff preview + apply
│   └── AISettingsModal.tsx         # Provider / model / API key / baseUrl
│
└── lib/
    ├── aiClient.ts                 # Provider-agnostic generateText()
    │                               #   Anthropic · Google Gemini · ByteDance Doubao
    ├── layout.ts                   # hierarchicalLayout + forceDirectedLayout + groupAwareLayout
    ├── serverState.ts              # In-memory singleton + all mutation helpers
    ├── templates.ts                # Pre-built workflow templates with full metadata
    └── constants.ts                # Core node IDs, role colours, PROVIDERS list

public/
└── workable-icon.svg               # Brand icon — used as favicon + StartScreen logo
```
