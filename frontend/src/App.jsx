import React, { useState, useEffect } from 'react';
import { Sparkles, FileEdit, Cpu } from 'lucide-react';
import OCRMode from './modes/OCRMode';
import EditMode from './modes/EditMode';

const getBackendUrl = (path) => {
  const host = window.location.hostname;
  return `http://${host}:8000${path}`;
};

function App() {
  const [activeMode, setActiveMode] = useState('ocr'); // 'ocr' or 'edit'
  const [documents, setDocuments] = useState({}); // { filename: { markdown: '', imageMappings: {} } }
  const [activeDocName, setActiveDocName] = useState('');

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const response = await fetch(getBackendUrl('/api/documents'));
        if (response.ok) {
          const data = await response.json();
          setDocuments(data);
          const docNames = Object.keys(data);
          if (docNames.length > 0) {
            setActiveDocName(docNames[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch documents:', err);
      }
    };
    fetchDocs();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-row font-sans">
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        {/* Brand */}
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <Cpu className="w-5 h-5 text-slate-500" />
          <div>
            <h1 className="text-xs font-bold text-slate-800 tracking-wider m-0 uppercase">PDF2MD Pipeline</h1>
            <p className="text-[9px] text-slate-400 m-0 uppercase font-semibold">Verbatim Transcription</p>
          </div>
        </div>

        {/* Navigation Switcher */}
        <nav className="flex-1 p-4 flex flex-col gap-1.5">
          <button
            onClick={() => setActiveMode('ocr')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all ${
              activeMode === 'ocr'
                ? 'bg-slate-100 text-slate-900 border border-slate-200 shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            OCR MODE
          </button>
          <button
            onClick={() => setActiveMode('edit')}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold tracking-wide transition-all ${
              activeMode === 'edit'
                ? 'bg-slate-100 text-slate-900 border border-slate-200 shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <FileEdit className="w-4 h-4" />
            EDIT & PUBLISH
          </button>
        </nav>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col">
        <div className={activeMode === 'ocr' ? 'flex flex-1 flex-col' : 'hidden'}>
          <OCRMode
            documents={documents}
            setDocuments={setDocuments}
            setActiveDocName={setActiveDocName}
            onComplete={() => setActiveMode('edit')}
          />
        </div>
        <div className={activeMode === 'edit' ? 'flex flex-1 flex-col' : 'hidden'}>
          <EditMode
            documents={documents}
            setDocuments={setDocuments}
            activeDocName={activeDocName}
            setActiveDocName={setActiveDocName}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
