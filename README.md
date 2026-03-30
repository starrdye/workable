<div align="center">
  <img src="./banner.svg" alt="Workable — Personal Workflow Mapper" width="100%"/>

  <br/><br/>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white" alt="Next.js"/>
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React"/>
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/>
    <img src="https://img.shields.io/badge/AI-Multi--provider-8B5CF6" alt="AI"/>
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"/>
  </p>
  <p>
    <a href="#-quick-start">Quick Start</a> ·
    <a href="#-features">Features</a> ·
    <a href="#-ai-providers">AI Providers</a> ·
    <a href="#-templates">Templates</a> ·
    <a href="#-how-it-works">How It Works</a>
  </p>

  <br/>

  <p>
    <a href="https://workable-demo.vercel.app">
      <img src="https://img.shields.io/badge/TRY_IT_NOW-LIVE_DEMO-6366F1?style=for-the-badge&logo=vercel" alt="Live Demo"/>
    </a>
  </p>
</div>

---

## What is Workable?

Most workflow tools make you drag and drop from scratch. Workable flips that.

You write (or paste) a plain-English description of how work actually flows — who does what, which tools are involved, where things get stuck. Workable's AI parses it into an interactive graph, groups related steps into named phases, assigns tasks to each node, and immediately flags the bottlenecks. You get a living map of your workflow that you can refine, export, and share. **Try the [Live Demo](https://workable-demo.vercel.app) to see it in action.**

### 🖼️ App Preview

<div align="center">
  <img src="./public/demo/start_screen.png" alt="Workable Start Screen" width="450px" style="border-radius: 12px; border: 1px solid #E2E8F0; margin-right: 12px;"/>
  <img src="./public/demo/graph_canvas.png" alt="Workable Graph View" width="450px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <br/>
  <i>(Left: Landing page with template & text-to-graph input | Right: Interactive group-aware process map)</i>
</div>

---

## ✨ Features

### 🧠 AI-Powered Graph Generation
Describe your workflow in plain English — names, tools, handoffs, blockers, all of it. The AI infers:
- **Nodes** with roles (`person`, `tool`, `external source`, `output`)
- **Directed edges** with descriptive connection names
- **Workflow groups** (phases like "Data Ingestion" or "Review & Approval")
- **Tasks** per node with priority and status
- **Constraints** (GDPR limits, manual approvals, rate caps)

### 🗺️ Dual-View Canvas
| Baseline Process Map | Ecosystem Hub |
|---|---|
| Left-to-right hierarchical flow | Radial web-map centred on the most-connected node |
| Clear sequence and handoffs | Visualise influence, coupling, and dependency rings |
| Great for process documentation | Great for spotting architectural smells |

Toggle instantly with no data loss.

### 🔬 Analysis Sidebar
Click any node or edge to open a deep-dive panel:
- **Entity name**, role badge, and AI-generated vs user-added origin
- **Summary** — concise description of the node's role in the workflow
- **Assigned Workflows** — which phases/groups this node belongs to
- **Direct Connections** — all neighbouring nodes (both directions)
- **Constraints** — operational, compliance, or technical limits
- **Tasks** — inline task list with status, priority, due date, and notes

For edges:
- **Data Flow Direction** — From → To pill with node names
- **Connection Name** — the actual named handoff (e.g. "Send Exception File for review")
- **Auto-generated summary** — what flows along this edge and why

### 🧩 Workflow Groups & Nested Phases
Colour-coded bounding regions that organise nodes into named phases. Supports:
- **Top-level groups** (e.g. "Daily Price Reconciliation")
- **Sub-groups** nested inside parent phases (e.g. "Automated Processing" inside the reconciliation group)
- **Group-aware physics layout** — groups cluster intelligently without overlap, sharing nodes pull related groups together

### ✅ Task Management
Every node can own a task list with:
- Status: `todo` / `in-progress` / `review` / `blocked` / `done`
- Priority: `low` / `medium` / `high`
- Due date + free-form notes
- Visual progress counters (`3/5 open`)

### 🔍 AI Bottleneck Analysis
Run the optimiser on any graph to get a structured report:
- **Workflow Summary** — two-sentence executive overview
- **Bottlenecks Identified** — specific nodes and edges by name
- **Constraint Analysis** — flags nodes with constraints that could propagate risk
- **Quick Wins** — highest impact-to-effort improvements with suggested new connections

### 🔀 AI Update
Describe any change in plain English and apply it as a precise patch — no rebuild from scratch:
- **Add** new people, tools, systems, or entire sub-workflows
- **Update** roles, summaries, constraints, and group memberships
- **Remove** departed team members or replaced tools (edges cascade automatically)
- Preview a colour-coded diff (**green** add / **amber** update / **red** remove) before committing
- Layout reflows automatically after every patch

### 🏗️ Distributed Reasoning (vb0.2)
Specifically for large graphs (100+ nodes) where monolithic AI prompts would hit context limits:
- **Ego-centric Analysis** — each node is analyzed as its own agent with local neighborhood context
- **Message Broker** — agents communicate changes along real graph edges to simulate cascades
- **Engine Toggle** — switch between Monolithic (fast/holistic) and Distributed (precise/scalable) on the fly
- **Scalability** — reasoning remains sharp regardless of total graph size

### 📤 Export & Import
| Format | What's included |
|---|---|
| **CSV** | All nodes, edges, positions, tasks, groups, settings |
| **PNG** | Full canvas render at current zoom |
| **CSV import** | Restore any previously exported workflow |

### 🎨 Templates Gallery
Four pre-built starters so you're never staring at a blank canvas:
- **Morning Routine** — 7-node personal daily startup flow
- **Project Workflow** — 14-node idea-to-publish pipeline
- **Full Work Week** — 22-node complete weekly system
- **Blank Canvas** — start from scratch

---

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/starrdye/workable.git
cd workable
npm install

# 2. Start the dev server
npm run dev
# → http://localhost:3000
```

That's it. No `.env` file. No database. No signup.

**To enable AI features:**
1. Click **AI Settings** (gear icon) in the header
2. Pick your provider (Anthropic, Gemini, or ByteDance Doubao)
3. Paste your API key — it stays in your browser's `localStorage`, never hits a server
4. Describe your workflow and hit **Generate**

---

## 🤖 AI Providers

Workable is provider-agnostic. Swap between them any time in AI Settings.

| Provider | Models | Notes |
|---|---|---|
| **Anthropic Claude** | `claude-sonnet-4-6` (default), `claude-opus-4-6`, `claude-haiku-4-5` | Best overall reasoning and JSON fidelity |
| **Google Gemini** | `gemini-2.0-flash` (default), `gemini-1.5-pro`, `gemini-1.5-flash` | Fast, generous free tier |
| **ByteDance Doubao** | Your endpoint ID (e.g. `ep-20260318…`) | OpenAI-compatible; supports Coding Plan base URL |

**Strategy Selection** — Choose between **Monolithic** and **Distributed** reasoning engines via the toolbar toggle. Distributed mode is recommended for graphs with >30 nodes to maintain reasoning precision.

**Token Transparency** — Full input/output token counts are displayed in the AI Debug Log for every call, regardless of engine.

All API keys are stored client-side only. The server route forwards them per-request and never persists them.

---

## 📐 How It Works

### Parse Pipeline

```
User prompt (plain text)
        │
        ▼
POST /api/ai/parse-workflow
        │  ┌─────────────────────────────┐
        ├─▶│  generateText()             │  ← provider-agnostic, 8k token budget
        │  │  (Anthropic / Gemini / Ark) │
        │  └─────────────────────────────┘
        │
        ▼
  extractJSON()      ← brace-depth scanner, handles preamble/postamble
  jsonrepair()       ← fixes missing quotes, trailing commas, etc.
        │
        ▼
  hierarchicalLayout()  ← Sugiyama-style left→right positioning
  groupAwareLayout()    ← AABB physics: hub gravity + collision + centroid repulsion
        │
        ▼
  metadataOverrides     ← per-node: name, role, summary, constraints, tasks,
                           connections (derived from edges), workflows (from groups)
        │
        ▼
  importState()         ← writes to in-memory server singleton
  → client syncs via **Server-Sent Events (SSE)** /api/graph-state/stream
  (instant multi-tab synchronization with 3s polling fallback)
```

### Layout Physics

The group-aware layout runs a multi-force physics solver (no velocity, pure position):

1. **Hub gravity** — all groups attract toward the most-connected node
2. **Shared-node tension** — groups sharing a node are pulled together
3. **Centroid repulsion** — sharing groups that collapse get pushed apart (prevents pile-up)
4. **AABB collision** — non-sharing groups are pushed apart via node-level delta accumulation (no rigid-body oscillation)

Followed by two post-processing passes:
- **Strict separation** (60 iterations) — node-level adjustment, facing-half strategy to break symmetry for same-shaped groups
- **Union-bbox eviction** (40 iterations) — non-member nodes trapped inside foreign groups exit via the shortest canvas-valid path

### Data Model

```
GraphState
├── customNodes[]      — id, label, initials, role, position, source
├── customEdges[]      — id, source, target, name, sequence, weight
├── ecosystemPositions — node → {x, y} for hub view
├── workflowGroups[]   — id, name, color, nodeIds, parentGroupId?
└── settings
    ├── metadataOverrides  — per-entity: name, summary, tasks, constraints,
    │                        connections, processes (workflow memberships)
    ├── edgeWeightOverrides
    ├── nodeDelayOverrides
    └── hiddenCoreNodes
```

---

## 📁 Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Root page — start screen + canvas router
│   └── api/
│       ├── ai/
│       │   ├── parse-workflow/     # POST: text → graph JSON
│       │   ├── optimize/           # POST: graph → bottleneck report
│       │   └── update/             # POST: prompt + snapshot → patch
│       ├── graph-state/            # GET/PUT: server state CRUD
│       └── workflow/               # GET: static workflow definitions
├── components/
│   ├── GraphCanvas.tsx             # SVG canvas, nodes, edges, pulses
│   ├── AnalysisSidebar.tsx         # Right panel — node/edge deep-dive
│   ├── StartScreen.tsx             # Landing, template gallery, AI input
│   ├── AIAnalysisModal.tsx         # Bottleneck report + suggested changes
│   ├── AIUpdateModal.tsx           # Prompt input → diff preview → apply
│   └── AISettingsModal.tsx         # Provider / key / base URL settings
└── lib/
    ├── aiClient.ts                 # Provider-agnostic generateText()
    ├── layout.ts                   # hierarchicalLayout + groupAwareLayout
    ├── serverState.ts              # In-memory state singleton + mutations
    ├── templates.ts                # Pre-built workflow templates
    └── constants.ts                # Core node IDs, role colours, etc.
```

---

## 🧩 Templates

Templates ship with full metadata — tasks, summaries, constraints, and workflow groups — so you get a rich, ready-to-explore graph the moment you pick one.

### Morning Routine (7 nodes)
```
[Email / Inbox] ──┐
                  ├──▶ [You] ──▶ [Notes] ──▶ [Stand-up] ──▶ [Deep Work]
[Calendar]     ──┘           └──▶ [Task List] ──────────────────────────▶ ▲
```
Groups: Morning Inputs · Planning Layer · Execution

### Project Workflow (14 nodes)
Idea → Research → Outline → Draft → (Reviewer A + Reviewer B) → Feedback → Publish → Analytics → Archive

Groups: Discovery · Production · Review Loop · Distribution

### Full Work Week (22 nodes)
Five external input streams → capture + planning → you (hub) → deep work blocks + collaboration → deliverables + published content + weekly KPIs

Groups: External Inputs · Capture & Plan · Deep Focus · Collaboration · Outputs & Review

---

## 🛠️ Development

```bash
npm run dev     # Dev server with Turbopack → localhost:3000
npm run build   # Production build
npm run lint    # ESLint check
```

**State note:** The server uses an in-memory singleton (`src/lib/serverState.ts`). It resets on server restart. For persistence across restarts, swap the singleton with a database (SQLite, Postgres, etc.) using the same `importState` / `getGraphState` interface.

**Adding a new AI provider:**
1. Add the provider to `AIProvider` union type in `src/lib/aiClient.ts`
2. Implement the `generateText` branch for the new provider
3. Add the provider config (name, models, colour) to `PROVIDERS` in `AISettingsModal.tsx`

---

## 🗺️ Roadmap

- [x] **GitHub Launch** — Repository is live and ready for clones
- [x] **Real-time synchronization** — Server-Sent Events (SSE) for instant multi-tab sync
- [x] **Distributed Reasoning** — Node-agent architecture for 100+ node scalability
- [/] **Persistent storage** — localStorage auto-save + named snapshots in production
- [ ] **Database backend** — SQLite or Postgres for server-side persistence
- [ ] **Constraint propagation** — risk badges that cascade through the graph
- [ ] **Webhook ingestion** — live workflow updates from GitHub, Jira, Slack
- [ ] **OCR / PDF import** — extract workflow from scanned process docs
- [ ] **Diff view** — visualise what changed between two workflow versions
- [ ] **Shareable links** — read-only public URLs for graphs

---

## 📄 License

MIT © 2026 — do whatever you want, just don't blame us when your workflow still has bottlenecks.

---

<div align="center">
  <sub>Built with Next.js · React 19 · Tailwind CSS · Anthropic Claude · Google Gemini · ByteDance Doubao</sub>
</div>
