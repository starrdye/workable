// src/lib/csvHelpers.ts
// Pure CSV serialisation / deserialisation helpers.
// Extracted from GraphCanvas.tsx so tests can import them without a DOM environment.

// ─── Types (mirrors WorkflowApiState in GraphCanvas) ─────────────────────────

export interface CsvNode {
  id: string; x: number; y: number;
  initials: string; label: string;
}

export interface CsvCustomNode {
  id: string; labelInitials: string; label: string;
  nodeType: "neural" | "eco";
  role?: string;
  source?: "ai-generated" | "user-added";
  textColor?: string;
  outputDelay?: number;
  position: { x: number; y: number };
}

export interface CsvCustomEdge {
  id: string; source: string; target: string;
  sequence?: number; weight?: number;
  isCustom?: boolean; isImprovementOnly?: boolean;
}

export interface CsvSettings {
  nodePause: number;
  edgeWeightOverrides: Record<string, { sequence?: number; weight?: number }>;
  nodeDelayOverrides: Record<string, number>;
  hiddenCoreNodes?: string[];
  metadataOverrides?: Record<string, unknown>;
  workflowGroups?: Array<{ id: string; name: string; color: string; nodeIds: string[]; parentGroupId?: string }>;
}

export interface ParsedCsv {
  baselinePositions:  Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  customNodes: CsvCustomNode[];
  customEdges: CsvCustomEdge[];
  settings: Partial<CsvSettings>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

export function csvCell(v: string | number): string {
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function csvRow(...cells: (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

export function parseCsvRow(line: string): string[] {
  const out: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { f += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export function buildCsvExport(
  nodes: CsvNode[],
  customNodes: CsvCustomNode[],
  customEdges: CsvCustomEdge[],
  settings: CsvSettings,
  edgesWithParams: Array<{ id: string; source: string; target: string; sequence?: number; weight?: number }>,
): string {
  const lines: string[] = [];
  lines.push("# Ridgeview Workflow Export");
  lines.push(`# Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("# Version: 2.0");
  lines.push("");

  lines.push("[PROCESS_MAP]");
  lines.push("id,initials,label,x,y");
  nodes.forEach((n) =>
    lines.push(csvRow(n.id, n.initials, n.label, Math.round(n.x), Math.round(n.y))));
  lines.push("");

  lines.push("[ECOSYSTEM]");
  lines.push("id,initials,label,x,y");
  lines.push("");

  const hiddenSet = new Set(settings.hiddenCoreNodes ?? []);
  const allCoreHidden = hiddenSet.size > 0;

  lines.push("[CUSTOM_NODES]");
  lines.push("id,initials,label,nodeType,role,source,textColor,outputDelay,baseline_x,baseline_y,ecosystem_x,ecosystem_y");
  customNodes.forEach((cn) => {
    const bPos = nodes.find((n) => n.id === cn.id);
    lines.push(csvRow(
      cn.id, cn.labelInitials, cn.label, cn.nodeType, cn.role || "",
      cn.source || "", cn.textColor || "", cn.outputDelay ?? 1,
      bPos ? Math.round(bPos.x) : Math.round(cn.position.x),
      bPos ? Math.round(bPos.y) : Math.round(cn.position.y),
      bPos ? Math.round(bPos.x) : Math.round(cn.position.x),
      bPos ? Math.round(bPos.y) : Math.round(cn.position.y),
    ));
  });
  lines.push("");

  lines.push("[RELATIONS]");
  lines.push("id,source,target,sequence,weight,source_type");
  edgesWithParams.forEach((e) => {
    const isCustomEdge = customEdges.some((ce) => ce.id === e.id);
    if (!isCustomEdge && allCoreHidden && hiddenSet.has(e.source) && hiddenSet.has(e.target)) return;
    lines.push(csvRow(e.id, e.source, e.target, e.sequence ?? 1, e.weight ?? 1,
      isCustomEdge ? "custom" : "builtin"));
  });
  lines.push("");

  lines.push("[SETTINGS]");
  lines.push("key,value");
  lines.push(csvRow("nodePause", settings.nodePause));
  Object.entries(settings.nodeDelayOverrides || {}).forEach(([id, v]) =>
    lines.push(csvRow(`nodeDelay.${id}`, v)));
  Object.entries(settings.edgeWeightOverrides || {}).forEach(([id, v]) => {
    if (v.weight !== undefined)   lines.push(csvRow(`edgeWeight.${id}`, v.weight));
    if (v.sequence !== undefined) lines.push(csvRow(`edgeSeq.${id}`, v.sequence));
  });
  (settings.hiddenCoreNodes ?? []).forEach((id) =>
    lines.push(csvRow(`hiddenCoreNode.${id}`, 1)));

  if (settings.workflowGroups?.length) {
    lines.push("");
    lines.push("[WORKFLOW_GROUPS]");
    lines.push("id,name,color,nodeIds,parentGroupId");
    settings.workflowGroups.forEach((g) =>
      lines.push(csvRow(g.id, g.name, g.color, g.nodeIds.join(","), g.parentGroupId ?? "")));
  }

  return lines.join("\n");
}

export function parseCsvImport(text: string): ParsedCsv {
  const baselinePositions:  Record<string, { x: number; y: number }> = {};
  const ecosystemPositions: Record<string, { x: number; y: number }> = {};
  const customNodes: CsvCustomNode[] = [];
  const customEdges: CsvCustomEdge[] = [];
  const settings: CsvSettings = { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} };

  let section = "";
  let headers: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1); headers = []; continue;
    }
    const cells = parseCsvRow(line);
    if (headers.length === 0) { headers = cells; continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] || ""));

    if (section === "PROCESS_MAP" && row.id)
      baselinePositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "ECOSYSTEM" && row.id)
      ecosystemPositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "CUSTOM_NODES" && row.id) {
      baselinePositions[row.id]  = { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 };
      ecosystemPositions[row.id] = { x: parseFloat(row.ecosystem_x) || 0, y: parseFloat(row.ecosystem_y) || 0 };
      customNodes.push({
        id: row.id, labelInitials: row.initials, label: row.label,
        nodeType: (row.nodeType as "neural" | "eco") || "neural",
        role: row.role || undefined,
        source: (row.source as "ai-generated" | "user-added") || undefined,
        textColor: row.textColor || undefined,
        outputDelay: parseFloat(row.outputDelay) || undefined,
        position: { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 },
      });
    }
    else if (section === "RELATIONS" && row.id) {
      const seq = parseInt(row.sequence) || 1;
      const w   = parseFloat(row.weight)   || 1;
      if (row.source_type === "custom") {
        customEdges.push({ id: row.id, source: row.source, target: row.target,
          sequence: seq, weight: w, isCustom: true });
      } else {
        settings.edgeWeightOverrides![row.id] = { sequence: seq, weight: w };
      }
    }
    else if (section === "CUSTOM_EDGES" && row.id)
      customEdges.push({ id: row.id, source: row.source, target: row.target,
        sequence: parseInt(row.sequence) || 1, weight: parseFloat(row.weight) || 1, isCustom: true });
    else if (section === "SETTINGS" && row.key) {
      const val = parseFloat(row.value);
      if (row.key === "nodePause") settings.nodePause = val;
      else if (row.key.startsWith("nodeDelay."))
        settings.nodeDelayOverrides![row.key.replace("nodeDelay.", "")] = val;
      else if (row.key.startsWith("hiddenCoreNode.")) {
        if (!settings.hiddenCoreNodes) settings.hiddenCoreNodes = [];
        settings.hiddenCoreNodes.push(row.key.replace("hiddenCoreNode.", ""));
      } else if (row.key.startsWith("edgeWeight.")) {
        const id = row.key.replace("edgeWeight.", "");
        if (!settings.edgeWeightOverrides![id]) settings.edgeWeightOverrides![id] = {};
        settings.edgeWeightOverrides![id].weight = val;
      } else if (row.key.startsWith("edgeSeq.")) {
        const id = row.key.replace("edgeSeq.", "");
        if (!settings.edgeWeightOverrides![id]) settings.edgeWeightOverrides![id] = {};
        settings.edgeWeightOverrides![id].sequence = Math.round(val);
      }
    }
    else if (section === "WORKFLOW_GROUPS" && row.id) {
      if (!settings.workflowGroups) settings.workflowGroups = [];
      const parentId = row.parentGroupId?.trim();
      settings.workflowGroups.push({
        id: row.id, name: row.name || row.id, color: row.color || "#6366F1",
        nodeIds: row.nodeIds ? row.nodeIds.split(",").map((s) => s.trim()).filter(Boolean) : [],
        ...(parentId ? { parentGroupId: parentId } : {}),
      });
    }
  }

  return { baselinePositions, ecosystemPositions, customNodes, customEdges, settings };
}
