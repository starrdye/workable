"use client";

import { X, Sparkles, Loader2, AlertCircle } from "lucide-react";

interface AIAnalysisModalProps {
  isOpen: boolean;
  isLoading: boolean;
  analysis: string | null;
  error: string | null;
  onClose: () => void;
}

// Minimal markdown-to-JSX: renders ## headings and bullet lists
function renderMarkdown(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="text-sm font-bold text-slate-800 mt-5 mb-2 first:mt-0">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <li key={i} className="text-sm text-slate-600 leading-relaxed ml-3 list-disc">
          {line.slice(2)}
        </li>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      return (
        <li key={i} className="text-sm text-slate-600 leading-relaxed ml-3 list-decimal">
          {line.replace(/^\d+\.\s/, "")}
        </li>
      );
    }
    if (line.trim() === "") {
      return <div key={i} className="h-1" />;
    }
    return (
      <p key={i} className="text-sm text-slate-600 leading-relaxed">
        {line}
      </p>
    );
  });
}

export function AIAnalysisModal({ isOpen, isLoading, analysis, error, onClose }: AIAnalysisModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col relative border border-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">AI Workflow Analysis</h2>
              <p className="text-xs text-slate-500">Powered by Claude</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-sm">Analyzing your workflow…</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {analysis && !isLoading && (
            <div className="space-y-0.5">
              {renderMarkdown(analysis)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 pt-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
