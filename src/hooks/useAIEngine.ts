'use client';

/**
 * hooks/useAIEngine.ts — Strategy-pattern routing hook for AI operations.
 *
 * Intercepts AI API calls and injects the current engine mode.
 * Handles the critical race condition: if the user toggles mode while a
 * request is in flight, the stale request is aborted via AbortController
 * and its response is discarded using a generation counter.
 *
 * The UI components never touch this hook directly — it's consumed by
 * useAIHandlers, which remains the public API for all AI operations.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useAIEngineMode, type AIEngineMode } from '@/contexts/AIEngineContext';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIEngineConfig {
  apiKey: string;
  provider: string;
  model: string;
  baseUrl?: string;
  lang?: string;
}

export interface EngineCallOptions {
  /** Override the engine mode for this specific call */
  forceMode?: AIEngineMode;
  /** External AbortSignal to chain */
  signal?: AbortSignal;
}

interface InFlightRequest {
  controller: AbortController;
  generation: number;
  operationType: 'analyze' | 'update';
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAIEngine() {
  const { mode, generation } = useAIEngineMode();

  // Track in-flight requests by operation type
  const inFlightRef = useRef<Map<string, InFlightRequest>>(new Map());
  // Snapshot the generation at call time to detect staleness
  const generationRef = useRef(generation);
  generationRef.current = generation;

  // Abort all in-flight requests when generation changes (mode toggled)
  useEffect(() => {
    const inFlight = inFlightRef.current;
    for (const [key, req] of inFlight) {
      if (req.generation !== generation) {
        req.controller.abort(new DOMException('Engine mode changed', 'AbortError'));
        inFlight.delete(key);
      }
    }
  }, [generation]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      for (const req of inFlightRef.current.values()) {
        req.controller.abort(new DOMException('Component unmounted', 'AbortError'));
      }
      inFlightRef.current.clear();
    };
  }, []);

  /**
   * Run the optimize/analyze operation via the appropriate engine.
   * Returns the response data or throws on error/abort.
   */
  const runAnalyze = useCallback(async (
    workflowData: unknown,
    config: AIEngineConfig,
    options?: EngineCallOptions,
  ): Promise<{ data: Record<string, unknown>; engine: AIEngineMode; aborted: boolean }> => {
    const effectiveMode = options?.forceMode ?? mode;
    const callGeneration = generationRef.current;

    // Abort any previous in-flight analyze request
    const existing = inFlightRef.current.get('analyze');
    if (existing) {
      existing.controller.abort(new DOMException('Superseded by new request', 'AbortError'));
      inFlightRef.current.delete('analyze');
    }

    const controller = new AbortController();
    if (options?.signal) {
      // Chain external signal
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason));
    }

    inFlightRef.current.set('analyze', {
      controller,
      generation: callGeneration,
      operationType: 'analyze',
    });

    try {
      const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowData,
          apiKey: config.apiKey,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl || undefined,
          lang: config.lang || 'en',
          engine: effectiveMode,
        }),
        signal: controller.signal,
      });

      // Check for staleness: if generation changed since we started, discard result
      if (generationRef.current !== callGeneration) {
        return { data: {}, engine: effectiveMode, aborted: true };
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Analysis failed.');
      }

      return { data, engine: effectiveMode, aborted: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { data: {}, engine: effectiveMode, aborted: true };
      }
      throw err;
    } finally {
      inFlightRef.current.delete('analyze');
    }
  }, [mode]);

  /**
   * Run the update operation via the appropriate engine.
   */
  const runUpdate = useCallback(async (
    prompt: string,
    currentState: unknown,
    config: AIEngineConfig,
    options?: EngineCallOptions,
  ): Promise<{ data: Record<string, unknown>; engine: AIEngineMode; aborted: boolean }> => {
    const effectiveMode = options?.forceMode ?? mode;
    const callGeneration = generationRef.current;

    // Abort any previous in-flight update request
    const existing = inFlightRef.current.get('update');
    if (existing) {
      existing.controller.abort(new DOMException('Superseded by new request', 'AbortError'));
      inFlightRef.current.delete('update');
    }

    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason));
    }

    inFlightRef.current.set('update', {
      controller,
      generation: callGeneration,
      operationType: 'update',
    });

    try {
      const res = await fetch('/api/ai/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentState,
          apiKey: config.apiKey,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl || undefined,
          lang: config.lang || 'en',
          engine: effectiveMode,
        }),
        signal: controller.signal,
      });

      if (generationRef.current !== callGeneration) {
        return { data: {}, engine: effectiveMode, aborted: true };
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Update failed.');
      }

      return { data, engine: effectiveMode, aborted: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { data: {}, engine: effectiveMode, aborted: true };
      }
      throw err;
    } finally {
      inFlightRef.current.delete('update');
    }
  }, [mode]);

  /**
   * Track 14d — Streaming analyze.
   * Opens an SSE connection to /api/ai/optimize?stream=true and calls
   * the provided callbacks as events arrive.
   *
   * `onChunk`   — called for each raw text chunk (for live analysis preview)
   * `onDone`    — called once with the final structured result
   * `onError`   — called if the server sends an error event or the fetch fails
   */
  const runAnalyzeStream = useCallback(async (
    workflowData: unknown,
    config: AIEngineConfig,
    callbacks: {
      onChunk:  (chunk: string) => void;
      onDone:   (data: Record<string, unknown>) => void;
      onError:  (message: string) => void;
    },
    options?: EngineCallOptions,
  ): Promise<{ engine: AIEngineMode; aborted: boolean }> => {
    const effectiveMode  = options?.forceMode ?? mode;
    const callGeneration = generationRef.current;

    // Abort any previous in-flight analyze
    const existing = inFlightRef.current.get('analyze');
    if (existing) {
      existing.controller.abort(new DOMException('Superseded by new request', 'AbortError'));
      inFlightRef.current.delete('analyze');
    }

    const controller = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason));
    }

    inFlightRef.current.set('analyze', {
      controller,
      generation: callGeneration,
      operationType: 'analyze',
    });

    try {
      const res = await fetch('/api/ai/optimize', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowData,
          apiKey:   config.apiKey,
          provider: config.provider,
          model:    config.model,
          baseUrl:  config.baseUrl || undefined,
          lang:     config.lang || 'en',
          engine:   effectiveMode,
          stream:   true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Analysis failed.' }));
        throw new Error(err.error ?? 'Analysis failed.');
      }

      if (!res.body) throw new Error('No response body for streaming.');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check staleness on each chunk
        if (generationRef.current !== callGeneration) {
          reader.cancel();
          return { engine: effectiveMode, aborted: true };
        }

        buffer += decoder.decode(value, { stream: true });

        // SSE lines are delimited by "\n\n"
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (event.type === 'chunk') {
              callbacks.onChunk(event.text as string);
            } else if (event.type === 'done') {
              callbacks.onDone(event);
            } else if (event.type === 'error') {
              callbacks.onError(event.message as string ?? 'Unknown error');
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }

      return { engine: effectiveMode, aborted: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { engine: effectiveMode, aborted: true };
      }
      throw err;
    } finally {
      inFlightRef.current.delete('analyze');
    }
  }, [mode]);

  /**
   * Abort a specific in-flight operation.
   */
  const abort = useCallback((operationType: 'analyze' | 'update') => {
    const req = inFlightRef.current.get(operationType);
    if (req) {
      req.controller.abort(new DOMException('Manually aborted', 'AbortError'));
      inFlightRef.current.delete(operationType);
    }
  }, []);

  /**
   * Check if a specific operation is in flight.
   */
  const isInFlight = useCallback((operationType: 'analyze' | 'update') => {
    return inFlightRef.current.has(operationType);
  }, []);

  return {
    mode,
    runAnalyze,
    runAnalyzeStream,
    runUpdate,
    abort,
    isInFlight,
  };
}
