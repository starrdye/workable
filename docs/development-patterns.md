# Development Patterns

## Adding a new template

Templates live in `src/lib/templates.ts`. Each template calls `buildTemplateState(config)` which:
1. Takes `nodes`, `edges`, `groups`, and `settings` overrides
2. Auto-derives `metadataOverrides` per node: `connections` from edges, `processes` from group membership
3. Returns a `GraphState`-compatible object ready for `importState()`

```typescript
// Minimal template structure
export function buildMyTemplate(): Partial<GraphState> {
  const nodes: CustomNodeConfig[] = [ /* ... */ ];
  const edges: CustomEdgeConfig[]  = [ /* ... */ ];
  const groups: WorkflowGroup[]    = [ /* ... */ ];
  return buildTemplateState({ nodes, edges, groups });
}
```

## Adding a new sidebar field

1. Add the field to `AnalysisData` in `AnalysisSidebar.tsx`
2. Populate it in the `useEffect` in `page.tsx` (from `fullServerState`, `workflowCache`, or derived logic)
3. Render it in the sidebar body using `<EditableField>` or `<EditableList>`
4. If it needs persistence: add the field to `updateMetadata`'s PUT body in `handleSave`

## Debugging AI parse failures

1. Click **AI Debug Log** (always visible, bottom-left corner)
2. The modal shows:
   - **Prompt sent** — full text with schema injected
   - **Raw AI response** — exactly what the model returned before any parsing
3. Common failure modes:
   - Model wraps JSON in `\`\`\`json` fences → handled by `extractJSON`
   - Model adds preamble / postamble text → handled by brace-depth scan
   - Model generates invalid JSON (missing quote, trailing comma) → handled by `jsonrepair`
   - Model generates semantically wrong structure (wrong field names) → prompt engineering

## Doubao endpoint ID persistence

The `loadAIConfig()` function in `AISettingsModal.tsx` merges the saved `localStorage` value with defaults on every page load. Prior to 0.38, a guard clause erased any `models.doubao` value that did not start with `"ep-"`, which wiped user-configured model names (e.g. `doubao-seed-2.0-lite`) every session.

That guard has been removed. The saved endpoint / model value is now always respected. If a user needs to reset it, they open AI Settings and clear the Endpoint ID field manually.

## First-generation layout consistency

`importStateAndStart` in `page.tsx` (called after both AI parse and template load) now issues two sequential server calls before revealing the canvas:

1. `PUT /api/graph-state { action: "importState", … }` — stores nodes, edges, groups, metadata
2. `PUT /api/graph-state { action: "resetLayout" }` — re-runs `hierarchicalLayout` + `groupAwareLayout` using the just-stored groups

This guarantees that the positions the user sees on first load are identical to what Reset Layout would produce, instead of using the raw positions that the parse-workflow route calculated before group sanitization was complete.

## Hydration / SSR rules

- **Never** call `localStorage` inside `useState(initializer)` or component body
- Use `useEffect` for any client-side-only reads (AI config, saved state)
- `aiConfig` is initialised with a static default object, then overwritten in `useEffect(() => setAiConfig(loadAIConfig()), [])`
