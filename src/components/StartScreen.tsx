"use client";
import { useRef, useState } from "react";
import { Zap, ArrowRight, UploadCloud, FileText } from "lucide-react";

interface StartScreenProps {
  onStart: () => void;
  onImportAndStart?: (csvText: string) => void;
}

export function StartScreen({ onStart, onImportAndStart }: StartScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    readFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
    e.target.value = "";
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        setCsvText(text);
        setFileName(file.name);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadWorkflow = () => {
    if (csvText && onImportAndStart) {
      onImportAndStart(csvText);
    } else {
      onStart();
    }
  };

  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-[#F8FAFC]"
      style={{
        backgroundImage: 'radial-gradient(#CBD5E1 1px, transparent 1px)',
        backgroundSize: '30px 30px',
      }}
    >
      <div className="bg-white/85 backdrop-blur-md border border-gray-100 w-full max-w-2xl rounded-3xl p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] flex flex-col gap-6">
        {/* Title */}
        <div className="text-center mb-2">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center justify-center gap-3">
            <Zap className="w-8 h-8 text-indigo-600" />
            Ecosystem Data Engine
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            Start a new workflow or load an existing one from a CSV export.
          </p>
        </div>

        {/* Two options side by side */}
        <div className="grid grid-cols-2 gap-4">
          {/* Option A: New workflow */}
          <button
            onClick={onStart}
            className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition-all text-center group"
          >
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-600 transition-colors">
              <Zap className="w-6 h-6 text-indigo-600 group-hover:text-white transition-colors" />
            </div>
            <div>
              <div className="font-bold text-slate-800 text-sm">Start Fresh</div>
              <div className="text-xs text-slate-500 mt-1">Load the default Ridgeview workflow</div>
            </div>
          </button>

          {/* Option B: Import CSV */}
          <div
            className="flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all text-center group cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${fileName ? "bg-emerald-100" : "bg-slate-100 group-hover:bg-emerald-500"}`}>
              {fileName
                ? <FileText className="w-6 h-6 text-emerald-600" />
                : <UploadCloud className="w-6 h-6 text-slate-500 group-hover:text-white transition-colors" />
              }
            </div>
            <div>
              <div className={`font-bold text-sm ${fileName ? "text-emerald-700" : "text-slate-800"}`}>
                {fileName ? "CSV Loaded ✓" : "Import from CSV"}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {fileName ? fileName : "Drag & drop or click to browse"}
              </div>
            </div>
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

        {/* Textarea for workflow instructions */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Workflow Instructions (optional)
          </label>
          <textarea
            rows={3}
            className="w-full bg-white border border-gray-300 rounded-xl p-4 text-gray-800 placeholder-gray-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 resize-none shadow-sm"
            placeholder="e.g., Xingye gets input from NAV back office, uses script to parse data..."
          />
        </div>

        {/* Submit Button */}
        <button
          onClick={handleLoadWorkflow}
          className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 ${
            csvText
              ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_14px_0_rgba(16,185,129,0.39)]"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.39)]"
          }`}
        >
          {csvText ? "Load Workflow from CSV" : "Generate Ecosystem Model"}
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
