/**
 * Workable window for the Hermes desktop app.
 *
 * Shows Workable (http://localhost:3000) in a pane beside the chat, plus a full
 * page in the sidebar. When the agent writes ::workable-graph{id="g_…"} on its
 * own line (the MCP tools hand it that line as chatCard), the message shows a
 * live card of that workflow. Workable runs in the SDK's sandboxed frame; the embed
 * token lets it call its own API from there (see src/proxy.ts in the workable
 * repo — WORKABLE_EMBED_TOKEN in .env.local must match EMBED_TOKEN below).
 * Editing Hermes stays in the browser: the frame is read-only for that.
 *
 * Source: ~/Documents/trae_projects/workable/hermes-plugin/desktop/plugin.js
 */

import {
  Button,
  Codicon,
  host,
  PALETTE_AREA,
  PANES_AREA,
  ROUTES_AREA,
  SandboxedFrame,
  SegmentedControl,
  SIDEBAR_NAV_AREA,
  TRANSCRIPT_DIRECTIVE_AREA
} from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const WORKABLE_URL = 'http://localhost:3000'
const EMBED_TOKEN = '__WORKABLE_EMBED_TOKEN__' // filled in by hermes-plugin/install.sh

const VIEWS = [
  { id: 'team', label: 'Team map' },
  { id: 'canvas', label: 'Canvas' }
]
const PATHS = { team: '/hermes', canvas: '/?open=canvas' }

function frameUrl(view) {
  const path = PATHS[view]
  return WORKABLE_URL + path + (path.includes('?') ? '&' : '?') + 'embed=' + encodeURIComponent(EMBED_TOKEN)
}

const GRAPH_ID = /^g_[a-z0-9]{10}$/

/** Inline card for ::workable-graph{id="g_…"}. Attributes are untrusted model output. */
function WorkflowChatCard({ attrs, streaming }) {
  const id = typeof attrs.id === 'string' ? attrs.id : ''
  if (!GRAPH_ID.test(id)) return null
  if (streaming) {
    return jsx('div', {
      className: 'my-1 rounded-md border border-(--ui-border) px-3 py-2 text-xs text-(--ui-text-tertiary)',
      children: 'Workable workflow…'
    })
  }
  return jsxs('div', {
    className: 'my-1 overflow-hidden rounded-md border border-(--ui-border)',
    style: { maxWidth: '680px' },
    children: [
      jsx(SandboxedFrame, {
        src: WORKABLE_URL + '/embed/graph/' + id + '?embed=' + encodeURIComponent(EMBED_TOKEN),
        title: 'Workable workflow ' + id,
        sandbox: 'allow-scripts',
        className: 'block w-full border-0',
        style: { height: '380px' }
      }),
      jsxs('div', {
        className: 'flex items-center gap-2 border-t border-(--ui-border) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
        children: [
          jsx('span', { className: 'font-mono', children: id }),
          jsx('div', { className: 'flex-1' }),
          jsx(Button, {
            variant: 'ghost',
            size: 'xs',
            onClick: () => host.navigate('/workable'),
            children: 'Open Workable'
          })
        ]
      })
    ]
  })
}

function WorkableWindow({ os }) {
  const [view, setView] = useState('team')
  const [reloadKey, setReloadKey] = useState(0)

  return jsxs('div', {
    className: 'flex h-full min-h-0 flex-col',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2 border-b border-(--ui-border) px-2 py-1.5',
        children: [
          jsx(SegmentedControl, { options: VIEWS, value: view, onChange: setView }),
          jsx('div', { className: 'flex-1' }),
          jsx(Button, {
            variant: 'ghost',
            size: 'icon-xs',
            title: 'Reload',
            'aria-label': 'Reload Workable',
            onClick: () => setReloadKey(k => k + 1),
            children: jsx(Codicon, { name: 'refresh' })
          }),
          jsx(Button, {
            variant: 'ghost',
            size: 'icon-xs',
            title: 'Open in browser (to add or edit agents)',
            'aria-label': 'Open Workable in the browser',
            onClick: () => os.openExternal(WORKABLE_URL + PATHS[view]),
            children: jsx(Codicon, { name: 'link-external' })
          })
        ]
      }),
      jsx('div', {
        className: 'relative min-h-0 flex-1',
        children: jsx(SandboxedFrame, {
          key: view + '-' + reloadKey,
          src: frameUrl(view),
          title: 'Workable',
          sandbox: 'allow-scripts allow-forms',
          className: 'absolute inset-0 h-full w-full border-0'
        })
      }),
      jsx('div', {
        className: 'border-t border-(--ui-border) px-2 py-1 text-[0.6875rem] text-(--ui-text-tertiary)',
        children: 'Blank? Start Workable with npm run dev in the workable repo, then reload.'
      })
    ]
  })
}

export default {
  id: 'workable',
  name: 'Workable',
  register(ctx) {
    ctx.registerMany([
      {
        id: 'pane',
        area: PANES_AREA,
        title: 'Workable',
        data: { placement: 'right', width: '560px' },
        render: () => jsx(WorkableWindow, { os: ctx.os })
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/workable' },
        render: () => jsx(WorkableWindow, { os: ctx.os })
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/workable', label: 'Workable', codicon: 'type-hierarchy' }
      },
      {
        id: 'graph-card',
        area: TRANSCRIPT_DIRECTIVE_AREA,
        data: { name: 'workable-graph', render: props => jsx(WorkflowChatCard, props) }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'workable.open',
          label: 'Workable: Open',
          keywords: ['workable', 'workflow', 'canvas', 'team'],
          run: () => host.navigate('/workable')
        }
      },
      {
        id: 'open-browser',
        area: PALETTE_AREA,
        data: {
          id: 'workable.openBrowser',
          label: 'Workable: Open in browser',
          keywords: ['workable', 'browser'],
          run: () => ctx.os.openExternal(WORKABLE_URL + '/hermes')
        }
      }
    ])
  }
}
