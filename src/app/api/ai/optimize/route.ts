import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/aiClient';
import { NODE_DATA, EDGE_DATA } from '@/lib/constants';

const SYSTEM_PROMPT = `You are a workflow optimization expert specializing in business process improvement and operational efficiency.

Analyze the provided workflow graph and return ONLY a valid JSON object with this exact structure:

{
  "analysis": "## Workflow Summary\\n- ...\\n\\n## Bottlenecks Identified\\n- ...\\n\\n## Constraint Analysis\\n- ...\\n\\n## Quick Wins\\n- ...",
  "suggestedConnections": [
    {
      "sourceId": "existing_node_id",
      "sourceName": "Source Node Name",
      "targetId": "existing_node_id",
      "targetName": "Target Node Name",
      "connectionName": "Short label for this connection",
      "connectionType": "optimised",
      "reason": "One sentence explaining why this connection improves the workflow.",
      "cascadeEffects": [
        {
          "id": "effect_1",
          "type": "stable",
          "description": "Explanation of cascading impact (or lack thereof)",
          "depth": 1
        }
      ]
    }
  ],
  "suggestedRemovals": [
    {
      "type": "node",
      "id": "existing_node_id",
      "name": "Entity Name",
      "action": "remove|automate|merge",
      "reason": "One sentence explaining why this entity should be removed, automated, or merged.",
      "fishboneBones": [
        {
          "category": "Process",
          "cause": "Specific root cause for this bottleneck/redundancy"
        }
      ]
    }
  ]
}

Rules for the analysis field:
- Use \\n for line breaks inside the JSON string
- Include these sections: ## Workflow Summary, ## Bottlenecks Identified, ## Constraint Analysis, ## Quick Wins
- Each section is 2-5 bullet points using "- " prefix
- Base all observations on the ACTUAL nodes, edges, groups, and metadata provided — do not invent entities
- Be specific: reference real node names and real connections

Rules for suggestedConnections:
- Propose 1-3 new directed connections that would optimise the workflow
- connectionType is always "optimised"
- Only reference node IDs that actually exist in the workflow data provided
- cascadeEffects: Recursively predict if this connection orphans existing nodes or creates new bottlenecks. Output "stable" if none. depth starts at 1.
- If no useful connections can be suggested, return an empty array []

Rules for suggestedRemovals:
- Propose 0-3 entities (nodes) that are redundant, automatable, or could be merged
- action: "remove" = delete entirely, "automate" = replace human with tool, "merge" = fold into another node
- fishboneBones: Provide Ishikawa (Fishbone) root cause analysis for the removal, choosing from "People", "Process", "Technology", or "Environment".
- Only reference node IDs that actually exist in the workflow data provided
- If no removals are warranted, return an empty array []

Output ONLY the JSON object — no markdown fences, no extra text`;

const PASS2_PROMPT = `You are a workflow validation AI.
A suggested change is being applied to the workflow. You must evaluate if this change breaks the workflow.
Specifically, does this new connection orphan any existing nodes? Does it bypass a necessary bottleneck in a dangerous way?
Return ONLY a JSON array of cascading effects describing the impact:

[
  {
    "id": "affected_node_id",
    "type": "orphan" | "bottleneck" | "stable",
    "description": "Explanation of why it is orphaned, bottlenecked, or stable.",
    "depth": 1
  }
]

If the change is perfectly safe, return a single array item with type "stable" and id "none". Output ONLY the JSON array — no markdown fences, no extra text.`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { workflowData, apiKey, provider = 'anthropic', model, baseUrl } = await req.json() as {
      workflowData: Record<string, unknown>;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
    };

    if (!apiKey?.trim())    return NextResponse.json({ error: 'API key is required.'      }, { status: 400 });
    if (!workflowData)      return NextResponse.json({ error: 'Workflow data is required.' }, { status: 400 });

    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    '',
      };
      return defaults[provider] ?? '';
    })();

    if (!resolvedModel) {
      return NextResponse.json(
        { error: provider === 'doubao'
            ? 'No Doubao endpoint ID configured. Add your endpoint ID (ep-…) in AI Settings.'
            : 'No model configured for this provider.' },
        { status: 400 }
      );
    }

    const settings = (workflowData.settings ?? {}) as {
      metadataOverrides?: Record<string, { name?: string; role?: string; summary?: string; constraints?: string; connections?: string[]; processes?: string[] }>;
      hiddenCoreNodes?: string[];
      workflowGroups?: Array<{ id: string; name: string; nodeIds: string[] }>;
    };
    const metadataOverrides = settings.metadataOverrides ?? {};
    const hiddenCoreSet     = new Set<string>(settings.hiddenCoreNodes ?? []);
    const groups            = settings.workflowGroups ?? [];

    // Build a per-node group-membership lookup (by display name)
    const nodeGroupNames: Record<string, string[]> = {};
    groups.forEach(g => {
      g.nodeIds.forEach(nid => {
        if (!nodeGroupNames[nid]) nodeGroupNames[nid] = [];
        nodeGroupNames[nid].push(g.name);
      });
    });

    // Core nodes (excluding hidden ones)
    const coreNodes = Object.entries(NODE_DATA)
      .filter(([id]) => !hiddenCoreSet.has(id))
      .map(([id, n]) => {
        const meta = metadataOverrides[id] ?? {};
        return {
          id,
          name:        meta.name        ?? n.name,
          role:        meta.role        ?? n.role,
          summary:     meta.summary     ?? n.summary,
          ...(meta.constraints              ? { constraints: meta.constraints }          : {}),
          ...(meta.connections?.length      ? { connections: meta.connections }          : { connections: n.connections }),
          ...(nodeGroupNames[id]?.length    ? { groups: nodeGroupNames[id] }             : {}),
        };
      });

    // Custom nodes (AI-generated / user-added)
    const customNodes = ((workflowData.customNodes ?? []) as Array<{ id: string; label: string; role: string }>)
      .map(n => {
        const meta = metadataOverrides[n.id] ?? {};
        return {
          id:      n.id,
          name:    meta.name    ?? n.label,
          role:    meta.role    ?? n.role,
          summary: meta.summary ?? '',
          ...(meta.constraints           ? { constraints: meta.constraints }       : {}),
          ...(meta.connections?.length   ? { connections: meta.connections }       : {}),
          ...(nodeGroupNames[n.id]?.length ? { groups: nodeGroupNames[n.id] }     : {}),
        };
      });

    // Build name lookup for edge labelling
    const nameLookup: Record<string, string> = {};
    [...coreNodes, ...customNodes].forEach(n => { nameLookup[n.id] = n.name; });

    // Core edges (exclude edges where both endpoints are hidden)
    const coreEdges = Object.entries(EDGE_DATA)
      .filter(([id]) => {
        const hyphen = id.indexOf('-');
        if (hyphen === -1) return true;
        const src = id.slice(0, hyphen);
        const tgt = id.slice(hyphen + 1);
        return !(hiddenCoreSet.has(src) && hiddenCoreSet.has(tgt));
      })
      .map(([id, e]) => {
        const meta = metadataOverrides[id] ?? {};
        const hyphen = id.indexOf('-');
        const src = hyphen !== -1 ? id.slice(0, hyphen) : id;
        const tgt = hyphen !== -1 ? id.slice(hyphen + 1) : '';
        return {
          id,
          name:       meta.name ?? e.name,
          sourceName: nameLookup[src] ?? src,
          targetName: nameLookup[tgt] ?? tgt,
          summary:    e.summary,
        };
      });

    // Custom edges (skip improvement-only ones — they are already optimisations)
    const customEdges = ((workflowData.customEdges ?? []) as Array<{ id: string; source: string; target: string; isImprovementOnly?: boolean; name?: string }>)
      .filter(e => !e.isImprovementOnly)
      .map(e => {
        const meta = metadataOverrides[e.id] ?? {};
        return {
          id:         e.id,
          name:       meta.name ?? e.name ?? '',
          sourceName: nameLookup[e.source] ?? e.source,
          targetName: nameLookup[e.target] ?? e.target,
        };
      });

    // Group summary
    const groupSummary = groups.map(g => ({
      name:    g.name,
      members: g.nodeIds.map(id => nameLookup[id] ?? id),
    }));

    const workflowSnapshot = JSON.stringify(
      { coreNodes, coreEdges, customNodes, customEdges, groups: groupSummary },
      null, 2
    );

    const rawText = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage:  `Analyze this workflow and provide optimization recommendations:\n\n${workflowSnapshot}`,
      maxTokens:    2000,
      baseUrl:      baseUrl || undefined,
    });

    let analysis: string;
    let suggestedConnections: any[] = [];
    let suggestedRemovals: any[] = [];

    try {
      const parsed = JSON.parse(stripFences(rawText)) as {
        analysis?: string;
        suggestedConnections?: any[];
        suggestedRemovals?: any[];
      };
      analysis             = parsed.analysis ?? rawText;
      suggestedConnections = Array.isArray(parsed.suggestedConnections) ? parsed.suggestedConnections : [];
      suggestedRemovals    = Array.isArray(parsed.suggestedRemovals)    ? parsed.suggestedRemovals    : [];
    } catch {
      analysis = rawText;
    }

    // Pass 2: Recursive Cascading Validation (Depth 1)
    if (suggestedConnections.length > 0) {
      const validationPromises = suggestedConnections.map(async (conn) => {
        try {
          // Apply Delta
          const tempEdges = [...coreEdges, ...customEdges, {
            id: `temp_${conn.sourceId}_${conn.targetId}`,
            sourceName: nameLookup[conn.sourceId] ?? conn.sourceId,
            targetName: nameLookup[conn.targetId] ?? conn.targetId,
          }];
          const modifiedSnapshot = JSON.stringify({
            coreNodes, coreEdges: tempEdges, customNodes, groups: groupSummary
          }, null, 2);

          const pass2Text = await generateText({
            provider,
            model: resolvedModel,
            apiKey,
            systemPrompt: PASS2_PROMPT,
            userMessage: `Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName}'.\n\nWorkflow:\n${modifiedSnapshot}`,
            maxTokens: 1000,
            baseUrl: baseUrl || undefined,
          });

          const effects = JSON.parse(stripFences(pass2Text));
          if (Array.isArray(effects)) {
            conn.cascadeEffects = effects;
          } else {
            conn.cascadeEffects = [{ id: `fb_${Date.now()}`, type: "stable", description: "Safe to apply", depth: 1 }];
          }
        } catch {
          conn.cascadeEffects = [{ id: `fb_${Date.now()}`, type: "stable", description: "Could not evaluate cascade", depth: 1 }];
        }
      });
      await Promise.all(validationPromises);
    }

    return NextResponse.json({ analysis, suggestedConnections, suggestedRemovals });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isAuthError =
      message.includes('401') ||
      message.includes('invalid_api_key') ||
      message.includes('API_KEY') ||
      message.includes('AuthenticationError') ||
      message.includes('Unauthorized') ||
      message.toLowerCase().includes('authentication');
    if (isAuthError) {
      return NextResponse.json({ error: 'Invalid API key. Please check your key in AI Settings.' }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
