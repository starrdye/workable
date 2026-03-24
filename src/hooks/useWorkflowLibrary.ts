/**
 * useWorkflowLibrary — Track 1 Tier 2 (0.5-personal)
 *
 * Manages a named workflow library persisted in localStorage.
 * Each saved workflow is a full ServerGraphState snapshot stored
 * under the key `workable_library` as a JSON array of LibraryEntry.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ServerGraphState } from '@/lib/serverState';

const LIBRARY_KEY = 'workable_library';

export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number; // Unix ms
  state: ServerGraphState;
}

function loadLibrary(): LibraryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLibrary(entries: LibraryEntry[]): void {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

export interface WorkflowLibraryHandle {
  entries: LibraryEntry[];
  saveWorkflow: (name: string, state: ServerGraphState) => void;
  loadWorkflow: (id: string) => LibraryEntry | null;
  deleteWorkflow: (id: string) => void;
}

export function useWorkflowLibrary(): WorkflowLibraryHandle {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);

  // Load on mount (client-side only)
  useEffect(() => {
    setEntries(loadLibrary());
  }, []);

  const saveWorkflow = useCallback((name: string, state: ServerGraphState) => {
    const entry: LibraryEntry = {
      id:      `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name:    name.trim() || `Workflow ${new Date().toLocaleString()}`,
      savedAt: Date.now(),
      state:   JSON.parse(JSON.stringify(state)), // deep clone
    };
    setEntries(prev => {
      const next = [entry, ...prev];
      saveLibrary(next);
      return next;
    });
  }, []);

  const loadWorkflow = useCallback((id: string): LibraryEntry | null => {
    const current = loadLibrary();
    return current.find(e => e.id === id) ?? null;
  }, []);

  const deleteWorkflow = useCallback((id: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      saveLibrary(next);
      return next;
    });
  }, []);

  return { entries, saveWorkflow, loadWorkflow, deleteWorkflow };
}
