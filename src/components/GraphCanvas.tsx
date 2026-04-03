"use client";
import {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from "react";
import { CORE_NODE_IDS, ROLE_COLOR } from "@/lib/constants";
import type { NodeTask } from "@/lib/serverState";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLanguage } from "@/contexts/LanguageContext";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface GraphCanvasRef {
  exportCsv: () => void;
  exportPng: () => void;
  importCsv: (text: string) => void;
  /** Fire resetLayout server action, immediately re-fetch positions, and reset the viewport. */
  triggerResetLayout: () => Promise<void>;
  triggerRefresh: () => Promise<void>;
}

export interface GraphCanvasProps {
  showImprovements: boolean;
  /** When true, all edges render at full opacity with animated flow — "always-on flow mode". */
  showDataFlow?: boolean;
  /** When true, edges are more visible, borders are thicker, and text contrast is increased. */
  highContrast?: boolean;
  selectedId: string | null;
  selectedType: "node" | "edge" | null;
  onSelectNode: (id: string, type: "node" | "edge") => void;
  onDeselect: () => void;
  onHover: (name: string, summary: string) => void;
  onHoverEnd: () => void;
  onDeleteNode: (id: string) => void;
  /** Highlight nodes whose name/initials contain this query. Non-matching nodes are dimmed. */
  searchQuery?: string;
  /** Filter nodes by role and/or workflow group. Empty array = no filter applied. */
  activeFilters?: { roles: string[]; groupIds: string[] };
  /** Node IDs from AI analysis that should show the amber bottleneck-glow highlight. */
  bottleneckNodeIds?: string[];
  /** Pairs from AI analysis showing suggested-but-not-yet-added connections as dashed arcs. */
  suggestedConnectionPairs?: Array<{ sourceId: string; targetId: string }>;
  /** Edge IDs from AI analysis flagged for removal — shown with amber/yellow highlight. */
  redundantEdgeIds?: string[];
  /**
   * vb0.22: IDs of groups that were just created by an AI "create group" suggestion.
   * Rendered with a dashed emerald border + pulsing glow so they are immediately
   * identifiable as AI-proposed rather than manually-created.
   */
  proposedGroupIds?: string[];
}

interface CanvasNode {
  id: string; x: number; y: number;
  initials: string; label: string;
  subcategory?: string;
  bottleneck?: boolean; bottleneckText?: string;
  isDeprecated?: boolean; isUpgraded?: boolean;
  borderColor: string; textColor: string;
  labelBg: string; labelBorderColor: string; labelTextColor?: string;
  isCustom?: boolean;
  role?: string; // for filter support
}
interface CanvasEdge {
  id: string; source: string; target: string;
  isDeprecated?: boolean; isUpgraded?: boolean;
  isCustom?: boolean;
  sequence?: number;
  weight?: number;
}
interface DragState { nodeId: string; offsetX: number; offsetY: number; hasMoved: boolean; }
type CtxMenu =
  | { type: "canvas"; x: number; y: number; cx: number; cy: number }
  | { type: "node"; x: number; y: number; nodeId: string };
interface AddForm { cx: number; cy: number; label: string; initials: string; role: "person" | "tool" | "external" | "output"; }
interface WorkflowApiState {
  baselinePositions: Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  customNodes: Array<{ id: string; labelInitials: string; label: string; nodeType: "neural" | "eco"; role?: string; source?: "ai-generated" | "user-added"; textColor?: string; position: { x: number; y: number }; outputDelay?: number }>;
  customEdges: Array<{ id: string; source: string; target: string; sequence?: number; weight?: number; isCustom?: boolean; isImprovementOnly?: boolean }>;
  settings: {
    nodePause: number;
    edgeWeightOverrides: Record<string, { sequence?: number; weight?: number }>;
    nodeDelayOverrides: Record<string, number>;
    hiddenCoreNodes?: string[];
    metadataOverrides?: Record<string, {
      name?: string; role?: string; status?: string; statusColor?: string;
      summary?: string; processes?: string[]; connections?: string[];
      constraints?: string;
      tasks?: import("@/lib/serverState").NodeTask[];
    }>;
    workflowGroups?: Array<{ id: string; name: string; color: string; nodeIds: string[]; parentGroupId?: string }>;
  };
  lastUpdated: number;
  _positionsHash?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SZ = 56;
const R = SZ / 2;

// Task dot status colours
const TASK_STATUS_COLOR: Record<NodeTask["status"], string> = {
  "todo": "#94A3B8",
  "in-progress": "#3B82F6",
  "done": "#10B981",
  "blocked": "#EF4444",
  "review": "#A855F7",
};
const TASK_PRIORITY_LABEL: Record<NodeTask["priority"], string> = {
  low: "↓ Low", medium: "→ Med", high: "↑ High",
};

// Default border/text per core node ID
const BASE_STYLE: Record<string, { border: string; text: string }> = {
  nav: { border: "#CBD5E1", text: "#475569" },
  script: { border: "#E2E8F0", text: "#64748B" },
  db: { border: "#E2E8F0", text: "#64748B" },
  xy: { border: "#4F46E5", text: "#4F46E5" },
  mary: { border: "#CBD5E1", text: "#475569" },
  ed: { border: "#F59E0B", text: "#F59E0B" },
  cy: { border: "#0EA5E9", text: "#0EA5E9" },
};
const BASE_LABELS: Record<string, { initials: string; label: string }> = {
  nav: { initials: "NB", label: "NAV Back Office" },
  script: { initials: "</>", label: "Parsing Script" },
  db: { initials: "DB", label: "Database" },
  xy: { initials: "XY", label: "Xingye" },
  mary: { initials: "MM", label: "Mary" },
  ed: { initials: "EC", label: "Edward" },
  cy: { initials: "RV", label: "Ridgeview Dashboard" },
};
// Role labels for core nodes (used for filter matching)
const BASE_ROLE: Record<string, string> = {
  nav: "external", script: "tool", db: "tool",
  xy: "person", mary: "person", ed: "person", cy: "output",
};
const ECO_SUB: Record<string, string> = { xy: "Hub", mary: "Collaborator", ed: "Manager" };
const CORE_IDS = new Set<string>(CORE_NODE_IDS);

const NODE_META: Record<string, { name: string; summary: string }> = {
  nav: { name: "NAV Back Office", summary: "Provides initial raw data for the fund." },
  script: { name: "Parsing Script", summary: "Parses raw NAV data into standardized formats." },
  db: { name: "Database", summary: "Stores historical records and references." },
  xy: { name: "Xingye", summary: "Compiles inputs and routes data for approval." },
  mary: { name: "Mary", summary: "Provides initial review and approval." },
  ed: { name: "Edward", summary: "Final manual review queue holding up the pipeline." },
  cy: { name: "Ridgeview Dashboard", summary: "Final generated report for the fund." },
};
const EDGE_META: Record<string, { name: string; summary: string }> = {
  "nav-xy": { name: "Data Ingestion", summary: "Raw NAV data transferred to Xingye." },
  "xy-script": { name: "Parsing Request", summary: "Xingye sends raw data to script for parsing." },
  "script-xy": { name: "Script Execution", summary: "Script parses raw data into usable formats." },
  "db-xy": { name: "Historical Query", summary: "Pulls past records to match with new NAV." },
  "xy-mary": { name: "Draft Submission", summary: "Xingye submits compiled report to Mary." },
  "mary-ed": { name: "Escalation", summary: "Mary forwards to Edward for final sign-off." },
  "ed-cy": { name: "Publishing", summary: "Edward approves and generates the dashboard." },
  "mary-cy": { name: "Automated Publishing", summary: "Direct publish to dashboard, bypassing Edward." },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildNodes(
  pos: Record<string, { x: number; y: number }>,
  customNodes: WorkflowApiState["customNodes"],
  showImprovements: boolean,
): CanvasNode[] {
  const ids = CORE_NODE_IDS;
  const out: CanvasNode[] = [...ids].map((id) => {
    const p = pos[id] || { x: 100, y: 100 };
    const s = BASE_STYLE[id];
    const isBottleneck = id === "ed";
    // The bottleneck node is never visually deprecated — only its edges fade in optimised mode
    // (handled by isDeprecated flags in buildEdges). The node itself always keeps white fill
    // with amber border + text so the glow reads clearly when showImprovements is on.
    const isUpgr = id === "cy" && showImprovements;
    const border = isUpgr ? "#10B981" : s.border;
    const text = isUpgr ? "#10B981" : s.text;
    return {
      id, x: p.x, y: p.y,
      initials: BASE_LABELS[id].initials,
      label: BASE_LABELS[id].label,
      subcategory: ECO_SUB[id],
      bottleneck: isBottleneck, bottleneckText: undefined,
      isDeprecated: false, isUpgraded: isUpgr,
      borderColor: border, textColor: text,
      labelBg: "rgba(255,255,255,0.95)", labelBorderColor: "#E2E8F0",
      labelTextColor: "#334155",
      role: BASE_ROLE[id] ?? "tool",
    };
  });
  customNodes.forEach((cn) => {
    const p = pos[cn.id] || cn.position;
    const clr = cn.textColor || ROLE_COLOR[cn.role || ""] || "#4F46E5";
    out.push({
      id: cn.id, x: p.x, y: p.y,
      initials: cn.labelInitials, label: cn.label,
      borderColor: clr, textColor: clr,
      labelBg: "rgba(255,255,255,0.95)", labelBorderColor: "#E2E8F0",
      isCustom: true,
      role: cn.role ?? "tool",
    });
  });
  return out;
}

function buildEdges(showImprovements: boolean, customEdges: WorkflowApiState["customEdges"]): CanvasEdge[] {
  const base: CanvasEdge[] = [
    { id: "nav-xy", source: "nav", target: "xy", sequence: 1, weight: 1 },
    { id: "xy-script", source: "xy", target: "script", sequence: 2, weight: 1 },
    { id: "script-xy", source: "script", target: "xy", sequence: 3, weight: 1 },
    { id: "db-xy", source: "db", target: "xy", sequence: 3, weight: 1 },
    { id: "xy-mary", source: "xy", target: "mary", sequence: 4, weight: 1 },
    { id: "mary-ed", source: "mary", target: "ed", sequence: 5, weight: 1.5, isDeprecated: showImprovements },
    { id: "ed-cy", source: "ed", target: "cy", sequence: 6, weight: 6, isDeprecated: showImprovements },
    ...(showImprovements ? [{ id: "mary-cy", source: "mary", target: "cy", sequence: 5, weight: 1.2, isUpgraded: true }] : []),
  ];

  const existing = new Set(base.map((e) => e.id));
  customEdges.forEach((ce) => {
    if (!existing.has(ce.id)) {
      const isOnlyWhenImproved = !!ce.isImprovementOnly;
      // Improvement-only edges are completely hidden in Current Workflow mode —
      // they only exist in the Optimised view where they render as upgraded (emerald + glow).
      if (isOnlyWhenImproved && !showImprovements) return;
      base.push({
        id: ce.id, source: ce.source, target: ce.target,
        sequence: ce.sequence || 1, weight: ce.weight || 1,
        isDeprecated: false,
        isUpgraded: isOnlyWhenImproved,  // emerald + glow in Optimised mode
        isCustom: true,
      });
    }
  });
  return base;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function csvCell(v: string | number): string {
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(...cells: (string | number)[]): string { return cells.map(csvCell).join(","); }
function parseCsvRow(line: string): string[] {
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

function buildCsvExport(
  nodes: CanvasNode[],
  customNodes: WorkflowApiState["customNodes"],
  customEdges: WorkflowApiState["customEdges"],
  settings: WorkflowApiState["settings"],
  edgesWithParams: CanvasEdge[],
): string {
  const lines: string[] = [];
  lines.push("# Ridgeview Workflow Export");
  lines.push(`# Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("# Version: 2.0");
  lines.push("");

  lines.push("[PROCESS_MAP]");
  lines.push("id,initials,label,x,y");
  nodes.forEach((n) => lines.push(csvRow(n.id, n.initials, n.label, Math.round(n.x), Math.round(n.y))));
  lines.push("");

  // Keep ECOSYSTEM section for CSV compatibility (import won't break)
  lines.push("[ECOSYSTEM]");
  lines.push("id,initials,label,x,y");
  lines.push("");

  // When all core nodes are hidden (AI-generated workflow), exclude them and
  // their builtin edges from the export — they are template infrastructure
  // irrelevant to the user's custom workflow.
  const hiddenSet = new Set(settings.hiddenCoreNodes ?? []);
  const allCoreHidden = hiddenSet.size > 0;

  lines.push("[CUSTOM_NODES]");
  lines.push("id,initials,label,nodeType,role,source,textColor,outputDelay,baseline_x,baseline_y,ecosystem_x,ecosystem_y");
  customNodes.forEach((cn) => {
    const bPos = nodes.find((n) => n.id === cn.id);
    lines.push(csvRow(
      cn.id, cn.labelInitials, cn.label, cn.nodeType, cn.role || "",
      cn.source || "",
      cn.textColor || "",
      cn.outputDelay ?? 1,
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
    const isCustomEdge = customEdges.some(ce => ce.id === e.id);
    // Skip builtin edges whose endpoints are hidden core nodes — they belong to
    // the template and are not part of the user's custom workflow.
    if (!isCustomEdge && allCoreHidden && hiddenSet.has(e.source) && hiddenSet.has(e.target)) return;
    lines.push(csvRow(e.id, e.source, e.target, e.sequence ?? 1, e.weight ?? 1, isCustomEdge ? "custom" : "builtin"));
  });
  lines.push("");

  lines.push("[SETTINGS]");
  lines.push("key,value");
  lines.push(csvRow("nodePause", settings.nodePause));
  Object.entries(settings.nodeDelayOverrides || {}).forEach(([id, v]) => lines.push(csvRow(`nodeDelay.${id}`, v)));
  Object.entries(settings.edgeWeightOverrides || {}).forEach(([id, v]) => {
    if (v.weight !== undefined) lines.push(csvRow(`edgeWeight.${id}`, v.weight));
    if (v.sequence !== undefined) lines.push(csvRow(`edgeSeq.${id}`, v.sequence));
  });
  (settings.hiddenCoreNodes ?? []).forEach((id) => lines.push(csvRow(`hiddenCoreNode.${id}`, 1)));

  if (settings.workflowGroups?.length) {
    lines.push("");
    lines.push("[WORKFLOW_GROUPS]");
    lines.push("id,name,color,nodeIds,parentGroupId");
    settings.workflowGroups.forEach((g) => {
      lines.push(csvRow(g.id, g.name, g.color, g.nodeIds.join(","), g.parentGroupId ?? ""));
    });
  }

  return lines.join("\n");
}

function parseCsvImport(text: string): {
  baselinePositions: Record<string, { x: number; y: number }>;
  ecosystemPositions: Record<string, { x: number; y: number }>;
  customNodes: WorkflowApiState["customNodes"];
  customEdges: WorkflowApiState["customEdges"];
  settings: Partial<WorkflowApiState["settings"]>;
} {
  const baselinePositions: Record<string, { x: number; y: number }> = {};
  const ecosystemPositions: Record<string, { x: number; y: number }> = {};
  const customNodes: WorkflowApiState["customNodes"] = [];
  const customEdges: WorkflowApiState["customEdges"] = [];
  const settings: WorkflowApiState["settings"] = { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} };

  let section = "";
  let headers: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) { section = line.slice(1, -1); headers = []; continue; }
    const cells = parseCsvRow(line);
    if (headers.length === 0) { headers = cells; continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] || ""));

    if (section === "PROCESS_MAP" && row.id)
      baselinePositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "ECOSYSTEM" && row.id)
      ecosystemPositions[row.id] = { x: parseFloat(row.x) || 0, y: parseFloat(row.y) || 0 };
    else if (section === "CUSTOM_NODES" && row.id) {
      baselinePositions[row.id] = { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 };
      ecosystemPositions[row.id] = { x: parseFloat(row.ecosystem_x) || 0, y: parseFloat(row.ecosystem_y) || 0 };
      customNodes.push({
        id: row.id, labelInitials: row.initials, label: row.label,
        nodeType: (row.nodeType as "neural" | "eco") || "neural",
        role: (row.role as WorkflowApiState["customNodes"][0]["role"]) || undefined,
        source: (row.source as "ai-generated" | "user-added") || undefined,
        textColor: row.textColor || undefined,
        outputDelay: parseFloat(row.outputDelay) || undefined,
        position: { x: parseFloat(row.baseline_x) || 0, y: parseFloat(row.baseline_y) || 0 },
      });
    }
    else if (section === "RELATIONS" && row.id) {
      const seq = parseInt(row.sequence) || 1;
      const w = parseFloat(row.weight) || 1;
      if (row.source_type === "custom") {
        customEdges.push({ id: row.id, source: row.source, target: row.target, sequence: seq, weight: w, isCustom: true });
      } else {
        settings.edgeWeightOverrides![row.id] = { sequence: seq, weight: w };
      }
    }
    else if (section === "CUSTOM_EDGES" && row.id) // legacy compat
      customEdges.push({ id: row.id, source: row.source, target: row.target, sequence: parseInt(row.sequence) || 1, weight: parseFloat(row.weight) || 1, isCustom: true });
    else if (section === "SETTINGS" && row.key) {
      const val = parseFloat(row.value);
      if (row.key === "nodePause") settings.nodePause = val;
      else if (row.key.startsWith("nodeDelay.")) settings.nodeDelayOverrides![row.key.replace("nodeDelay.", "")] = val;
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
        id: row.id,
        name: row.name || row.id,
        color: row.color || "#6366F1",
        nodeIds: row.nodeIds ? row.nodeIds.split(",").map((s) => s.trim()).filter(Boolean) : [],
        ...(parentId ? { parentGroupId: parentId } : {}),
      });
    }
  }
  return { baselinePositions, ecosystemPositions, customNodes, customEdges, settings };
}

// ─── PNG export ───────────────────────────────────────────────────────────────
const EXPORT_TASK_COLORS: Record<string, string> = {
  "todo": "#94A3B8", "in-progress": "#3B82F6", "done": "#10B981",
  "blocked": "#EF4444", "review": "#A855F7",
};

/** Escape special XML characters so SVG text content is always valid XML. */
function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvgExport(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  serverState?: WorkflowApiState | null,
): { svg: string; width: number; height: number } {
  if (!nodes.length) {
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" style="background:#F8FAFC;font-family:Inter,sans-serif;"><rect width="1200" height="700" fill="#F8FAFC"/></svg>`, width: 1200, height: 700 };
  }

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const allGroups = serverState?.settings?.workflowGroups ?? [];
  const metaOverrides = serverState?.settings?.metadataOverrides ?? {};

  // ── Compute content bounding box ──────────────────────────────────────────
  const OUTER_PAD = 80;
  const xs = nodes.map((n) => n.x + R);
  const ys = nodes.map((n) => n.y + R);
  const rawMinX = Math.min(...xs) - R - OUTER_PAD;
  const rawMaxX = Math.max(...xs) + R + OUTER_PAD;
  const rawMinY = Math.min(...ys) - R - OUTER_PAD;
  const rawMaxY = Math.max(...ys) + R + OUTER_PAD;
  const contentW = rawMaxX - rawMinX;
  const contentH = rawMaxY - rawMinY;

  // Scale to fit ≤2400×1400 (clear without being excessive)
  const MAX_W = 2400, MAX_H = 1400;
  const scale = Math.min(MAX_W / contentW, MAX_H / contentH, 2.5);
  const W = Math.round(Math.max(1200, contentW * scale));
  const H = Math.round(Math.max(700, contentH * scale));

  // Coordinate transform helpers (raw node-space → SVG pixel)
  const cx = (x: number) => (x - rawMinX) * scale;
  const cy = (y: number) => (y - rawMinY) * scale;
  const sr = R * scale; // scaled node radius

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#F8FAFC;font-family:Inter,sans-serif;">`,
    `<defs>`,
    `<pattern id="g" width="${24 * scale}" height="${24 * scale}" patternUnits="userSpaceOnUse">`,
    `<circle cx="${scale}" cy="${scale}" r="${scale}" fill="#CBD5E1"/></pattern>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="url(#g)"/>`,
  ];

  // ── Workflow group bounding boxes ────────────────────────────────────────
  const GROUP_PAD = 34;
  const getRecursiveNodes = (groupId: string, visited: Set<string>): string[] => {
    if (visited.has(groupId)) return [];
    visited.add(groupId);
    const grp = allGroups.find((g) => g.id === groupId);
    if (!grp) return [];
    return [
      ...grp.nodeIds,
      ...allGroups.filter((g) => g.parentGroupId === groupId).flatMap((child) => getRecursiveNodes(child.id, visited)),
    ];
  };
  const bboxOf = (nodeIds: string[]) => {
    const members = nodeIds.map((id) => nodeMap[id]).filter(Boolean);
    if (!members.length) return null;
    const mxs = members.map((n) => n.x + R);
    const mys = members.map((n) => n.y + R);
    return {
      minX: Math.min(...mxs) - GROUP_PAD - R,
      maxX: Math.max(...mxs) + GROUP_PAD + R,
      minY: Math.min(...mys) - GROUP_PAD - R,
      maxY: Math.max(...mys) + GROUP_PAD + R,
      count: members.length,
    };
  };
  const renderGroupSvg = (group: { id: string; name: string; color: string; nodeIds: string[]; parentGroupId?: string }, isSubgroup: boolean) => {
    const ids = getRecursiveNodes(group.id, new Set());
    const b = bboxOf(ids);
    if (!b) return "";
    const { minX, maxX, minY, maxY, count } = b;
    const gx = cx(minX), gy = cy(minY);
    const gw = (maxX - minX) * scale, gh = (maxY - minY) * scale;
    const fill = group.color + (isSubgroup ? "20" : "10");
    const stroke = group.color + (isSubgroup ? "88" : "55");
    const sw = 1.5 * scale;
    const dash = isSubgroup ? "" : `stroke-dasharray="${8 * scale} ${4 * scale}"`;
    const rx = (isSubgroup ? 12 : 18) * scale;
    const labelText = `${xmlEsc(group.name)} · ${count}`;
    const labelSize = (isSubgroup ? 9 : 11) * scale;
    const charW = labelSize * 0.58;
    const pillPadX = (isSubgroup ? 8 : 10) * scale;
    const pillPadY = (isSubgroup ? 4 : 5) * scale;
    const pillW = labelText.length * charW + pillPadX * 2;
    const pillH = labelSize + pillPadY * 2;
    const pillX = gx + (isSubgroup ? 10 : 14) * scale - pillPadX;
    const pillY = gy + (isSubgroup ? 14 : 16) * scale - labelSize - pillPadY;
    return [
      `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>`,
      `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" ry="${pillH / 2}" fill="${group.color}18" stroke="${group.color}77" stroke-width="1"/>`,
      `<text x="${gx + (isSubgroup ? 10 : 14) * scale}" y="${gy + (isSubgroup ? 14 : 16) * scale}" font-size="${labelSize}" font-weight="700" fill="${group.color}">${labelText}</text>`,
    ].join("");
  };
  // Render parent groups first (background), subgroups on top
  allGroups.filter((g) => !g.parentGroupId).forEach((g) => parts.push(renderGroupSvg(g, false)));
  allGroups.filter((g) => !!g.parentGroupId).forEach((g) => parts.push(renderGroupSvg(g, true)));

  // ── Arrowhead marker defs ───────────────────────────────────────────────
  parts.push("<defs>");
  edges.forEach((e) => {
    const stroke = e.isUpgraded ? "#10B981" : "#94A3B8";
    const op = e.isDeprecated ? 0.3 : 0.7;
    const mid = e.id.replace(/[^a-zA-Z0-9]/g, "_");
    parts.push(`<marker id="arr-${mid}" markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto"><path d="M0,0 L0,5 L7,2.5 z" fill="${stroke}" opacity="${op}"/></marker>`);
  });
  parts.push("</defs>");

  // ── Edges with quadratic bezier curves ──────────────────────────────────
  edges.forEach((e) => {
    const s = nodeMap[e.source], t = nodeMap[e.target];
    if (!s || !t) return;
    const x1 = cx(s.x + R), y1 = cy(s.y + R);
    const x2 = cx(t.x + R), y2 = cy(t.y + R);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const curvature = Math.min(len * 0.28, 90 * scale);
    const cpx = mx - (dy / Math.max(len, 1)) * curvature;
    const cpy = my + (dx / Math.max(len, 1)) * curvature;
    const d = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
    const stroke = e.isUpgraded ? "#10B981" : "#94A3B8";
    const op = e.isDeprecated ? 0.08 : (e.isUpgraded ? 0.9 : 0.45);
    const sw = 1.5 * scale;
    const mid = e.id.replace(/[^a-zA-Z0-9]/g, "_");
    const glowFilter = e.isUpgraded ? ` filter="drop-shadow(0 0 ${4 * scale}px rgba(16,185,129,0.55))"` : "";
    parts.push(`<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="none" opacity="${op}" marker-end="url(#arr-${mid})"${glowFilter}/>`);
  });

  // ── Task dots orbiting nodes ────────────────────────────────────────────
  nodes.forEach((n) => {
    if (n.isDeprecated) return;
    const tasks = (metaOverrides[n.id]?.tasks ?? []) as Array<{ id: string; status: string; priority?: string }>;
    if (!tasks.length) return;
    const ncx = cx(n.x + R), ncy = cy(n.y + R);
    const taskR = 42 * scale;
    tasks.slice(0, 8).forEach((task, i) => {
      const angle = (i / Math.min(tasks.length, 8)) * Math.PI * 2 - Math.PI / 2;
      const tx = ncx + taskR * Math.cos(angle);
      const ty = ncy + taskR * Math.sin(angle);
      const color = EXPORT_TASK_COLORS[task.status] ?? "#94A3B8";
      parts.push(`<line x1="${ncx}" y1="${ncy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="${0.8 * scale}" opacity="0.25"/>`);
      parts.push(`<circle cx="${tx}" cy="${ty}" r="${5 * scale}" fill="${color}" stroke="white" stroke-width="${1.5 * scale}"/>`);
    });
  });

  // ── Nodes ───────────────────────────────────────────────────────────────
  nodes.forEach((n) => {
    const op = n.isDeprecated ? 0.3 : 1;
    const ncx = cx(n.x + R), ncy = cy(n.y + R);
    const shadowFilter = n.isDeprecated ? "" : ` filter="drop-shadow(0 ${2 * scale}px ${8 * scale}px rgba(0,0,0,0.08))"`;
    parts.push(`<circle cx="${ncx}" cy="${ncy}" r="${sr}" fill="white" stroke="${n.borderColor}" stroke-width="${2 * scale}" opacity="${op}"${shadowFilter}/>`);
    parts.push(`<text x="${ncx}" y="${ncy + 5 * scale}" text-anchor="middle" font-size="${13 * scale}" font-weight="700" fill="${n.textColor}" opacity="${op}">${xmlEsc(n.initials)}</text>`);
    parts.push(`<text x="${ncx}" y="${ncy + sr + 16 * scale}" text-anchor="middle" font-size="${10 * scale}" fill="#334155" opacity="${op}">${xmlEsc(n.label)}</text>`);
  });

  parts.push("</svg>");
  return { svg: parts.join(""), width: W, height: H };
}

function downloadSvgAsPng(svgResult: { svg: string; width: number; height: number }) {
  const { svg, width, height } = svgResult;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new window.Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#F8FAFC"; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png");
    a.download = "workflow-graph.png"; a.click();
  };
  img.src = url;
}
function downloadBlob(content: string, filename: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename; a.click();
}

// ─── Main Component ───────────────────────────────────────────────────────────
export const GraphCanvas = forwardRef<GraphCanvasRef, GraphCanvasProps>(
  function GraphCanvas({
    showImprovements, showDataFlow = false, highContrast = false, selectedId, selectedType,
    onSelectNode, onDeselect, onHover, onHoverEnd, onDeleteNode,
    searchQuery = "",
    activeFilters = { roles: [], groupIds: [] },
    bottleneckNodeIds = [],
    suggestedConnectionPairs = [],
    redundantEdgeIds = [],
    proposedGroupIds = [],
  }, ref) {
    const { t } = useLanguage();
    const canvasRef = useRef<HTMLDivElement>(null);

    const [serverState, setServerState] = useState<WorkflowApiState | null>(null);
    const lastPollTs = useRef(0);

    const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);

    const nodes = useMemo(() => {
      const hidden = new Set(serverState?.settings?.hiddenCoreNodes ?? []);
      // Only hide core nodes — never hide custom nodes even if they share an ID with a core node
      return canvasNodes.filter((n) => n.isCustom || !hidden.has(n.id));
    }, [canvasNodes, serverState]);

    const edges = useMemo(
      () => buildEdges(showImprovements, serverState?.customEdges || []),
      [showImprovements, serverState?.customEdges]
    );
    const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

    /** Pre-calculate recursive membership and depth for every group to ensure performance and correct layering. */
    const groupHierarchy = useMemo(() => {
      const gList = serverState?.settings?.workflowGroups ?? [];
      const nodesMap: Record<string, string[]> = {};
      const depthMap: Record<string, number> = {};

      const compute = (gid: string, visited: Set<string>, depth: number): string[] => {
        if (visited.has(gid)) return []; // Safety: prevent infinite recursion on cycles
        visited.add(gid);
        const g = gList.find(x => x.id === gid);
        if (!g) return [];

        depthMap[gid] = Math.max(depthMap[gid] ?? 0, depth);
        const members = [...g.nodeIds];
        // Find children
        for (const child of gList) {
          if (child.parentGroupId === gid) {
            members.push(...compute(child.id, visited, depth + 1));
          }
        }
        const unique = Array.from(new Set(members));
        nodesMap[gid] = unique;
        return unique;
      };

      // First pass: root groups (distance from root defines rendering depth)
      gList.filter(g => !g.parentGroupId).forEach(root => compute(root.id, new Set(), 0));
      // Second pass: catch any orphaned subgroup islands
      gList.forEach(g => { if (depthMap[g.id] === undefined) compute(g.id, new Set(), 0); });

      return { nodesMap, depthMap };
    }, [serverState?.settings?.workflowGroups]);

    // ── Search + Filter visibility ──────────────────────────────────────────
    /** Set of node IDs that pass current search query. null = no search active. */
    const searchMatchIds = useMemo(() => {
      if (!searchQuery.trim()) return null;
      const q = searchQuery.toLowerCase();
      return new Set(
        nodes
          .filter((n) => n.label.toLowerCase().includes(q) || n.initials.toLowerCase().includes(q))
          .map((n) => n.id)
      );
    }, [searchQuery, nodes]);

    /** Set of node IDs in any of the active filter groups. null = no group filter. */
    const groupFilterNodeIds = useMemo(() => {
      if (!activeFilters.groupIds.length) return null;
      const ids = new Set<string>();
      activeFilters.groupIds.forEach(gid => {
        (groupHierarchy.nodesMap[gid] ?? []).forEach(nid => ids.add(nid));
      });
      return ids;
    }, [activeFilters.groupIds, groupHierarchy]);

    /** Compute per-node visibility opacity: 1 = visible, 0.12 = dimmed */
    function nodeOpacity(nodeId: string): number {
      // Search takes priority
      if (searchMatchIds !== null && !searchMatchIds.has(nodeId)) return 0.12;
      // Role filter
      if (activeFilters.roles.length > 0) {
        const node = nodeMap[nodeId];
        if (node && !activeFilters.roles.includes(node.role ?? "")) return 0.12;
      }
      // Group filter
      if (groupFilterNodeIds !== null && !groupFilterNodeIds.has(nodeId)) return 0.12;
      return 1;
    }

    function isNodeHighlighted(nodeId: string): boolean {
      if (searchMatchIds !== null && searchMatchIds.has(nodeId)) return true;
      return false;
    }

    // ── Hover highlight ──────────────────────────────────────────────────────
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

    const connectedEdgeIds = useMemo(() => {
      if (!hoveredNodeId) return null;
      return new Set(edges.filter((e) => e.source === hoveredNodeId || e.target === hoveredNodeId).map((e) => e.id));
    }, [hoveredNodeId, edges]);

    // ── Pan + Zoom ────────────────────────────────────────────────────────────
    const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, scale: 1 });
    const vtRef = useRef({ x: 0, y: 0, scale: 1 });
    const panRef = useRef<{ sx: number; sy: number; svx: number; svy: number } | null>(null);
    const isPanningRef = useRef(false);
    const touchRef = useRef<{ pinchDist?: number } | null>(null);
    const touchStartTimeRef = useRef(0);

    useEffect(() => { vtRef.current = viewTransform; }, [viewTransform]);

    /** Fit all visible nodes into the canvas viewport with padding. */
    const fitAllToView = useCallback(() => {
      if (!canvasRef.current) return;
      const visibleNodes = canvasNodes.filter(n => {
        const hidden = new Set(serverState?.settings?.hiddenCoreNodes ?? []);
        return n.isCustom || !hidden.has(n.id);
      });
      if (!visibleNodes.length) return;
      const PAD = 80;
      const minX = Math.min(...visibleNodes.map(n => n.x)) - PAD;
      const maxX = Math.max(...visibleNodes.map(n => n.x + 2 * R)) + PAD;
      const minY = Math.min(...visibleNodes.map(n => n.y)) - PAD;
      const maxY = Math.max(...visibleNodes.map(n => n.y + 2 * R)) + PAD;
      const rect = canvasRef.current.getBoundingClientRect();
      const contentW = maxX - minX;
      const contentH = maxY - minY;
      const scale = Math.min(rect.width / contentW, rect.height / contentH, 1.5);
      const x = (rect.width - contentW * scale) / 2 - minX * scale;
      const y = (rect.height - contentH * scale) / 2 - minY * scale;
      const next = { x, y, scale };
      vtRef.current = next;
      setViewTransform(next);
    }, [canvasNodes, serverState]);

    const didInitialFit = useRef(false);
    // Auto-fit viewport the first time canvasNodes populates so nodes are always
    // centred and scaled to the actual canvas size regardless of window dimensions.
    useEffect(() => {
      if (canvasNodes.length > 0 && !didInitialFit.current) {
        didInitialFit.current = true;
        requestAnimationFrame(() => fitAllToView());
      }
    }, [canvasNodes.length, fitAllToView]);

    const clientToCanvas = useCallback((clientX: number, clientY: number) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const vt = vtRef.current;
      return { x: (clientX - rect.left - vt.x) / vt.scale, y: (clientY - rect.top - vt.y) / vt.scale };
    }, []);

    const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const vt = vtRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.max(0.15, Math.min(4, vt.scale * factor));
      const next = { x: mx - (mx - vt.x) * (ns / vt.scale), y: my - (my - vt.y) * (ns / vt.scale), scale: ns };
      vtRef.current = next;
      setViewTransform(next);
    }, []);
    useEffect(() => {
      const el = canvasRef.current;
      if (!el) return;
      el.addEventListener("wheel", handleWheel, { passive: false });
      return () => el.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    // ── Touch pan + pinch-zoom ────────────────────────────────────────────────
    useEffect(() => {
      const el = canvasRef.current;
      if (!el) return;

      const onTouchStart = (e: TouchEvent) => {
        // Do NOT call preventDefault() here — taps must still fire the
        // synthetic click event so handlePaneClick / node-click work on mobile.
        touchStartTimeRef.current = Date.now();
        const touches = e.touches;
        if (touches.length === 1) {
          const t0 = touches[0];
          const vt = vtRef.current;
          touchRef.current = {};
          panRef.current = { sx: t0.clientX, sy: t0.clientY, svx: vt.x, svy: vt.y };
          isPanningRef.current = false;
        } else if (touches.length >= 2) {
          const t0 = touches[0], t1 = touches[1];
          const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          touchRef.current = { pinchDist: dist };
          panRef.current = null;
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        const touches = e.touches;
        if (touches.length === 1 && panRef.current) {
          const t0 = touches[0];
          const p = panRef.current;
          const dx = t0.clientX - p.sx, dy = t0.clientY - p.sy;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isPanningRef.current = true;
          if (isPanningRef.current) {
            e.preventDefault(); // prevent page scroll only once a real pan is detected
            const next = { x: p.svx + dx, y: p.svy + dy, scale: vtRef.current.scale };
            vtRef.current = next;
            setViewTransform(next);
          }
        } else if (touches.length >= 2 && touchRef.current?.pinchDist !== undefined) {
          e.preventDefault(); // always prevent default for pinch
          const t0 = touches[0], t1 = touches[1];
          const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
          const ratio = newDist / touchRef.current.pinchDist;
          const vt = vtRef.current;
          const rect = el.getBoundingClientRect();
          const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
          const my = (t0.clientY + t1.clientY) / 2 - rect.top;
          const ns = Math.max(0.15, Math.min(4, vt.scale * ratio));
          const next = { x: mx - (mx - vt.x) * (ns / vt.scale), y: my - (my - vt.y) * (ns / vt.scale), scale: ns };
          vtRef.current = next;
          setViewTransform(next);
          touchRef.current.pinchDist = newDist;
        }
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length === 0) {
          touchRef.current = null;
          panRef.current = null;
          isPanningRef.current = false;
        } else if (e.touches.length === 1) {
          // Transition from pinch back to single-finger pan
          const t0 = e.touches[0];
          const vt = vtRef.current;
          touchRef.current = {};
          panRef.current = { sx: t0.clientX, sy: t0.clientY, svx: vt.x, svy: vt.y };
          isPanningRef.current = false;
        }
      };

      el.addEventListener("touchstart", onTouchStart, { passive: false });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", onTouchEnd, { passive: false });
      el.addEventListener("touchcancel", onTouchEnd, { passive: false });
      return () => {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
        el.removeEventListener("touchcancel", onTouchEnd);
      };
    }, []);

    // ── Task dot popup ────────────────────────────────────────────────────────
    const [taskPopup, setTaskPopup] = useState<{ task: NodeTask; px: number; py: number } | null>(null);

    useEffect(() => {
      if (!serverState) return;
      setCanvasNodes(buildNodes(serverState.baselinePositions, serverState.customNodes, showImprovements));
    }, [serverState, showImprovements]);

    useEffect(() => {
      Promise.all([
        fetch("/api/workflow").then((r) => r.json()),
        fetch("/api/graph-state").then((r) => r.json()),
      ]).then(([workflow, graphState]) => {
        setServerState({
          ...workflow,
          ...graphState,
          baselinePositions: graphState.baselinePositions ?? workflow.layout?.baselinePositions,
          ecosystemPositions: graphState.ecosystemPositions ?? workflow.layout?.ecosystemPositions ?? {},
        });
        lastPollTs.current = graphState.lastUpdated ?? 0;
      }).catch(console.error);
    }, []);

    useEffect(() => {
      const poll = () => {
        fetch("/api/graph-state").then((r) => r.json()).then((s: WorkflowApiState & { _positionsHash?: string }) => {
          if (s.lastUpdated > lastPollTs.current) {
            lastPollTs.current = s.lastUpdated;
            setServerState((prev) => {
              if (prev && s._positionsHash && (prev as typeof prev & { _positionsHash?: string })._positionsHash === s._positionsHash) {
                return { ...prev, settings: s.settings, customNodes: s.customNodes, customEdges: s.customEdges, lastUpdated: s.lastUpdated, _positionsHash: s._positionsHash } as WorkflowApiState;
              }
              return prev ? { ...prev, ...s } : s;
            });
          }
        }).catch(console.error);
      };
      poll();
      const t = setInterval(poll, 3000);
      return () => clearInterval(t);
    }, []);

    // ── Drag ──────────────────────────────────────────────────────────────────
    const dragRef = useRef<DragState | null>(null);
    const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
    const [addForm, setAddForm] = useState<AddForm | null>(null);
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      const node = canvasNodes.find((n) => n.id === nodeId)!;
      dragRef.current = { nodeId, offsetX: x - node.x, offsetY: y - node.y, hasMoved: false };
    }, [canvasNodes, clientToCanvas]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      if (panRef.current && !dragRef.current) {
        const dx = e.clientX - panRef.current.sx, dy = e.clientY - panRef.current.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isPanningRef.current = true;
        if (isPanningRef.current) {
          const next = { x: panRef.current.svx + dx, y: panRef.current.svy + dy, scale: vtRef.current.scale };
          vtRef.current = next; setViewTransform(next);
        }
        return;
      }
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      if (connectFrom) setMousePos({ x, y });
      const d = dragRef.current;
      if (!d) return;
      const newX = x - d.offsetX, newY = y - d.offsetY;
      d.hasMoved = true;
      setCanvasNodes((ns) => ns.map((n) => n.id === d.nodeId ? { ...n, x: newX, y: newY } : n));
    }, [connectFrom, clientToCanvas]);

    const handleMouseUp = useCallback(() => {
      panRef.current = null;
      const d = dragRef.current;
      if (!d) return;
      if (d.hasMoved) {
        const node = canvasNodes.find((n) => n.id === d.nodeId);
        if (node) {
          fetch("/api/graph-state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updatePosition", view: "baseline", nodeId: node.id, position: { x: node.x, y: node.y } }),
          }).catch(console.error);
        }
      }
      dragRef.current = null;
    }, [canvasNodes]);

    const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-nodeid]")) return;
      e.preventDefault();
      const { x: cx, y: cy } = clientToCanvas(e.clientX, e.clientY);
      setCtxMenu({ type: "canvas", x: e.clientX, y: e.clientY, cx, cy });
    }, [clientToCanvas]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
      e.preventDefault(); e.stopPropagation();
      setCtxMenu({ type: "node", x: e.clientX, y: e.clientY, nodeId });
    }, []);

    const handleAddNodeSubmit = () => {
      if (!addForm || !addForm.label || !addForm.initials) return;
      const id = `custom-${Date.now()}`;
      const clr = ROLE_COLOR[addForm.role] || "#4F46E5";
      const newCn: WorkflowApiState["customNodes"][0] = {
        id, labelInitials: addForm.initials.toUpperCase().slice(0, 3), label: addForm.label,
        nodeType: "neural", role: addForm.role as WorkflowApiState["customNodes"][0]["role"],
        source: "user-added",
        textColor: clr, position: { x: addForm.cx - R, y: addForm.cy - R },
      };
      setServerState((prev) => prev ? { ...prev, customNodes: [...prev.customNodes, newCn], lastUpdated: Date.now() } : prev);
      fetch("/api/graph-state", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addNode", node: newCn }),
      }).catch(console.error);
      setAddForm(null);
    };

    const handleNodeClick = useCallback((e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      if (dragRef.current?.hasMoved) return;
      setCtxMenu(null);
      if (connectFrom) {
        if (connectFrom !== nodeId) {
          const edgeId = `${connectFrom}-${nodeId}`;
          const nextSeq = edges.length > 0 ? Math.max(...edges.map(e => e.sequence || 1)) + 1 : 1;
          const isOpt = window.confirm(
            'Mark this connection as "Optimized Route" (Improvements Only)?\n\nOK = only shown when Improvements mode is ON\nCancel = always shown (standard connection)'
          );
          const newEdge = { id: edgeId, source: connectFrom, target: nodeId, sequence: nextSeq, isCustom: true, isImprovementOnly: isOpt, weight: 1 };
          setServerState((prev) => prev ? { ...prev, customEdges: [...prev.customEdges.filter(e2 => e2.id !== edgeId), newEdge], lastUpdated: Date.now() } : prev);
          fetch("/api/graph-state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "addEdge", edge: newEdge }),
          }).catch(console.error);
        }
        setConnectFrom(null);
        return;
      }
      onSelectNode(nodeId, "node");
    }, [connectFrom, onSelectNode, edges]);

    const handleEdgeClick = useCallback((edgeId: string) => {
      if (dragRef.current?.hasMoved) return;
      setCtxMenu(null); setConnectFrom(null);
      onSelectNode(edgeId, "edge");
    }, [onSelectNode]);

    const handlePaneClick = useCallback(() => {
      if (dragRef.current?.hasMoved) return;
      if (isPanningRef.current) { isPanningRef.current = false; return; }
      setCtxMenu(null); setConnectFrom(null); setTaskPopup(null);
      setHoveredNodeId(null); setHoveredEdgeId(null);
      onDeselect();
    }, [onDeselect]);

    const handleDeleteSelected = useCallback(() => {
      if (!selectedId) return;
      if (selectedType === "node") {
        if (CORE_IDS.has(selectedId)) {
          const newHidden = [...new Set([...(serverState?.settings?.hiddenCoreNodes ?? []), selectedId])];
          setServerState((prev) => prev ? { ...prev, settings: { ...prev.settings, hiddenCoreNodes: newHidden }, lastUpdated: Date.now() } : prev);
          fetch("/api/graph-state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "updateSettings", settings: { hiddenCoreNodes: newHidden } }),
          }).catch(console.error);
        } else {
          onDeleteNode(selectedId);
          setServerState((prev) => prev ? {
            ...prev,
            customNodes: prev.customNodes.filter(n => n.id !== selectedId),
            customEdges: prev.customEdges.filter(e2 => e2.source !== selectedId && e2.target !== selectedId),
            lastUpdated: Date.now(),
          } : prev);
          fetch("/api/graph-state", {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deleteNode", nodeId: selectedId }),
          }).catch(console.error);
        }
      } else if (selectedType === "edge") {
        setServerState((prev) => prev ? { ...prev, customEdges: prev.customEdges.filter(e2 => e2.id !== selectedId), lastUpdated: Date.now() } : prev);
        fetch("/api/graph-state", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deleteEdge", edgeId: selectedId }),
        }).catch(console.error);
        onDeselect();
      }
    }, [selectedId, selectedType, serverState?.settings?.hiddenCoreNodes, onDeleteNode, onDeselect]);

    const handleEscape = useCallback(() => {
      setCtxMenu(null);
      setAddForm(null);
      setConnectFrom(null);
      setTaskPopup(null);
      onDeselect();
    }, [onDeselect]);

    const handleAddNodeShortcut = useCallback(() => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vx = rect.width / 2;
      const vy = rect.height / 2;
      const { x, y } = clientToCanvas(rect.left + vx, rect.top + vy);
      setAddForm({ cx: x, cy: y, label: "", initials: "", role: "person" });
    }, [clientToCanvas]);

    const handleCycleNodes = useCallback(() => {
      if (!nodes.length) return;
      if (!selectedId || selectedType !== "node") {
        onSelectNode(nodes[0].id, "node");
        return;
      }
      const idx = nodes.findIndex(n => n.id === selectedId);
      const nextNode = nodes[(idx + 1) % nodes.length];
      onSelectNode(nextNode.id, "node");
    }, [nodes, selectedId, selectedType, onSelectNode]);

    useKeyboardShortcuts(true, {
      onDeleteSelected: handleDeleteSelected,
      onEscape: handleEscape,
      onAddNode: handleAddNodeShortcut,
      onCycleNodes: handleCycleNodes,
    });

    useImperativeHandle(ref, () => ({
      exportPng: () => downloadSvgAsPng(buildSvgExport(nodes, edges, serverState)),
      exportCsv: () => {
        if (!serverState) return;
        const csv = buildCsvExport(
          canvasNodes, serverState.customNodes, serverState.customEdges,
          serverState.settings || { nodePause: 1, edgeWeightOverrides: {}, nodeDelayOverrides: {} },
          edges,
        );
        downloadBlob(csv, "workflow.csv", "text/csv;charset=utf-8;");
      },
      importCsv: (text: string) => {
        const data = parseCsvImport(text);
        fetch("/api/graph-state", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "importState", ...data }),
        }).then((r) => r.json()).then((res) => {
          if (res.state) {
            const s = res.state as WorkflowApiState;
            setServerState((prev) => prev ? { ...prev, ...s } : s);
            lastPollTs.current = s.lastUpdated;
          }
        }).catch(console.error);
      },
      triggerResetLayout: async () => {
        // 1. Run the layout computation on the server
        await fetch("/api/graph-state", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resetLayout" }),
        }).catch(console.error);
        // 2. Immediately pull fresh positions instead of waiting for the 3-second poll
        const s: WorkflowApiState = await fetch("/api/graph-state").then(r => r.json()).catch(() => null);
        if (s) {
          lastPollTs.current = s.lastUpdated;
          setServerState(prev => prev ? { ...prev, ...s } : s);
        }
        // 3. Fit viewport so all repositioned nodes are visible
        requestAnimationFrame(() => fitAllToView());
      },
      triggerRefresh: async () => {
        const s: WorkflowApiState = await fetch("/api/graph-state").then(r => r.json()).catch(() => null);
        if (s) {
          lastPollTs.current = s.lastUpdated;
          setServerState(prev => prev ? { ...prev, ...s } : s);
        }
      },
    }));

    // ── Degree map for edge thickness ─────────────────────────────────────────
    const nodeDeg: Record<string, number> = {};
    edges.forEach(e => {
      nodeDeg[e.source] = (nodeDeg[e.source] || 0) + 1;
      nodeDeg[e.target] = (nodeDeg[e.target] || 0) + 1;
    });
    const maxNodeDeg = useMemo(() => Math.max(...Object.values(nodeDeg), 1), [nodeDeg]);

    // ── Sequential animation keyframes ────────────────────────────────────────
    const activeEdges = edges.filter(e => !e.isDeprecated);
    const seqMap = new Map<number, number>();
    activeEdges.forEach(e => {
      const s = e.sequence || 1, w = e.weight || 1;
      seqMap.set(s, Math.max(seqMap.get(s) || 1, w));
    });
    const sortedSeqs = Array.from(seqMap.keys()).sort((a, b) => a - b);
    let totalWeight = 0;
    const nodePause = serverState?.settings?.nodePause ?? 1.0;
    const seqTimes: { seq: number; start: number; duration: number }[] = [];
    sortedSeqs.forEach(seq => {
      if (totalWeight > 0) totalWeight += nodePause;
      const w = seqMap.get(seq)!;
      seqTimes.push({ seq, start: totalWeight, duration: w });
      totalWeight += w;
    });
    totalWeight += 3.0;
    const cycleDur = Math.max(4, totalWeight * 1.1);

    const seqStyles = seqTimes.map(({ seq, start, duration }) => {
      const startPct = (start / totalWeight) * 100;
      const endPct = ((start + duration) / totalWeight) * 100;
      return `@keyframes svgflow-${seq} {
        0%                               { stroke-dashoffset: 0.06; opacity: 0; }
        ${Math.max(0, startPct - 0.01)}% { stroke-dashoffset: 0.06; opacity: 0; }
        ${startPct}%                     { stroke-dashoffset: 0.06; opacity: 0.7; }
        ${endPct}%                       { stroke-dashoffset: -1.06; opacity: 0.7; }
        ${Math.min(100, endPct + 0.01)}% { stroke-dashoffset: -1.06; opacity: 0; }
        100%                             { stroke-dashoffset: -1.06; opacity: 0; }
      }`;
    });

    // ── Level-of-Detail thresholds ────────────────────────────────────────────
    // LOD 2 (full)     scale ≥ 0.90 : nodes + edges + task dots + labels
    // LOD 1 (mid)      scale ≥ 0.40 : task dots hidden
    // LOD 0 (abstract) scale <  0.40 : only workflow group regions visible
    const LOD_TASKS = 0.90;
    const LOD_ABSTRACT = 0.40;
    const showTasks = viewTransform.scale >= LOD_TASKS;
    const showNodes = viewTransform.scale >= LOD_ABSTRACT;
    const showLabels = viewTransform.scale >= 0.90;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div
        ref={canvasRef}
        className="w-full h-full relative overflow-hidden select-none"
        style={{ background: "#F8FAFC", cursor: connectFrom ? "crosshair" : "default" }}
        onMouseDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodeid]")) return;
          const vt = vtRef.current;
          panRef.current = { sx: e.clientX, sy: e.clientY, svx: vt.x, svy: vt.y };
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handlePaneClick}
        onContextMenu={handleCanvasContextMenu}
      >
        {/* Blueprint dot background */}
        <div className="absolute inset-0 pointer-events-none opacity-40"
          style={{ backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
        <style dangerouslySetInnerHTML={{
          __html: [
            ...seqStyles,
            `@keyframes proposedGroupPulse {
            0%,100% { opacity: 1; }
            50%     { opacity: 0.55; }
          }`,
          ].join("\n")
        }} />

        {/* ── Pan/zoom transform container ── */}
        <div style={{
          position: "absolute", inset: 0,
          transformOrigin: "0 0",
          transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
          willChange: "transform",
        }}>

          {/* ── SVG layer ─────────────────────────────────────────────────────── */}
          <svg
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: 10, overflow: "visible", pointerEvents: "none" }}
          >
            {/* Workflow group regions — true bounding box of member nodes.
               Non-overlap is guaranteed by groupAwareLayout at position-assignment
               time (AI generation + Reset Layout), not by visual clipping. */}
            {(() => {
              const allGroups = serverState?.settings?.workflowGroups ?? [];
              const PAD = 34;
              const isLOD = viewTransform.scale < 0.50;
              const isAbstract = !showNodes;



              // Bounding box of a set of node IDs (returns null if no positioned members).
              const bbox = (nodeIds: string[]) => {
                const members = nodeIds.map(id => nodeMap[id]).filter(Boolean);
                if (!members.length) return null;
                const xs = members.map(n => n.x + R);
                const ys = members.map(n => n.y + R);
                return {
                  minX: Math.min(...xs) - PAD - R,
                  maxX: Math.max(...xs) + PAD + R,
                  minY: Math.min(...ys) - PAD - R,
                  maxY: Math.max(...ys) + PAD + R,
                  count: members.length,
                };
              };

              // Render parent groups first (background), then subgroups (foreground).
              const topLevel = allGroups.filter(g => !g.parentGroupId);
              const subGroups = allGroups.filter(g => !!g.parentGroupId);

              const renderGroup = (group: typeof allGroups[0], isSubgroup: boolean) => {
                // Use pre-calculated recursive member list for bounding box calculation
                const ids = groupHierarchy.nodesMap[group.id] ?? [];
                const b = bbox(ids);
                if (!b) return null;
                const { minX, maxX, minY, maxY, count } = b;

                // vb0.22: AI-proposed groups get an emerald dashed visual treatment
                const isProposed = showImprovements && proposedGroupIds.includes(group.id);

                const fill = isProposed
                  ? "#10B98120"
                  : isAbstract
                    ? group.color + (isSubgroup ? "38" : "1E")
                    : group.color + (isSubgroup ? "20" : "10");
                const stroke = isProposed
                  ? "#10B981CC"
                  : group.color + (isAbstract
                    ? (isSubgroup ? "DD" : "99")
                    : (isSubgroup ? "88" : "55"));
                const strokeW = isProposed ? 2 : isAbstract ? (isSubgroup ? 2.5 : 3) : isLOD ? 2 : 1.5;
                const dash = isProposed ? "6 4" : isSubgroup ? undefined : (isAbstract ? undefined : "8 4");
                const rx = isSubgroup ? 12 : 18;

                // Center labels for ALL zoom levels (track: 'for all zoom level, make the gourp text appears in the middle')
                const cx = (minX + maxX) / 2;
                const cy = (minY + maxY) / 2;

                const labelX = cx;
                const labelY = cy;

                const labelSize = isAbstract
                  ? (isSubgroup ? 18 : 30)
                  : (isSubgroup ? 14 : 18);

                // Group-level filtering (track: 'grey out the workgroups too')
                const isFiltered = searchQuery.trim() !== "" || activeFilters.roles.length > 0 || activeFilters.groupIds.length > 0;
                let groupOpacity = 1.0;
                if (isFiltered) {
                  const nameMatch = searchQuery.trim() !== "" && group.name.toLowerCase().includes(searchQuery.toLowerCase());
                  const groupSelectMatch = activeFilters.groupIds.includes(group.id);
                  const nodeMatch = ids.some(nid => nodeOpacity(nid) === 1);
                  if (!nameMatch && !groupSelectMatch && !nodeMatch) {
                    groupOpacity = 0.15;
                  }
                }

                // Always show the full name centered. (Track: 'remove the border, fill for the group name text container')
                const labelText = group.name;
                const textColor = isProposed ? "#059669" : group.color;

                return (
                  <g
                    key={group.id}
                    style={{
                      pointerEvents: "none",
                      opacity: groupOpacity,
                      transition: "opacity 0.3s",
                      ...(isProposed ? { animation: "proposedGroupPulse 2s ease-in-out infinite" } : {}),
                    }}
                  >
                    {/* Group region rectangle */}
                    <rect
                      x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                      rx={rx} ry={rx}
                      fill={fill} stroke={stroke}
                      strokeWidth={strokeW} strokeDasharray={dash}
                    />
                    <text
                      x={labelX}
                      y={labelY}
                      fontSize={labelSize}
                      fontWeight={700}
                      fill={textColor}
                      stroke={textColor}
                      strokeWidth={isAbstract ? (isSubgroup ? 0.6 : 0.8) : 0}
                      paintOrder="stroke fill"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ userSelect: "none" }}
                      opacity={isSubgroup ? 0.9 : 1}
                    >
                      {isProposed ? `✦ ${labelText}` : labelText}
                    </text>
                  </g>
                );
              };

              const sortedGroups = [...allGroups].sort((a, b) =>
                (groupHierarchy.depthMap[a.id] ?? 0) - (groupHierarchy.depthMap[b.id] ?? 0)
              );

              return (
                <>
                  {sortedGroups.map(g => renderGroup(g, !!g.parentGroupId))}
                </>
              );
            })()}

            {/* Task dots — orbiting baseline nodes (hidden at LOD_TASKS zoom level) */}
            {showTasks && nodes.map(node => {
              const tasks: NodeTask[] = serverState?.settings?.metadataOverrides?.[node.id]?.tasks ?? [];
              if (!tasks.length) return null;
              const ncx = node.x + R, ncy = node.y + R;
              const taskR = 42;
              return tasks.slice(0, 8).map((task, i) => {
                const angle = (i / Math.min(tasks.length, 8)) * Math.PI * 2 - Math.PI / 2;
                const tx = ncx + taskR * Math.cos(angle);
                const ty = ncy + taskR * Math.sin(angle);
                const color = TASK_STATUS_COLOR[task.status];
                return (
                  <g key={`${node.id}-task-${task.id}`}>
                    <line x1={ncx} y1={ncy} x2={tx} y2={ty} stroke={color} strokeWidth="0.8" opacity="0.25" />
                    <circle
                      cx={tx} cy={ty} r={5} fill={color} stroke="white" strokeWidth="1.5"
                      style={{ cursor: "pointer", pointerEvents: "all", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.2))" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = canvasRef.current!.getBoundingClientRect();
                        const vt = vtRef.current;
                        setTaskPopup({ task, px: rect.left + tx * vt.scale + vt.x, py: rect.top + ty * vt.scale + vt.y });
                      }}
                    />
                    {task.priority === "high" && (
                      <circle cx={tx} cy={ty} r={7.5} fill="none" stroke={color} strokeWidth="1" opacity="0.4" strokeDasharray="3 2" />
                    )}
                  </g>
                );
              });
            })}

            {/* Edges — hidden in abstract LOD */}
            <g style={{ opacity: showNodes ? 1 : 0, transition: "opacity 0.25s" }}>
              {edges.map((edge) => {
                const src = nodeMap[edge.source], tgt = nodeMap[edge.target];
                if (!src || !tgt) return null;

                const x1 = src.x + R, y1 = src.y + R;
                const x2 = tgt.x + R, y2 = tgt.y + R;
                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                const dx = x2 - x1, dy = y2 - y1;
                const len = Math.hypot(dx, dy);
                const curvature = Math.min(len * 0.28, 90);
                const cpx = mx - (dy / Math.max(len, 1)) * curvature;
                const cpy = my + (dx / Math.max(len, 1)) * curvature;
                const d = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;

                const isSelected = selectedId === edge.id && selectedType === "edge";
                const edgeMeta = EDGE_META[edge.id];
                const edgeDisplayName = serverState?.settings?.metadataOverrides?.[edge.id]?.name ?? edgeMeta?.name ?? '';
                const edgeDisplaySummary = serverState?.settings?.metadataOverrides?.[edge.id]?.summary ?? edgeMeta?.summary ?? '';
                const srcDeg = nodeDeg[edge.source] || 0, tgtDeg = nodeDeg[edge.target] || 0;
                const avgDeg = (srcDeg + tgtDeg) / 2;
                const relWeight = edge.weight ?? serverState?.settings?.edgeWeightOverrides?.[edge.id]?.weight ?? 1;
                const degScale = 0.4 + (avgDeg / maxNodeDeg) * 0.6;
                const sw = Math.max(0.6, Math.min(3.0, 1.0 * degScale * relWeight));

                const isHoveredEdge = hoveredEdgeId === edge.id;
                const isConnected = connectedEdgeIds?.has(edge.id) ?? false;
                const anyHover = hoveredNodeId !== null || hoveredEdgeId !== null;

                // ── Opacity: three distinct modes ──
                // 1. Data-flow mode: all edges fully lit
                // 2. Improvements mode: upgraded edges always glow, deprecated fade hard
                // 3. Default: subtle resting opacity, spikes on hover/selection
                const isAlwaysLit = showDataFlow
                  || (showImprovements && edge.isUpgraded);
                const baseOpacity = edge.isDeprecated
                  ? (showImprovements ? 0.06 : 0.10)
                  : isAlwaysLit ? 0.90
                    : highContrast ? 0.80 : 0.30;
                const dimOpacity = showDataFlow ? 0.45 : (highContrast ? 0.25 : 0.05);
                const highlightOpacity = anyHover
                  ? (isHoveredEdge || isConnected ? 1.0 : dimOpacity)
                  : (isSelected ? 1 : baseOpacity);

                const isRedundant = (redundantEdgeIds as string[]).includes(edge.id);
                const strokeColor = isSelected ? "#4F46E5"
                  : isRedundant ? "#F59E0B"
                    : edge.isUpgraded ? "#10B981"
                      : edge.isDeprecated ? "#CBD5E1"
                        : showDataFlow ? "#6366F1"
                          : "#94A3B8";
                const pulseColor = edge.isUpgraded ? "#10B981" : "#4F46E5";

                // Flow animation: always in data-flow mode or for upgraded edges in improvements mode
                const showFlowPulse = !edge.isDeprecated && (
                  isAlwaysLit || isHoveredEdge || isConnected || isSelected
                );

                return (
                  <g key={edge.id} style={{ opacity: highlightOpacity, transition: "opacity 0.18s" }}>
                    <path
                      d={d} pathLength="1"
                      stroke={strokeColor}
                      strokeWidth={isSelected || isHoveredEdge ? sw + 2 : isAlwaysLit ? sw + 0.8 : sw}
                      fill="none"
                      strokeDasharray={edge.isDeprecated ? "0.04 0.04" : undefined}
                      style={{
                        filter: isRedundant
                          ? "drop-shadow(0 0 6px rgba(245,158,11,0.75))"
                          : isSelected ? "drop-shadow(0 0 4px rgba(79,70,229,0.6))"
                            : isHoveredEdge ? "drop-shadow(0 0 6px rgba(99,102,241,0.7))"
                              : isConnected ? "drop-shadow(0 0 3px rgba(99,102,241,0.4))"
                                : (showImprovements && edge.isUpgraded) ? "drop-shadow(0 0 5px rgba(16,185,129,0.55))"
                                  : showDataFlow ? "drop-shadow(0 0 3px rgba(99,102,241,0.25))"
                                    : undefined,
                        transition: "stroke 0.2s, stroke-width 0.15s",
                      }}
                    />
                    {showFlowPulse && (
                      <path d={d} pathLength="1" stroke={pulseColor}
                        strokeWidth={isAlwaysLit ? sw + 1.5 : sw + 1.0}
                        fill="none"
                        strokeDasharray="0.06 1"
                        style={{ animation: `svgflow-${edge.sequence || 1} ${cycleDur}s linear infinite` }}
                      />
                    )}
                    {/* Arrow head */}
                    <defs>
                      <marker id={`arr-${edge.id}`} markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto">
                        <path d="M0,0 L0,5 L7,2.5 z" fill={strokeColor} opacity={edge.isDeprecated ? 0.3 : 0.6} />
                      </marker>
                    </defs>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={0}
                      markerEnd={`url(#arr-${edge.id})`}
                      style={{ pointerEvents: "none" }} />
                    {/* Wide invisible hit area */}
                    <path d={d} stroke="transparent" strokeWidth={22} fill="none"
                      style={{ cursor: edge.isDeprecated ? "default" : "pointer", pointerEvents: edge.isDeprecated ? "none" : "stroke" }}
                      onClick={(e) => { e.stopPropagation(); if (!edge.isDeprecated) handleEdgeClick(edge.id); }}
                      onMouseEnter={() => { setHoveredEdgeId(edge.id); if (edgeDisplayName) onHover(edgeDisplayName, edgeDisplaySummary); }}
                      onMouseLeave={() => { setHoveredEdgeId(null); onHoverEnd(); }}
                    />
                  </g>
                );
              })}
            </g>

            {/* AI-suggested connection arcs — dashed emerald, only in Optimised Workflow mode */}
            {showNodes && showImprovements && suggestedConnectionPairs.length > 0 && suggestedConnectionPairs.map((pair) => {
              const src = nodeMap[pair.sourceId], tgt = nodeMap[pair.targetId];
              if (!src || !tgt) return null;
              const x1 = src.x + R, y1 = src.y + R;
              const x2 = tgt.x + R, y2 = tgt.y + R;
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.hypot(dx, dy);
              const curvature = Math.min(len * 0.28, 90);
              const cpx = mx - (dy / Math.max(len, 1)) * curvature;
              const cpy = my + (dx / Math.max(len, 1)) * curvature;
              const d = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
              return (
                <path
                  key={`${pair.sourceId}-${pair.targetId}-suggested`}
                  d={d} fill="none"
                  stroke="#10B981" strokeWidth={2.5} strokeDasharray="9 5" opacity={0.8}
                  style={{ filter: "drop-shadow(0 0 5px rgba(16,185,129,0.65))", pointerEvents: "none" }}
                />
              );
            })}

            {/* Connect mode rubber band */}
            {showNodes && connectFrom && (() => {
              const src = nodeMap[connectFrom];
              if (!src) return null;
              return (
                <line x1={src.x + R} y1={src.y + R} x2={mousePos.x} y2={mousePos.y}
                  stroke="#F59E0B" strokeWidth={2} strokeDasharray="8 4" opacity={0.7}
                  style={{ pointerEvents: "none" }} />
              );
            })()}
          </svg>

          {/* ── Node layer ────────────────────────────────────────── */}
          {nodes.map((node) => {
            const isDep = node.isDeprecated;
            // Amber bottleneck highlight — only active in Optimised Workflow view (showImprovements).
            // In Current Workflow view the glow is suppressed so the canvas reads as neutral.
            const isBotl = showImprovements && (node.bottleneck || bottleneckNodeIds.includes(node.id)) && !isDep;
            const isSelected = selectedId === node.id && selectedType === "node";
            const isConnSrc = connectFrom === node.id;
            const nodeMeta = NODE_META[node.id];
            const nodeDisplayName = serverState?.settings?.metadataOverrides?.[node.id]?.name ?? nodeMeta?.name ?? node.label;
            const nodeDisplaySummary = serverState?.settings?.metadataOverrides?.[node.id]?.summary ?? nodeMeta?.summary ?? '';
            const opacity = nodeOpacity(node.id);
            const highlight = isNodeHighlighted(node.id);

            return (
              <div
                key={node.id}
                role="button"
                aria-label={`${nodeDisplayName} — ${node.role}`}
                tabIndex={0}
                data-nodeid={node.id}
                style={{
                  position: "absolute", left: node.x, top: node.y,
                  width: SZ, height: SZ,
                  background: "white",
                  borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: highContrast ? 800 : 700, fontSize: 14,
                  border: `${highContrast ? 4 : 2}px solid ${node.borderColor}`,
                  color: node.textColor,
                  textShadow: highContrast ? "0px 1px 2px rgba(0,0,0,0.5)" : undefined,
                  boxShadow: isBotl
                    ? "0 0 0 3px rgba(245,158,11,0.35), 0 4px 6px -1px rgba(0,0,0,0.1)"
                    : highlight
                      ? "0 0 0 3px rgba(99,102,241,0.4), 0 4px 6px -1px rgba(0,0,0,0.1)"
                      : "0 4px 6px -1px rgba(0,0,0,0.1)",
                  zIndex: 20,
                  opacity: !showNodes ? 0 : (isDep ? Math.min(0.3, opacity) : opacity),
                  pointerEvents: !showNodes ? "none" : undefined,
                  cursor: dragRef.current?.nodeId === node.id ? "grabbing" : (connectFrom ? "pointer" : "grab"),
                  userSelect: "none",
                  transition: "border-color 0.5s, opacity 0.3s, box-shadow 0.3s",
                  outline: isSelected ? `3px solid #818CF8` : isConnSrc ? "3px dashed #F59E0B" : "none",
                  outlineOffset: "3px",
                }}
                className={isBotl ? "bottleneck-glow" : ""}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onClick={(e) => handleNodeClick(e, node.id)}
                onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
                onMouseEnter={() => { setHoveredNodeId(node.id); if (nodeDisplayName) onHover(nodeDisplayName, nodeDisplaySummary); }}
                onMouseLeave={() => { setHoveredNodeId(null); onHoverEnd(); }}
              >
                {node.initials}
                {/* Node label */}
                <div style={{
                  position: "absolute", top: 65, whiteSpace: "nowrap",
                  background: node.labelBg, padding: "4px 10px",
                  borderRadius: "20px", fontSize: 11, fontWeight: 600,
                  color: node.labelTextColor || "#334155",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                  border: `1px solid ${node.labelBorderColor}`,
                  textAlign: "center", pointerEvents: "none",
                  opacity: showLabels ? 1 : 0, transition: "opacity 0.2s",
                }}>
                  {node.label}
                  {node.subcategory && !isDep && (
                    <div style={{ fontSize: 9, fontWeight: 400, color: "#F59E0B", marginTop: 1 }}>{node.subcategory}</div>
                  )}
                  {node.bottleneckText && !isDep && (
                    <div style={{ fontSize: 9, color: "#F59E0B", marginTop: 1 }}>{node.bottleneckText}</div>
                  )}
                </div>
              </div>
            );
          })}

        </div>{/* end transform container */}

        {/* ── Task dot popup ── */}
        {taskPopup && (
          <div className="fixed z-[500] pointer-events-auto"
            style={{ left: taskPopup.px + 14, top: taskPopup.py - 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-64" style={{ backdropFilter: "blur(12px)" }}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: TASK_STATUS_COLOR[taskPopup.task.status] }} />
                  <span className="font-semibold text-slate-800 text-sm leading-tight truncate">{taskPopup.task.title}</span>
                </div>
                <button onClick={() => setTaskPopup(null)} className="text-slate-400 hover:text-slate-600 text-base leading-none flex-shrink-0 mt-0.5">×</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: TASK_STATUS_COLOR[taskPopup.task.status] + "20", color: TASK_STATUS_COLOR[taskPopup.task.status] }}>
                  {taskPopup.task.status.replace("-", " ")}
                </span>
                <span className={["text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                  taskPopup.task.priority === "high" ? "bg-red-100 text-red-600"
                    : taskPopup.task.priority === "medium" ? "bg-amber-100 text-amber-600"
                      : "bg-slate-100 text-slate-500"].join(" ")}>
                  {TASK_PRIORITY_LABEL[taskPopup.task.priority]}
                </span>
              </div>
              {taskPopup.task.dueDate && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-2.5">
                  <span>📅</span><span>{t('graphCanvas.task.due')} <strong>{taskPopup.task.dueDate}</strong></span>
                </div>
              )}
              {taskPopup.task.note && (
                <div className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2.5 leading-relaxed border border-slate-100 whitespace-pre-wrap">{taskPopup.task.note}</div>
              )}
            </div>
          </div>
        )}

        {/* ── Context menu ── */}
        {ctxMenu && (
          <div className="fixed bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[180px] text-sm"
            style={{ top: ctxMenu.y, left: ctxMenu.x, zIndex: 200 }}
            onMouseLeave={() => setCtxMenu(null)}
            onClick={(e) => e.stopPropagation()}
          >
            {ctxMenu.type === "canvas" && (
              <>
                <button className="w-full text-left px-4 py-2 hover:bg-indigo-50 hover:text-indigo-600 font-medium flex items-center gap-2 transition-colors"
                  onClick={() => { setAddForm({ cx: ctxMenu.cx, cy: ctxMenu.cy, label: "", initials: "", role: "person" }); setCtxMenu(null); }}>
                  <span className="text-indigo-500 font-bold">+</span> {t('graphCanvas.contextMenu.addNodeHere')}
                </button>
                <button className="w-full text-left px-4 py-2 hover:bg-violet-50 hover:text-violet-600 font-medium flex items-center gap-2 transition-colors"
                  onClick={() => {
                    const groupColors = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"];
                    const id = `group-${Date.now()}`;
                    const color = groupColors[(serverState?.settings?.workflowGroups?.length ?? 0) % groupColors.length];
                    const newGroup = { id, name: t('sidebar.groups.newGroup'), color, nodeIds: [] };
                    setServerState((prev) => prev ? { ...prev, settings: { ...prev.settings, workflowGroups: [...(prev.settings?.workflowGroups ?? []), newGroup] }, lastUpdated: Date.now() } : prev);
                    fetch("/api/graph-state", {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "upsertWorkflowGroup", group: newGroup })
                    }).catch(console.error);
                    setCtxMenu(null);
                  }}>
                  <span className="text-violet-500">⬡</span> {t('graphCanvas.contextMenu.createGroup')}
                </button>
              </>
            )}
            {ctxMenu.type === "node" && (
              <>
                <button className="w-full text-left px-4 py-2 hover:bg-indigo-50 hover:text-indigo-600 font-medium flex items-center gap-2 transition-colors"
                  onClick={() => { setConnectFrom(ctxMenu.nodeId); setCtxMenu(null); }}>
                  <span className="text-indigo-500">↗</span> {t('graphCanvas.contextMenu.connectFrom')}
                </button>
                {(serverState?.settings?.workflowGroups ?? []).length > 0 && (
                  <div className="relative group/grp">
                    <button className="w-full text-left px-4 py-2 hover:bg-violet-50 hover:text-violet-600 font-medium flex items-center justify-between gap-2 transition-colors">
                      <span><span className="text-violet-400">⬡</span> {t('graphCanvas.contextMenu.addToGroup')}</span>
                      <span className="text-slate-300 text-xs">›</span>
                    </button>
                    <div className="absolute left-full top-0 hidden group-hover/grp:block bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[160px] z-[300]">
                      {(serverState?.settings?.workflowGroups ?? []).map((g) => {
                        const already = g.nodeIds.includes(ctxMenu.nodeId);
                        return (
                          <button key={g.id} className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm flex items-center gap-2"
                            onClick={() => {
                              const updated = { ...g, nodeIds: already ? g.nodeIds.filter((nid) => nid !== ctxMenu.nodeId) : [...new Set([...g.nodeIds, ctxMenu.nodeId])] };
                              setServerState((prev) => {
                                if (!prev) return prev;
                                return { ...prev, settings: { ...prev.settings, workflowGroups: (prev.settings?.workflowGroups ?? []).map((x) => x.id === g.id ? updated : x) }, lastUpdated: Date.now() };
                              });
                              fetch("/api/graph-state", {
                                method: "PUT", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "upsertWorkflowGroup", group: updated })
                              }).catch(console.error);
                              setCtxMenu(null);
                            }}
                          >
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, display: "inline-block", flexShrink: 0 }} />
                            <span className="truncate">{g.name}</span>
                            {already && <span className="ml-auto text-slate-400 text-[10px]">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button className="w-full text-left px-4 py-2 hover:bg-red-50 hover:text-red-600 font-medium flex items-center gap-2 transition-colors border-t border-gray-100 mt-1"
                  onClick={() => {
                    const id = ctxMenu.nodeId;
                    if (CORE_IDS.has(id)) {
                      const newHidden = [...new Set([...(serverState?.settings?.hiddenCoreNodes ?? []), id])];
                      setServerState((prev) => prev ? { ...prev, settings: { ...prev.settings, hiddenCoreNodes: newHidden }, lastUpdated: Date.now() } : prev);
                      fetch("/api/graph-state", {
                        method: "PUT", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "updateSettings", settings: { hiddenCoreNodes: newHidden } })
                      }).catch(console.error);
                    } else {
                      onDeleteNode(id);
                      setServerState((prev) => prev ? {
                        ...prev,
                        customNodes: prev.customNodes.filter(n => n.id !== id),
                        customEdges: prev.customEdges.filter(e2 => e2.source !== id && e2.target !== id),
                        lastUpdated: Date.now()
                      } : prev);
                      fetch("/api/graph-state", {
                        method: "PUT", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "deleteNode", nodeId: id })
                      }).catch(console.error);
                    }
                    setCtxMenu(null);
                  }}>
                  <span className="text-red-400">×</span> {t('graphCanvas.contextMenu.deleteNode')}
                </button>
              </>
            )}
            <div className="border-t border-gray-100 mt-1 px-4 py-1.5 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
              {ctxMenu.type === "node" ? t('graphCanvas.contextMenu.labelNode') : t('graphCanvas.contextMenu.labelCanvas')}
            </div>
          </div>
        )}

        {/* ── Connect mode banner ── */}
        {connectFrom && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-4 py-2 rounded-full shadow flex items-center gap-2">
            <span>{t('graphCanvas.connectBanner')}</span>
            <button onClick={() => setConnectFrom(null)} className="ml-1 text-amber-500 hover:text-amber-700 font-bold">✕</button>
          </div>
        )}

        {/* ── Add Node Modal ── */}
        {addForm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/20 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setAddForm(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 border border-gray-200">
              <h3 className="font-bold text-gray-900 mb-4">{t('graphCanvas.addNode.title')}</h3>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">{t('graphCanvas.addNode.displayName')}</label>
                  <input autoFocus type="text" value={addForm.label} onChange={(e) => setAddForm(f => f ? { ...f, label: e.target.value } : f)}
                    placeholder={t('graphCanvas.addNode.displayName.placeholder')} onKeyDown={(e) => e.key === "Enter" && handleAddNodeSubmit()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">{t('graphCanvas.addNode.initials')}</label>
                  <input type="text" maxLength={3} value={addForm.initials} onChange={(e) => setAddForm(f => f ? { ...f, initials: e.target.value } : f)}
                    placeholder={t('graphCanvas.addNode.initials.placeholder')} onKeyDown={(e) => e.key === "Enter" && handleAddNodeSubmit()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">{t('graphCanvas.addNode.roleType')}</label>
                  <select value={addForm.role} onChange={(e) => setAddForm(f => f ? { ...f, role: e.target.value as AddForm["role"] } : f)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 bg-white">
                    <option value="person">{t('graphCanvas.addNode.role.person')}</option>
                    <option value="tool">{t('graphCanvas.addNode.role.tool')}</option>
                    <option value="external">{t('graphCanvas.addNode.role.external')}</option>
                    <option value="output">{t('graphCanvas.addNode.role.output')}</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={handleAddNodeSubmit} disabled={!addForm.label || !addForm.initials}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                  {t('graphCanvas.addNode.submit')}
                </button>
                <button onClick={() => setAddForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm text-gray-600 font-medium">
                  {t('graphCanvas.addNode.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edge / Node Param Editor (floating panel) ── */}
        {selectedId && selectedType && (() => {
          const edge = selectedType === "edge" ? edges.find(e => e.id === selectedId) : null;
          const node = selectedType === "node" ? nodes.find(n => n.id === selectedId) : null;
          if (!edge && !node) return null;

          const saveEdge = (seq: number, wt: number) => {
            setServerState(prev => {
              if (!prev) return prev;
              const newOverrides = { ...(prev.settings?.edgeWeightOverrides || {}) };
              newOverrides[selectedId] = { sequence: seq, weight: wt };
              return { ...prev, settings: { ...prev.settings, edgeWeightOverrides: newOverrides }, lastUpdated: Date.now() };
            });
            fetch("/api/graph-state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateEdgeParams", edgeId: selectedId, sequence: seq, weight: wt }),
            }).catch(console.error);
          };

          const saveNodeDelay = (delay: number) => {
            setServerState(prev => {
              if (!prev) return prev;
              const newDelays = { ...(prev.settings?.nodeDelayOverrides || {}) };
              newDelays[selectedId] = delay;
              return { ...prev, settings: { ...prev.settings, nodeDelayOverrides: newDelays }, lastUpdated: Date.now() };
            });
            fetch("/api/graph-state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateNodeDelay", nodeId: selectedId, delay }),
            }).catch(console.error);
          };

          const saveNodePause = (pause: number) => {
            setServerState(prev => prev ? { ...prev, settings: { ...prev.settings, nodePause: pause }, lastUpdated: Date.now() } : prev);
            fetch("/api/graph-state", {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "updateSettings", settings: { nodePause: pause } }),
            }).catch(console.error);
          };

          return (
            <div className="absolute bottom-24 left-6 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 w-72" style={{ backdropFilter: "blur(8px)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-xs text-slate-500 uppercase tracking-widest">
                  {edge ? t('graphCanvas.params.edgeParams') : t('graphCanvas.params.nodeDelay')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono">{selectedId}</div>
              </div>
              {edge && (() => {
                const overrides = serverState?.settings?.edgeWeightOverrides?.[selectedId];
                const curSeq = overrides?.sequence ?? edge.sequence ?? 1;
                const curWt = overrides?.weight ?? edge.weight ?? 1;
                return (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">{t('graphCanvas.params.seqOrder')}</span>
                      <span className="text-[10px] text-slate-400">{t('graphCanvas.params.seqOrder.hint')}</span>
                      <input type="number" min={1} max={20} step={1} defaultValue={curSeq}
                        onChange={e => saveEdge(parseInt(e.target.value) || 1, curWt)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">{t('graphCanvas.params.procWeight')}</span>
                      <span className="text-[10px] text-slate-400">{t('graphCanvas.params.procWeight.hint')}</span>
                      <input type="number" min={0.1} max={20} step={0.1} defaultValue={curWt}
                        onChange={e => saveEdge(curSeq, parseFloat(e.target.value) || 1)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                      <span className="text-[11px] font-semibold text-slate-500">{t('graphCanvas.params.globalPause')}</span>
                      <span className="text-[10px] text-slate-400">{t('graphCanvas.params.globalPause.hint')}</span>
                      <input type="number" min={0} max={10} step={0.5} defaultValue={serverState?.settings?.nodePause ?? 1}
                        onChange={e => saveNodePause(parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                  </div>
                );
              })()}
              {node && (() => {
                const curDelay = serverState?.settings?.nodeDelayOverrides?.[selectedId] ?? 1;
                return (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-slate-500">{t('graphCanvas.params.outputDelay')}</span>
                      <span className="text-[10px] text-slate-400">{t('graphCanvas.params.outputDelay.hint')}</span>
                      <input type="number" min={0} max={20} step={0.5} defaultValue={curDelay}
                        onChange={e => saveNodeDelay(parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                    <label className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                      <span className="text-[11px] font-semibold text-slate-500">{t('graphCanvas.params.globalPause')}</span>
                      <span className="text-[10px] text-slate-400">{t('graphCanvas.params.globalPause.hint')}</span>
                      <input type="number" min={0} max={10} step={0.5} defaultValue={serverState?.settings?.nodePause ?? 1}
                        onChange={e => saveNodePause(parseFloat(e.target.value) || 0)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400 w-full" />
                    </label>
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </div>
    );
  }
);
