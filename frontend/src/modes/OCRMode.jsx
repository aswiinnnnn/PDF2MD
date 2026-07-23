import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, AlertCircle, FileText, ArrowRight, CheckCircle2, RotateCcw, Trash2, ListOrdered } from 'lucide-react';

const getBackendUrl = (path) => {
  const host = window.location.hostname;
  return `http://${host}:8000${path}`;
};

function OCRMode({ documents, setDocuments, setActiveDocName, onComplete }) {
  const [queue, setQueue] = useState([]);
  const [dpi, setDpi] = useState(300);
  const [loading, setLoading] = useState(false);
  const [currentFileIdx, setCurrentFileIdx] = useState(null);
  const [progress, setProgress] = useState({ page: 0, total: 0 });
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const logsEndRef = useRef(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(getBackendUrl('/api/workspace-status'));
        if (response.ok) {
          const data = await response.json();
          const loadedQueue = data.queue.map(item => ({
            id: Math.random().toString(36).substring(7),
            file: { name: item.name },
            status: item.status,
            progress: { page: 0, total: 0 },
            error: null
          }));
          setQueue(loadedQueue);
          setLogs(data.logs || []);
        }
      } catch (err) {
        console.error('Failed to load workspace status:', err);
      }
    };
    fetchStatus();
  }, []);

  const handleFileChange = async (e) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      const allowedFiles = selectedFiles.filter(
        (file) => file.type === 'application/pdf' || file.name.endsWith('.pdf')
      );

      if (allowedFiles.length > 0) {
        setError(null);
        for (const file of allowedFiles) {
          const itemId = Math.random().toString(36).substring(7);
          const newItem = {
            id: itemId,
            file,
            status: 'uploading',
            progress: { page: 0, total: 0 },
            error: null,
          };
          setQueue((prev) => [...prev, newItem]);
          addLog(`Uploading ${file.name} to backend...`);

          const formData = new FormData();
          formData.append('file', file);

          try {
            const res = await fetch(getBackendUrl('/api/upload-pdf'), {
              method: 'POST',
              body: formData,
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(errText || 'Upload failed');
            }
            setQueue((prev) =>
              prev.map((item) =>
                item.id === itemId ? { ...item, status: 'pending' } : item
              )
            );
            addLog(`Uploaded ${file.name} successfully. Ready for processing.`);
          } catch (err) {
            setQueue((prev) =>
              prev.map((item) =>
                item.id === itemId
                  ? { ...item, status: 'error', error: err.message }
                  : item
              )
            );
            addLog(`Failed to upload ${file.name}: ${err.message}`, 'error');
          }
        }
      } else {
        setError('Please select valid PDF files.');
      }
    }
  };

  const removeQueueItem = (id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearQueue = async () => {
    if (loading) return;
    try {
      const res = await fetch(getBackendUrl('/api/clear-data'), {
        method: 'POST',
      });
      if (res.ok) {
        setQueue([]);
        setLogs([]);
        setError(null);
        setSuccess(false);
        setProgress({ page: 0, total: 0 });
        setCurrentFileIdx(null);
        setDocuments({});
        setActiveDocName('');
        addLog('Workspace cleared on both backend and frontend.');
      } else {
        throw new Error('Failed to clear backend workspace data.');
      }
    } catch (err) {
      setError(err.message);
      addLog(`Clear error: ${err.message}`, 'error');
    }
  };

  const addLog = async (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }]);
    try {
      await fetch(getBackendUrl('/api/save-log'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, type, timestamp })
      });
    } catch (err) {
      console.error('Failed to save log to backend:', err);
    }
  };

  const processQueue = async () => {
    if (queue.length === 0) return;

    setLoading(true);
    setError(null);
    setSuccess(false);
    setLogs([]);

    addLog(`Starting queue transcription for ${queue.length} document(s)...`);
    addLog(`DPI configured to: ${dpi}`);

    // Update status of all pending items
    setQueue((prev) =>
      prev.map((item) =>
        item.status === 'pending' ? { ...item, error: null } : item
      )
    );

    let completedCount = 0;

    for (let i = 0; i < queue.length; i++) {
      const currentItem = queue[i];
      if (currentItem.status === 'success') {
        completedCount++;
        continue;
      }
      setCurrentFileIdx(i);
      
      setQueue((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'processing' } : item))
      );

      addLog(`[File ${i + 1}/${queue.length}] Starting OCR for: ${currentItem.file.name}`, 'warning');

      const formData = new FormData();
      formData.append('filename', currentItem.file.name);
      formData.append('dpi', dpi.toString());

      try {
        const response = await fetch(getBackendUrl('/api/ocr'), {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || 'OCR request failed.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        addLog(`Connected to OCR engine for ${currentItem.file.name}...`);

        // Clear existing markdown for this file to start fresh
        const filename = currentItem.file.name;
        setDocuments((prevDocs) => ({
          ...prevDocs,
          [filename]: { markdown: '', imageMappings: {} }
        }));

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              let data = null;
              try {
                data = JSON.parse(trimmedLine.slice(6));
              } catch (err) {
                console.error('Failed to parse SSE line:', line, err);
              }
              
              if (data) {
                if (data.status === 'processing') {
                   setProgress({ page: data.page, total: data.total });
                   setQueue((prev) =>
                     prev.map((item, idx) =>
                       idx === i ? { ...item, progress: { page: data.page, total: data.total } } : item
                     )
                   );
                } else if (data.status === 'success') {
                  addLog(`Transcribed page ${data.page} of ${data.total} for ${currentItem.file.name}...`, 'info');
                  
                  setDocuments((prevDocs) => {
                    const doc = prevDocs[filename] || { markdown: '', imageMappings: {} };
                    const separator = doc.markdown ? '\n\n---\n\n' : '';
                    const updatedDocs = {
                      ...prevDocs,
                      [filename]: {
                        ...doc,
                        markdown: doc.markdown + separator + data.content
                      }
                    };
                    return updatedDocs;
                  });
                  setActiveDocName((currentActive) => currentActive || filename);
                } else if (data.status === 'error') {
                  throw new Error(`Failed on page ${data.page}: ${data.error}`);
                }
              }
            }
          }
        }

        // Validate that we actually received some content before marking as successful
        setDocuments((currentDocs) => {
          const doc = currentDocs[filename];
          if (!doc || !doc.markdown || doc.markdown.trim() === "") {
            addLog(`Validation failed: No transcribed text received for ${filename}`, 'error');
            setQueue((prev) =>
              prev.map((item, idx) => (idx === i ? { ...item, status: 'error', error: 'Empty response from transcription engine.' } : item))
            );
          } else {
            setQueue((prev) =>
              prev.map((item, idx) => (idx === i ? { ...item, status: 'success' } : item))
            );
            addLog(`Transcribed ${filename} successfully!`, 'success');
            completedCount++;
          }
          return currentDocs;
        });

      } catch (err) {
        addLog(`Error processing ${currentItem.file.name}: ${err.message}`, 'error');
        setQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: 'error', error: err.message } : item))
        );
      }
    }

    setCurrentFileIdx(null);
    setLoading(false);
    setProgress({ page: 0, total: 0 });

    if (completedCount === queue.length) {
      addLog('All files in the queue have been processed successfully!', 'success');
      setSuccess(true);
    } else {
      addLog(`Queue processing completed. ${completedCount} of ${queue.length} files succeeded. Check log for details.`, 'warning');
      setSuccess(completedCount > 0);
    }
  };

  const downloadMarkdown = () => {
    const filename = currentFileIdx !== null ? queue[currentFileIdx]?.file?.name : (queue.length > 0 ? queue[0]?.file?.name : null);
    if (!filename) return;
    const doc = documents[filename];
    if (!doc || !doc.markdown) return;

    const blob = new Blob([doc.markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename.replace('.pdf', '_clean.md'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeDocNameLocal = currentFileIdx !== null ? queue[currentFileIdx]?.file?.name : (queue.length > 0 ? queue[0]?.file?.name : null);
  const activeDocContent = activeDocNameLocal ? (documents[activeDocNameLocal]?.markdown || '') : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 text-slate-800">
      {/* Settings & Queue Management */}
      <div className="lg:col-span-1 flex flex-col gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-5">
          <h2 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-3 uppercase tracking-wider flex justify-between items-center">
            <span>1. PDF File Queue</span>
            {queue.length > 0 && (
              <button
                onClick={clearQueue}
                className="text-[10px] text-red-500 hover:underline uppercase font-bold tracking-wider"
                disabled={loading}
              >
                Clear Queue
              </button>
            )}
          </h2>

          {/* Multi-File Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Add PDF Files to Queue</label>
            <div className="border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-xl p-6 transition-all bg-slate-50 flex flex-col items-center justify-center text-center relative cursor-pointer group">
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
                disabled={loading}
              />
              <Upload className="w-8 h-8 text-slate-400 group-hover:text-slate-500 transition-colors mb-3" />
              <div>
                <p className="text-sm font-medium text-slate-600">Select PDF Files</p>
                <p className="text-xs text-slate-400 mt-1">multiple selection supported</p>
              </div>
            </div>
          </div>

          {/* File Queue List */}
          {queue.length > 0 && (
            <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Queue List ({queue.length} files)</span>
              <div className="flex flex-col gap-1.5">
                {queue.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${
                      currentFileIdx === idx
                        ? 'border-indigo-200 bg-indigo-50/50'
                        : item.status === 'success'
                        ? 'border-emerald-100 bg-emerald-50/30'
                        : item.status === 'error'
                        ? 'border-red-100 bg-red-50/30'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      <FileText className={`w-4 h-4 shrink-0 ${currentFileIdx === idx ? 'text-indigo-500' : 'text-slate-400'}`} />
                      <span className="truncate font-medium text-slate-700">{item.file.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'uploading' && (
                        <span className="text-[9px] font-bold text-indigo-500 animate-pulse uppercase">Uploading</span>
                      )}
                      {item.status === 'pending' && !loading && (
                        <button
                          onClick={() => removeQueueItem(item.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {item.status === 'pending' && loading && (
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Wait</span>
                      )}
                      {item.status === 'processing' && (
                        <span className="text-[9px] font-bold text-indigo-600 animate-pulse uppercase">
                          Page {item.progress.page}/{item.progress.total || '?'}
                        </span>
                      )}
                      {item.status === 'success' && (
                        <span className="text-[9px] font-bold text-emerald-600 uppercase">Done</span>
                      )}
                      {item.status === 'error' && (
                        <span className="text-[9px] font-bold text-red-500 uppercase" title={item.error}>Error</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DPI Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Extraction Resolution (DPI)</label>
            <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-lg border border-slate-200">
              {[150, 300, 400].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDpi(d)}
                  disabled={loading}
                  className={`py-1.5 rounded-md text-xs font-bold transition-all ${
                    dpi === d
                      ? 'bg-white text-slate-800 border border-slate-200 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {d} DPI
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2">
            {!loading && !success ? (
              <button
                onClick={processQueue}
                disabled={queue.length === 0}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Queue Processing
              </button>
            ) : loading ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-semibold text-slate-500">
                  <span>Processing queue item {currentFileIdx + 1} of {queue.length}...</span>
                  <span>{progress.page} / {progress.total}</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-slate-800 h-full transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.page / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  onClick={onComplete}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                  Proceed to Edit Mode
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={clearQueue}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 py-2.5 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-xs uppercase tracking-wider"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear & Reset OCR
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex gap-3 items-start shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-semibold">Pipeline Execution Failed:</span>
              <p className="mt-1 opacity-90">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Log Feed & Preview Card */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        {/* Terminal Logs */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex-1 flex flex-col min-h-[300px] max-h-[400px] overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center shrink-0 bg-slate-50">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              <span className="text-xs font-mono text-slate-500 ml-2">pipeline_console.log</span>
            </div>
            {success && (
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ready
              </span>
            )}
          </div>
          <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-slate-300 bg-slate-900 flex flex-col gap-2">
            {logs.length === 0 ? (
              <span className="text-slate-600">Console idle. Add files and start queue processing...</span>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="leading-relaxed">
                  <span className="text-slate-500">[{log.timestamp}]</span>{' '}
                  <span
                    className={
                      log.type === 'error'
                        ? 'text-red-400 font-semibold'
                        : log.type === 'success'
                        ? 'text-emerald-400 font-semibold'
                        : log.type === 'warning'
                        ? 'text-sky-400'
                        : 'text-slate-300'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Live Output Preview */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col gap-4 flex-1">
          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Transcribed Output (Markdown)</h3>
            </div>
            {activeDocContent && (
              <button
                onClick={downloadMarkdown}
                className="text-xs font-bold text-slate-600 hover:text-slate-800 underline transition-colors"
              >
                Download Markdown (.md)
              </button>
            )}
          </div>
          <textarea
            readOnly
            value={activeDocContent}
            placeholder="Clean transcribed study content will stream here in real-time..."
            className="w-full flex-1 min-h-[250px] p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-700 resize-none outline-none focus:border-slate-300"
          />
        </div>
      </div>
    </div>
  );
}

export default OCRMode;
