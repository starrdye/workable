import { describe, it, expect, vi } from 'vitest';
import { POST } from '../app/api/ai/optimize/route';
import { NextRequest } from 'next/server';
import { JACK_ROUTINE_DEMO_ANALYSIS } from '../lib/demoAnalysis';

describe('AI Demo Mode Integration', () => {
  const mockWorkflowData = {
    coreNodes: [],
    customNodes: [{ id: 'jack', label: 'Jack' }],
    coreEdges: [],
    customEdges: [],
    settings: { templateId: 'demo-jack' }
  };

  it('should return pre-baked analysis when provider is demo', async () => {
    const req = new NextRequest('http://localhost/api/ai/optimize', {
      method: 'POST',
      body: JSON.stringify({
        workflowData: mockWorkflowData,
        provider: 'demo',
        apiKey: '', // Empty key should be allowed for demo
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.isDemo).toBe(true);
    expect(data.analysis).toContain("Jack (the central operator)");
    expect(data.suggestedRemovals).toHaveLength(JACK_ROUTINE_DEMO_ANALYSIS.suggestedRemovals.length);
  });

  it('should support streaming for demo mode', async () => {
    const req = new NextRequest('http://localhost/api/ai/optimize', {
      method: 'POST',
      body: JSON.stringify({
        workflowData: mockWorkflowData,
        provider: 'demo',
        apiKey: '',
        stream: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = res.body?.getReader();
    const decoder = new TextEncoder();
    let hasDoneEvent = false;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        if (text.includes('"type":"done"')) {
          hasDoneEvent = true;
          expect(text).toContain('"isDemo":true');
        }
      }
    }

    expect(hasDoneEvent).toBe(true);
  });
});
