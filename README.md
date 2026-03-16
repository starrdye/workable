# Overflow: Neural Workflow & Ecosystem Twin

<p align="center">
  <em>An interactive visualizer for mapping, analyzing, and optimizing business operations.</em>
</p>

## 📌 Project Overview
The **Neural Workflow & Ecosystem Twin** (currently prototyped in `index.html`) is an interactive visualizer for mapping, analyzing, and optimizing business operations. It transitions a user from raw workflow inputs (text/files) into a dynamic, interactive digital twin of their processes, allowing them to spot bottlenecks and model "What-If" optimizations.

---

## 🚀 Phase 1: Current Prototype Features (UI/UX Baseline)
The `index.html` file serves as the interactive frontend prototype. It successfully demonstrates the following UI/UX paradigms:

- **Mirofish-Style Start Screen**: A frosted-glass landing page with natural language text input and a drag-and-drop file zone.
- **Dual View Rendering**: Seamless toggling between a linear *Baseline Process Map* and a human-centric *Ecosystem Hub*.
- **Optimization Toggles**: An "Improvements" engine that visually fades deprecated bottlenecks (e.g., Edward's manual review) and highlights newly automated routes (e.g., Mary to Dashboard API).
- **Custom Physics & Interactivity**: Draggable nodes (squircle/circle designs) with real-time recalculating connection lines (wires) and continuous CSS-animated data pulses. The pulse speed realistically reflects actual processing time, and the pulse color dynamically depends on the source entity producing the data.
- **Deep-Dive Analysis**: Clickable nodes and connection wires that trigger a slide-out right sidebar displaying entity roles, system status, assigned processes, and connections.

---

## 🛠 Phase 2: Core Development Steps (Transitioning to Full-Stack)
To move from a static frontend prototype to a functional web application, the following architecture and development steps are required:

### 1. Frontend Framework Migration
- **Action**: Port the vanilla HTML/JS into React or Vue.js (Next.js/Nuxt recommended).
- **Why**: To handle complex state management. The hardcoded `nodeData` and `edgeData` dictionaries need to be replaced with a dynamic global state (e.g., using Redux, Zustand, or Pinia).
- **Componentization**: Break down the UI into modular components: `<StartScreen />`, `<GraphCanvas />`, `<Node />`, `<Wire />`, `<AnalysisSidebar />`.

### 2. Graphing Engine Implementation
- **Action**: Replace the custom Pythagorean math calculating the wire angles with a robust graphing library (e.g., React Flow, Cytoscape.js, or D3.js).
- **Why**: While the custom math works for 5-7 nodes, a dedicated library will provide collision detection, auto-layout algorithms (so nodes don't overlap on initial generation), and zooming/panning canvases out-of-the-box.

### 3. Backend & API Setup
- **Action**: Build a backend (Node.js/Express or Python/FastAPI) to handle the Start Screen inputs.
- **Database**: Implement a graph database (like Neo4j) or a document database (like MongoDB) to store saved ecosystem models, node properties, and historical workflow versions.

---

## ⚙️ Phase 3: Features to Develop (MVP Scope)
Based on the prototype, these features need functional backend logic to be fully realized:

- **Dynamic Graph Generation**: The canvas must render dynamically based on a JSON payload from the backend, rather than hardcoded HTML `<div>` elements.
- **CRUD Capabilities for Nodes/Edges**: Users should be able to right-click the canvas to "Add Node" or drag between nodes to "Create Connection" directly within the visualizer.
- **Real-Time Collaboration (WebSockets)**: If user A drags a node or updates a status to "Bottleneck," user B should see the node move and change colors in real-time.
- **Save & Export**: Ability to export the graph as a PNG/PDF, or export the node data as a CSV.

---

## 🤖 Phase 4: Future Enhancements (AI Integration)
The ultimate goal of the Ecosystem Data Engine is to use AI to bridge the gap between messy real-world data and structured visual models.

### 1. AI-Powered Workflow Generation (LLM Integration)
- **Feature**: Connect the Start Screen's text input to an LLM API (OpenAI/Gemini).
- **How it works**: When a user types "Xingye gets input from NAV back office, uses script to parse data, then Mary reviews it...", the AI parses the natural language, identifies the entities, determines the direction of the data flow, and outputs the exact JSON array needed to render the graph automatically.

### 2. Intelligent Document Processing (OCR + RAG)
- **Feature**: Process the files dropped in the Start Screen.
- **How it works**: If a user drops a standard operating procedure (SOP) PDF or a Jira CSV export, the AI reads the document, extracts the key personnel and software tools, and maps their relationships without the user typing a single word.

### 3. AI "Auto-Improvement" Suggestions
- **Feature**: Smart optimization toggles.
- **How it works**: Instead of hardcoding the "Improvements" toggle, an AI agent analyzes the current graph logic. If it notices "Edward" has a "Queue: 2.3 Days" (bottleneck), the AI autonomously generates the suggested bypass route, highlighting it in green and generating a text summary of the time saved.

### 4. Live Data Ingestion & Pulse Synchronization
- **Feature**: Make the "Electric Pulses" represent real-world events.
- **How it works**: Connect the app via Webhooks to real-world tools (Slack, Jira, Outlook). When Xingye actually emails Mary in real life, a pulse shoots across the screen in the digital twin. If the data flow stops, the wire turns red, indicating a live process failure.
