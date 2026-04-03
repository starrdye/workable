<p align="right"><strong>🌐 Language / 语言：</strong> <strong>English</strong> | <a href="README_zh.md">简体中文</a></p>

<div align="center">
  <img src="./banner.svg" alt="Workable — Personal Workflow Mapper" width="100%"/>

  <br/><br/>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white" alt="Next.js"/>
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React"/>
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/>
    <img src="https://img.shields.io/badge/AI-Multi--provider-8B5CF6" alt="AI"/>
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0 License"/>
  </p>
  <p align="center">
    <strong>Workable</strong> is a personal workflow engine that uses AI to transform your mental notes into structured, interactive process maps. 
    <br/>Spot bottlenecks, organize tasks, and optimize your daily routines — all in one unified canvas.
  </p>
  <p>
    <a href="#-features">Features</a> ·
    <a href="#-ai-providers">AI Providers</a> ·
    <a href="#-quick-start">Quick Start</a> ·
    <a href="./docs/README.md">Development Guide</a>
  </p>

  <br/>

  <p>
    <a href="https://workable-kappa.vercel.app/">
      <img src="https://img.shields.io/badge/TRY_IT_NOW-LIVE_DEMO-6366F1?style=for-the-badge&logo=vercel" alt="Live Demo"/>
    </a>
  </p>
</div>

---

## What is Workable?

Most workflow tools make you drag and drop from scratch. Workable flips that. 

You write (or paste) a plain-English description of how work actually flows — who does what, which tools are involved, where things get stuck. Workable's AI parses it into an interactive graph, groups related steps into named phases, assigns tasks to each node, and immediately flags the bottlenecks. Try the [Live Demo](https://workable-kappa.vercel.app/) to see it in action.

---

## ✨ Features

### 🧠 AI-Powered Graph Generation
Transform a paragraph of text into a complete, structured process map in seconds.

<div align="center">
  <img src="./public/demo/ai_generation.png" alt="Input Prompt" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>1. Describe your workflow</b>: Input your process in plain English — no technical syntax required.</p>
  
  <br/>

  <img src="./public/demo/graph_canvas.png" alt="Generated Graph" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>2. AI generates the graph</b>: The engine automatically identifies nodes, roles, directed edges, and logical groups.</p>
</div>

---

### 🔍 AI Bottleneck Analysis
Stop guessing where your process is failing. Run the optimizer to see structural risk.

<div align="center">
  <img src="./public/demo/bottleneck_analysis.png" alt="Structural Findings" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Spot structural weaknesses</b>: The AI identifies "single points of failure" and structural risks in your workflow.</p>

  <br/>

  <img src="./public/demo/analysis_result_suggested_actions.png" alt="AI Recommendations" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Get suggested actions</b>: Receive specific, actionable recommendations to optimise throughput and reduce risk.</p>
</div>

---

### 🔀 AI Update & Patching
Modify your workflow by just describing the change. No need to rebuild from scratch.

<div align="center">
  <img src="./public/demo/ai_update.png" alt="Update Patch Preview" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Review the proposed change</b>: See a precise preview of additions, removals, and updates before committing them.</p>

  <br/>

  <img src="./public/demo/ai_update_modified_chart.png" alt="Updated Graph Result" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Apply the update instantly</b>: The workflow reflows automatically to incorporate your changes without a full rebuild.</p>
</div>

---

### 🔬 Interactive Exploration & Tasks
Click any node to reveal its deep-dive profile, constraints, and assigned tasks. Task dots orbit each node — click one for a quick-view popup with status, priority, and description.

<div align="center">
  <img src="./public/demo/sidebar.png" alt="Analysis Sidebar" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Deep-dive analysis</b>: Access entity profiles, constraints, and connection summaries in a persistent panel.</p>

  <br/>

  <img src="./public/demo/tasknode.png" alt="Task Dot Popup" width="800px" style="border-radius: 8px; border: 1px solid #E2E8F0;"/>
  <p><b>Actionable task lists</b>: Manage TODOs directly on the canvas or via node-specific task drawers.</p>
</div>

---

### ✅ Optimised Workflow View
Toggle between the **Current Workflow** and **Optimised Workflow** to see AI-suggested improvements overlaid on your canvas. New connections appear as dashed emerald arcs; deprecated ones fade out.

<div align="center">
  <img src="./public/demo/optimised_workflow.png" alt="Optimised Workflow View" width="800px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Switch views without losing your original — the optimised overlay is non-destructive until you apply it.</i></p>
</div>

---

### 🗺️ Flexible Canvas Views
Toggle between the standard **Process Map** (hierarchical flow) and the **Ecosystem Hub** (radial dependency web).

<div align="center">
  <img src="./public/demo/ecosystem.png" alt="Ecosystem Hub View" width="800px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Quickly spot influence hubs and dependency rings that regular charts hide.</i></p>
</div>

---

### 🔎 Search & Role Filters
Search by node name or filter the canvas by role type (Person, Tool, External, Output) and workflow group. Non-matching nodes dim, so your focus stays sharp.

<div align="center">
  <img src="./public/demo/filter_by_role.png" alt="Filter by Role" width="800px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Combine role and group filters to isolate any slice of your process instantly.</i></p>
</div>

---

### 🖱️ Right-Click Node Editing
Right-click any node to set output delay, assign it to workflow groups, add manual connections, or delete it. The analysis panel stays open beside you.

<div align="center">
  <img src="./public/demo/node_editing.png" alt="Node Context Menu and Group Assignment" width="800px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Every structural edit is reflected immediately — no save button, no page reload.</i></p>
</div>

---

### 💾 Workflow Library
Name and save any canvas state to the built-in Workflow Library. Load it back instantly, or delete old versions you no longer need.

<div align="center">
  <img src="./public/demo/workflow_library.png" alt="Workflow Library" width="600px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Snapshots are stored locally in your browser — no account or cloud sync required.</i></p>
</div>

---

### 📂 Workflow Group Hierarchy
Organize your canvas into levels. Create parent-subgroup relationships to manage complex processes. The sidebar automatically indents subgroups and provides a recursive node count (Parent = Parent Nodes + Subgroup Nodes) for a true high-level overview.

<div align="center">
  <img src="./public/demo/group_hierarchy.png" alt="Group Hierarchy and Sidebar Editor" width="800px" style="border-radius: 12px; border: 1px solid #E2E8F0;"/>
  <p><i>Use the "Move to..." icon in the sidebar to reorganize your phases. Circular dependency protection is built-in.</i></p>
</div>

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
**AI Setup:** Click the gear icon in the header, select your provider (Claude, Gemini, or Doubao), and paste your API key (stored locally in your browser).

---

## 🤖 AI Providers

Workable is provider-agnostic. Swap between them any time to compare results.
- **Anthropic Claude**: Best overall reasoning and JSON fidelity. Supports `claude-opus-4-6`, `claude-sonnet-4-6` (recommended), and `claude-haiku-4-5`.
- **Google Gemini**: Fast, reliable, and generous free tier. Supports `gemini-2.0-flash`, `gemini-1.5-pro`, and `gemini-1.5-flash`.
- **ByteDance Doubao**: High-performance models via standard pay-per-use endpoints or the Coding Plan (`doubao-seed-2.0`, `doubao-pro-32k`, and more).

---

## 📄 License

GNU Affero General Public License v3.0 (AGPL-3.0) © 2026 — share and share alike, even in the cloud.

---

<div align="center">
  <sub>Built with Next.js · React 19 · Tailwind CSS · Anthropic Claude · Google Gemini · ByteDance Doubao</sub>
</div>
