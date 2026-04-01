import { NextRequest, NextResponse } from 'next/server';
import { generateText, streamText, type AIProvider } from '@/lib/aiClient';
import { classifyAIError } from '@/lib/aiErrors';
import { OptimizeResponseSchema } from '@/lib/aiSchemas';
import { buildOptimizeSnapshot } from '@/lib/snapshotBuilder';
import { compressSnapshot, estimateTokens, SAFE_INPUT_THRESHOLD } from '@/lib/contextCompressor';
import { jsonrepair } from 'jsonrepair';
import { runDistributedOptimize } from '@/lib/agents/distributedOptimize';
import type { ServerGraphState } from '@/lib/serverState';
import type { AIEngineMode } from '@/contexts/AIEngineContext';
import { JACK_ROUTINE_DEMO_ANALYSIS, JACK_ROUTINE_DEMO_ANALYSIS_ZH } from '@/lib/demoAnalysis';

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
  "suggestedEdgeRemovals": [
    {
      "edgeId": "existing_edge_id",
      "sourceName": "Source Node Name",
      "targetName": "Target Node Name",
      "reason": "One sentence explaining why this edge is now redundant or harmful.",
      "prerequisiteConnectionId": "optional_source-target_key_if_must_add_first"
    }
  ],
  "suggestedRemovals": [
    {
      "type": "node",
      "id": "existing_node_id",
      "name": "Entity Name",
      "action": "remove|automate|merge",
      "reason": "One sentence explaining why this entity should be removed, automated, or merged.",
      "mergeTargetId": "existing_node_id_to_merge_into_if_action_is_merge",
      "fishboneBones": [
        {
          "category": "Process",
          "cause": "Specific root cause for this bottleneck/redundancy",
          "resolvedBy": {
            "type": "connection",
            "refId": "sourceId-targetId key of the suggestedConnection that fixes this cause"
          }
        }
      ]
    }
  ],
  "suggestedNewNodes": [
    {
      "tempId": "new_node_1",
      "label": "Node Display Name",
      "role": "tool",
      "summary": "What this node does in one sentence",
      "connectFrom": ["existing_node_id"],
      "connectTo": ["existing_node_id"],
      "replacesNodeId": "existing_node_id_this_replaces_optional"
    }
  ],
  "suggestedTaskUpdates": [
    {
      "nodeId": "existing_node_id",
      "nodeName": "Node Display Name",
      "addTasks": [
        { "id": "t_new_1", "title": "Task description", "status": "todo", "priority": "medium" }
      ],
      "removeTasks": ["existing_task_id_to_remove"],
      "reason": "One sentence explaining the task redistribution."
    }
  ],
  "suggestedGroupUpdates": [
    {
      "action": "create",
      "tempId": "grp_new_1",
      "name": "Proposed Group Name",
      "color": "#10B981",
      "nodeIds": ["existing_node_id_1", "existing_node_id_2"],
      "reason": "One sentence explaining why this group improves workflow organization."
    },
    {
      "action": "update",
      "groupId": "existing_group_id",
      "currentName": "Old Group Name",
      "name": "Improved Group Name",
      "color": "#6366F1",
      "addNodeIds": ["node_id_to_add"],
      "removeNodeIds": ["node_id_to_remove"],
      "reason": "One sentence explaining the structural improvement."
    },
    {
      "action": "delete",
      "groupId": "existing_group_id",
      "currentName": "Obsolete Group Name",
      "reason": "One sentence explaining why this group is no longer relevant."
    }
  ],
  "suggestionPlan": {
    "phases": [
      {
        "phaseIndex": 1,
        "label": "Phase label",
        "description": "What this phase achieves",
        "prerequisitePhases": [],
        "suggestionRefs": [
          { "type": "connection", "refId": "sourceId-targetId" }
        ]
      }
    ]
  }
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
- cascadeEffects: Predict if this connection orphans existing nodes, creates bottlenecks, or makes existing edges redundant. Use type "redundant-edge" for edges made unnecessary by this bypass. Output type "stable" if no impact. depth starts at 1.
- If no useful connections can be suggested, return an empty array []

Rules for suggestedEdgeRemovals:
- Propose 0-3 edges that are now redundant (especially as a consequence of a suggestedConnection bypass)
- Only reference edge IDs that actually exist in the workflow data provided (use the id field from coreEdges or customEdges)
- Set prerequisiteConnectionId to "sourceId-targetId" of the suggestedConnection that must be applied first (if applicable)
- If no edge removals are warranted, return an empty array []

Rules for suggestedRemovals:
- Propose 0-3 entities (nodes) that are redundant, automatable, or could be merged
- action: "remove" = delete entirely, "automate" = replace with an automation tool node (pair with a suggestedNewNode), "merge" = fold into another node (set mergeTargetId)
- For "merge" action, always set mergeTargetId to the node that should absorb this one
- fishboneBones: Provide Ishikawa root cause analysis choosing from "People", "Process", "Technology", or "Environment". If a bone is addressed by one of the other suggestions, set resolvedBy with the type and refId.
- Only reference node IDs that actually exist in the workflow data provided
- If no removals are warranted, return an empty array []

Rules for suggestedNewNodes:
- Propose 0-2 new nodes to fill gaps left by automated/removed nodes, or to add gateway/automation capability
- role must be one of: "person", "tool", "external", "output"
- connectFrom and connectTo reference EXISTING node IDs only
- Set replacesNodeId if this node is a direct replacement for an existing node (pair with a suggestedRemovals "automate" entry)
- If no new nodes are needed, return an empty array []

Rules for suggestedTaskUpdates:
- Propose 0-3 task redistributions for nodes that are overloaded or underutilised
- Only reference node IDs that actually exist in the workflow data provided
- addTasks: new tasks to add (generate unique IDs like "t_new_1", "t_new_2")
- removeTasks: IDs of existing tasks to remove (only reference task IDs that exist in the provided data)
- If no task updates are warranted, return an empty array []

Rules for suggestedGroupUpdates:
- Propose 0-3 workflow group changes: creating new groups to represent distinct phases/departments, updating existing groups (rename, recolor, add/remove members), or deleting groups that no longer reflect the workflow structure
- For "create": set tempId (e.g. "grp_new_1"), name, a meaningful color (pick from #6366F1 indigo, #0EA5E9 sky, #10B981 emerald, #F59E0B amber, #EF4444 red, #8B5CF6 violet, #EC4899 pink, #14B8A6 teal), and nodeIds (only IDs that actually exist in the workflow)
- For "update": set groupId to an existing group's id from the groups data provided, set currentName for display, and include only the fields being changed (name/color/addNodeIds/removeNodeIds)
- For "delete": set groupId and currentName only; only suggest deletion if the group is made obsolete by other suggested changes (e.g. its members are being removed or merged)
- Do NOT create a group that perfectly duplicates an existing one
- If no group changes are warranted, return an empty array []

Rules for suggestionPlan:
- Group all suggestions into 2-4 ordered phases
- prerequisitePhases: list phaseIndex numbers that MUST be completed before this phase
- suggestionRefs type: "connection" (refId = "sourceId-targetId"), "edgeRemoval" (refId = edgeId), "removal" (refId = nodeId), "newNode" (refId = tempId), "taskUpdate" (refId = nodeId), "groupUpdate" (refId = tempId for creates, groupId for update/delete)
- Each suggestion must appear in exactly one phase

Output ONLY the JSON object — no markdown fences, no extra text`;

const PASS2_PROMPT = `You are a workflow validation AI.
A suggested change is being applied to the workflow. You must evaluate if this change breaks the workflow.
Specifically: does this new connection orphan any existing nodes? Does it bypass a necessary bottleneck dangerously? Does it make any existing edges redundant?
Return ONLY a JSON array of cascading effects describing the impact:

[
  {
    "id": "affected_node_or_edge_id",
    "type": "orphan" | "bottleneck" | "redundant-edge" | "stable",
    "description": "Explanation of why it is orphaned, bottlenecked, redundant, or stable.",
    "depth": 1
  }
]

Type guide:
- "orphan": a node loses all its inbound or outbound connections as a result of this change
- "bottleneck": a new bottleneck is created or an existing one worsens
- "redundant-edge": an existing edge becomes unnecessary because the new connection provides an equivalent path
- "stable": no negative impact

If the change is perfectly safe, return a single array item with type "stable" and id "none". Output ONLY the JSON array — no markdown fences, no extra text.`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflowData, apiKey, provider = 'anthropic', model, baseUrl, engine, stream: wantStream, lang = 'en' } = body as {
      workflowData: Record<string, unknown>;
      apiKey: string;
      provider?: AIProvider;
      model?: string;
      baseUrl?: string;
      engine?: AIEngineMode;
      /** Track 14d: set true to receive Server-Sent Events instead of a JSON blob */
      stream?: boolean;
      lang?: string;
    };

    if (provider !== 'demo' && !apiKey?.trim()) return NextResponse.json({ error: 'API key is required.' }, { status: 400 });
    if (!workflowData)      return NextResponse.json({ error: 'Workflow data is required.' }, { status: 400 });

    const resolvedModel = model?.trim() || (() => {
      const defaults: Record<AIProvider, string> = {
        anthropic: 'claude-sonnet-4-6',
        gemini:    'gemini-2.0-flash',
        doubao:    '',
        demo:      'demo-model',
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

    // Demo provider: return pre-built mock without any AI call
    if (provider === 'demo') {
      const { JACK_ROUTINE_DEMO_ANALYSIS, JACK_ROUTINE_DEMO_ANALYSIS_ZH } = await import('@/lib/demoAnalysis');
      const demoData = lang === 'zh' ? JACK_ROUTINE_DEMO_ANALYSIS_ZH : JACK_ROUTINE_DEMO_ANALYSIS;

      if (wantStream) {
        const encoder = new TextEncoder();
        const sseStream = new ReadableStream({
          async start(controller) {
            const send = (data: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            
            // Send a pseudo-stream of chunks to simulate the AI "thinking"
            const chunks = demoData.analysis.split('\n');
            for (const chunk of chunks) {
              send({ type: 'chunk', text: chunk + '\n' });
              await new Promise(r => setTimeout(r, 80)); // 80ms delay per line for demo effect
            }

            send({ type: 'validating', message: lang === 'zh' ? '正在完成演示建议...' : 'Finalizing demo suggestions...' });
            await new Promise(r => setTimeout(r, 600));
            
            send({
              type: 'done',
              ...demoData,
              isDemo: true,
            });
            controller.close();
          }
        });
        return new Response(sseStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
      }
      return NextResponse.json({ ...demoData, isDemo: true });
    }

    // ── Distributed engine branch ─────────────────────────────────────────────
    if (engine === 'distributed') {
      const aiConfig = { provider, model: resolvedModel, apiKey, baseUrl };
      const result = await runDistributedOptimize(
        workflowData as unknown as ServerGraphState,
        aiConfig,
        { maxConcurrent: 5, runGroupAnalysis: true, runCascades: true },
      );
      return NextResponse.json(result);
    }

    // ── Monolithic engine (original implementation below) ─────────────────────

    // Build enriched snapshot (Track 14b-i: hierarchical group summaries)
    const optimizeSnapshot = buildOptimizeSnapshot(workflowData);
    const { coreNodes, customNodes, coreEdges, customEdges, groupSummary, nameLookup } = optimizeSnapshot;

    // Track 14b: Context compression — trim snapshot if it exceeds the token budget
    const compressionResult = compressSnapshot(optimizeSnapshot);
    const workflowSnapshot  = compressionResult.workflowSnapshot;

    // Log compression details to the response when compression was applied
    const compressionMeta = compressionResult.wasCompressed ? {
      contextCompressed:     true,
      compressionOmissions:  compressionResult.omissions,
      originalTokenEstimate: compressionResult.originalTokenEstimate,
      compressedTokenEstimate: compressionResult.compressedTokenEstimate,
    } : null;

    const userMessage = `Analyze this workflow and provide optimization recommendations:\n\n${workflowSnapshot}`;


    // ── Track 14d: Streaming path ─────────────────────────────────────────────
    if (wantStream) {
      const encoder = new TextEncoder();

      const sseStream = new ReadableStream({
        async start(controller) {
          const send = (event: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };

          try {
            let rawText = '';

            // Stream chunks from the AI, forwarding each as an SSE event
            const genResult = await streamText(
              {
                provider,
                model:        resolvedModel,
                apiKey,
                systemPrompt: SYSTEM_PROMPT,
                userMessage,
                maxTokens:    5000,
                baseUrl:      baseUrl || undefined,
              },
              {
                onChunk: (chunk) => {
                  rawText += chunk;
                  send({ type: 'chunk', text: chunk });
                },
              },
            );
            rawText = genResult.text;

            // Parse the full JSON from the completed stream
            let analysis: string = rawText;
            let suggestedConnections:  unknown[] = [];
            let suggestedEdgeRemovals: unknown[] = [];
            let suggestedRemovals:     unknown[] = [];
            let suggestedNewNodes:     unknown[] = [];
            let suggestedTaskUpdates:  unknown[] = [];
            let suggestedGroupUpdates: unknown[] = [];
            let suggestionPlan:        unknown   = null;

            try {
              const raw    = JSON.parse(jsonrepair(stripFences(rawText)));
              const parsed = OptimizeResponseSchema.safeParse(raw);
              if (parsed.success) {
                analysis              = parsed.data.analysis;
                suggestedConnections  = parsed.data.suggestedConnections;
                suggestedEdgeRemovals = parsed.data.suggestedEdgeRemovals;
                suggestedRemovals     = parsed.data.suggestedRemovals;
                suggestedNewNodes     = parsed.data.suggestedNewNodes;
                suggestedTaskUpdates  = parsed.data.suggestedTaskUpdates;
                suggestedGroupUpdates = parsed.data.suggestedGroupUpdates;
                suggestionPlan        = parsed.data.suggestionPlan ?? null;
              } else if (typeof raw === 'object' && raw !== null) {
                analysis              = typeof raw.analysis === 'string' ? raw.analysis : rawText;
                suggestedConnections  = Array.isArray(raw.suggestedConnections)  ? raw.suggestedConnections  : [];
                suggestedEdgeRemovals = Array.isArray(raw.suggestedEdgeRemovals) ? raw.suggestedEdgeRemovals : [];
                suggestedRemovals     = Array.isArray(raw.suggestedRemovals)     ? raw.suggestedRemovals     : [];
                suggestedNewNodes     = Array.isArray(raw.suggestedNewNodes)     ? raw.suggestedNewNodes     : [];
                suggestedTaskUpdates  = Array.isArray(raw.suggestedTaskUpdates)  ? raw.suggestedTaskUpdates  : [];
                suggestedGroupUpdates = Array.isArray(raw.suggestedGroupUpdates) ? raw.suggestedGroupUpdates : [];
                suggestionPlan        = raw.suggestionPlan ?? null;
              }
            } catch {
              analysis = rawText;
            }

            // Notify client that suggestions are being validated (Pass 2)
            if ((suggestedConnections as unknown[]).length > 0) {
              send({ type: 'validating', message: 'Validating suggested connections…' });
              const validationPromises = (suggestedConnections as Array<Record<string, unknown>>).map(async (conn) => {
                try {
                  const tempEdges = [...coreEdges, ...customEdges, {
                    id:         `temp_${conn.sourceId}_${conn.targetId}`,
                    sourceName: nameLookup[conn.sourceId as string] ?? conn.sourceId,
                    targetName: nameLookup[conn.targetId as string] ?? conn.targetId,
                  }];
                  const modifiedSnapshot = JSON.stringify({
                    coreNodes, coreEdges: tempEdges, customNodes, groups: groupSummary
                  }, null, 2);
                  const pass2Result = await generateText({
                    provider, model: resolvedModel, apiKey,
                    systemPrompt: PASS2_PROMPT,
                    userMessage: `Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName}'.\n\nWorkflow:\n${modifiedSnapshot}`,
                    maxTokens: 1000,
                    baseUrl:   baseUrl || undefined,
                  });
                  const effects = JSON.parse(stripFences(pass2Result.text));
                  conn.cascadeEffects = Array.isArray(effects) ? effects : [{ id: `fb_${Date.now()}`, type: 'stable', description: 'Safe to apply', depth: 1 }];
                } catch {
                  conn.cascadeEffects = [{ id: `fb_${Date.now()}`, type: 'stable', description: 'Could not evaluate cascade', depth: 1 }];
                }
              });
              await Promise.all(validationPromises);
            }

            // Send the final structured result
            send({
              type: 'done',
              analysis,
              tokenUsage:           genResult.usage ?? null,
              suggestedConnections,
              suggestedEdgeRemovals,
              suggestedRemovals,
              suggestedNewNodes,
              suggestedTaskUpdates,
              suggestedGroupUpdates,
              suggestionPlan,
              ...(compressionMeta ?? {}),
            });
          } catch (err) {
            const { userMessage: msg } = classifyAIError(err);
            send({ type: 'error', message: msg });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(sseStream, {
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection':    'keep-alive',
        },
      });
    }

    // ── Non-streaming (buffered) path ─────────────────────────────────────────

    const pass1Result = await generateText({
      provider,
      model: resolvedModel,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      maxTokens:    5000,
      baseUrl:      baseUrl || undefined,
    });
    const rawText = pass1Result.text;

    let analysis: string = rawText;
    let suggestedConnections:  any[] = [];
    let suggestedEdgeRemovals: any[] = [];
    let suggestedRemovals:     any[] = [];
    let suggestedNewNodes:     any[] = [];
    let suggestedTaskUpdates:  any[] = [];
    let suggestedGroupUpdates: any[] = [];
    let suggestionPlan:        any   = null;

    try {
      const raw    = JSON.parse(jsonrepair(stripFences(rawText)));
      const parsed = OptimizeResponseSchema.safeParse(raw);
      if (parsed.success) {
        analysis              = parsed.data.analysis;
        suggestedConnections  = parsed.data.suggestedConnections;
        suggestedEdgeRemovals = parsed.data.suggestedEdgeRemovals;
        suggestedRemovals     = parsed.data.suggestedRemovals;
        suggestedNewNodes     = parsed.data.suggestedNewNodes;
        suggestedTaskUpdates  = parsed.data.suggestedTaskUpdates;
        suggestedGroupUpdates = parsed.data.suggestedGroupUpdates;
        suggestionPlan        = parsed.data.suggestionPlan ?? null;
      } else {
        // Fallback: try to extract fields manually from the raw object
        if (typeof raw === 'object' && raw !== null) {
          analysis              = typeof raw.analysis === 'string' ? raw.analysis : rawText;
          suggestedConnections  = Array.isArray(raw.suggestedConnections)  ? raw.suggestedConnections  : [];
          suggestedEdgeRemovals = Array.isArray(raw.suggestedEdgeRemovals) ? raw.suggestedEdgeRemovals : [];
          suggestedRemovals     = Array.isArray(raw.suggestedRemovals)     ? raw.suggestedRemovals     : [];
          suggestedNewNodes     = Array.isArray(raw.suggestedNewNodes)     ? raw.suggestedNewNodes     : [];
          suggestedTaskUpdates  = Array.isArray(raw.suggestedTaskUpdates)  ? raw.suggestedTaskUpdates  : [];
          suggestedGroupUpdates = Array.isArray(raw.suggestedGroupUpdates) ? raw.suggestedGroupUpdates : [];
          suggestionPlan        = raw.suggestionPlan ?? null;
        }
      }
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

          const pass2Result = await generateText({
            provider,
            model: resolvedModel,
            apiKey,
            systemPrompt: PASS2_PROMPT,
            userMessage: `Evaluate adding a connection from '${conn.sourceName}' to '${conn.targetName}'.\n\nWorkflow:\n${modifiedSnapshot}`,
            maxTokens: 1000,
            baseUrl: baseUrl || undefined,
          });
          const pass2Text = pass2Result.text;

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

    return NextResponse.json({
      analysis,
      tokenUsage: pass1Result.usage ?? null,
      suggestedConnections,
      suggestedEdgeRemovals,
      suggestedRemovals,
      suggestedNewNodes,
      suggestedTaskUpdates,
      suggestedGroupUpdates,
      suggestionPlan,
      ...(compressionMeta ?? {}),
    });
  } catch (err: unknown) {
    const { userMessage, status } = classifyAIError(err);
    return NextResponse.json({ error: userMessage }, { status });
  }
}
