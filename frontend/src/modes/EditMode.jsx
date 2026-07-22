import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Image as ImageIcon, Upload, Trash2, Maximize, FileDown, AlertCircle } from 'lucide-react';

function EditMode({ documents, setDocuments, activeDocName, setActiveDocName }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const docNames = Object.keys(documents);
  const currentDoc = documents[activeDocName] || { markdown: '', imageMappings: {} };
  const markdown = currentDoc.markdown;
  const imageMappings = currentDoc.imageMappings;

  const setMarkdown = (newMarkdown) => {
    if (!activeDocName) return;
    setDocuments((prev) => ({
      ...prev,
      [activeDocName]: {
        ...prev[activeDocName],
        markdown: newMarkdown
      }
    }));
  };

  const setImageMappings = (updater) => {
    if (!activeDocName) return;
    setDocuments((prev) => {
      const doc = prev[activeDocName] || { markdown: '', imageMappings: {} };
      const nextMappings = typeof updater === 'function' ? updater(doc.imageMappings) : updater;
      return {
        ...prev,
        [activeDocName]: {
          ...doc,
          imageMappings: nextMappings
        }
      };
    });
  };

  // Helper to parse markdown and extract placeholders
  const parseMarkdownWithPlaceholders = (text) => {
    const regex = /\[IMAGE_PLACEHOLDER_(\d+):\s*([^\]]+)\]/g;
    const elements = [];
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        elements.push({
          type: 'text',
          content: text.substring(lastIndex, matchIndex)
        });
      }
      
      elements.push({
        type: 'placeholder',
        id: match[1],
        label: match[2],
        raw: match[0]
      });
      
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < text.length) {
      elements.push({
        type: 'text',
        content: text.substring(lastIndex)
      });
    }
    
    return elements.length > 0 ? elements : [{ type: 'text', content: text }];
  };

  const handleImageUpload = async (id, file) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/api/upload-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image.');
      }

      const data = await response.json();
      
      // Update mappings
      setImageMappings((prev) => ({
        ...prev,
        [id]: {
          url: data.url,
          filename: data.filename,
          size: prev[id]?.size || 'medium',
          customWidth: prev[id]?.customWidth || '',
          customHeight: prev[id]?.customHeight || ''
        }
      }));
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    }
  };

  const removeImage = (id, label) => {
    // Escape regex characters in label
    const escapedLabel = (label || '').replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    // Match the placeholder tag and remove it (including newlines around it if any)
    const regex = new RegExp(`\\s*\\[IMAGE_PLACEHOLDER_${id}:\\s*${escapedLabel}\\]\\s*`, 'g');
    const newMarkdown = markdown.replace(regex, '\n\n');
    setMarkdown(newMarkdown.trim());

    setImageMappings((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });
  };

  const updateImageSettings = (id, field, value) => {
    setImageMappings((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value
      }
    }));
  };

  const triggerPDFExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:8000/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown,
          image_mappings: imageMappings
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'PDF generation failed.');
      }

      // Convert to blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'published_material.pdf');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const downloadRawMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'document_state.md');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const insertAfterText = (targetText, type) => {
    if (!targetText) return;
    const trimmedTarget = targetText.trim();
    if (!trimmedTarget) return;

    // Locate the target text in raw markdown
    const index = markdown.indexOf(trimmedTarget);
    if (index !== -1) {
      const insertPos = index + trimmedTarget.length;
      let insertion = '';
      if (type === 'image') {
        // Find next sequential placeholder number
        const regex = /\[IMAGE_PLACEHOLDER_(\d+):/g;
        let match;
        let maxId = 0;
        while ((match = regex.exec(markdown)) !== null) {
          maxId = Math.max(maxId, parseInt(match[1]));
        }
        insertion = `\n\n[IMAGE_PLACEHOLDER_${maxId + 1}: new_image_label]\n\n`;
      } else if (type === 'pagebreak') {
        insertion = `\n\n---\n\n`;
      }
      
      const newMarkdown = markdown.slice(0, insertPos) + insertion + markdown.slice(insertPos);
      setMarkdown(newMarkdown.replace(/\n{3,}/g, '\n\n'));
    }
  };

  // Helper to construct interactive hover components
  const createInteractiveComponent = (Tag) => ({ children, ...props }) => {
    const textContent = React.Children.toArray(children)
      .map(child => typeof child === 'string' ? child : '')
      .join('')
      .trim();

    return (
      <div className="group relative">
        <Tag {...props}>{children}</Tag>
        {textContent && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 hidden group-hover:flex items-center gap-1 bg-slate-800 border border-slate-700 p-1 rounded shadow-md z-20 no-print select-none text-[10px] font-sans">
            <button
              onClick={() => insertAfterText(textContent, 'image')}
              title="Insert Image Placeholder"
              className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-650 text-white rounded font-bold cursor-pointer transition-colors"
            >
              + Image
            </button>
            <button
              onClick={() => insertAfterText(textContent, 'pagebreak')}
              title="Insert Page Break (---)"
              className="px-1.5 py-0.5 bg-slate-500 hover:bg-slate-400 text-white rounded font-bold cursor-pointer transition-colors"
            >
              + Page
            </button>
          </div>
        )}
      </div>
    );
  };

  // Split markdown into pages based on page breaks (---)
  const pages = markdown.split(/\n---\r?\n|\n---\n/);

  return (
    <div className="flex flex-col gap-4 flex-1 text-slate-850">
      {/* Top Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-3 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">Publishing Workbench</span>
          </div>

          <div className="h-5 w-px bg-slate-200"></div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Document:</span>
            {docNames.length === 0 ? (
              <span className="text-xs text-slate-400 italic">No documents loaded</span>
            ) : (
              <select
                value={activeDocName}
                onChange={(e) => setActiveDocName(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-850 p-1.5 rounded-lg text-xs font-bold outline-none focus:border-slate-350 max-w-[200px] truncate"
              >
                {docNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeDocName && (
            <button
              onClick={() => {
                if (window.confirm(`Are you sure you want to clear the contents and images of "${activeDocName}"?`)) {
                  setMarkdown('');
                  setImageMappings({});
                }
              }}
              className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Clear Current Doc
            </button>
          )}
          <label className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold py-2 px-4 rounded-lg transition-colors cursor-pointer select-none text-center">
            Import Markdown
            <input
              type="file"
              accept=".md,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (evt) => {
                    const filename = file.name;
                    setDocuments((prev) => ({
                      ...prev,
                      [filename]: {
                        markdown: evt.target.result,
                        imageMappings: {}
                      }
                    }));
                    setActiveDocName(filename);
                  };
                  reader.readAsText(file);
                }
              }}
              className="hidden"
            />
          </label>
          <button
            onClick={downloadRawMarkdown}
            disabled={!markdown}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Download Markdown (.md)
          </button>
          <button
            onClick={triggerPDFExport}
            disabled={exporting || !markdown}
            className="bg-slate-800 hover:bg-slate-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-bold py-2 px-5 rounded-lg flex items-center gap-2 transition-all shadow-sm"
          >
            <FileDown className="w-4 h-4" />
            {exporting ? 'Generating PDF...' : 'Export as PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex gap-3 items-center shadow-sm">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <span className="text-xs font-medium">Export Error: {error}</span>
        </div>
      )}

      {/* Editor & Preview Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-[500px]">
        {/* Left: Raw Markdown Editor */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800 shrink-0 uppercase tracking-wider">Markdown Editor</h3>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="Type or paste your Markdown here. Insert placeholders like [IMAGE_PLACEHOLDER_1: description] to add image placement controls..."
            className="w-full flex-1 min-h-[400px] p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm text-slate-800 resize-none outline-none focus:border-slate-300"
          />
        </div>

        {/* Right: Live Preview Panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 shadow-sm max-h-[700px] overflow-hidden">
          <h3 className="text-sm font-bold text-slate-800 shrink-0 uppercase tracking-wider">Live Document Preview</h3>
          
          {/* Simulated paper backing container */}
          <div className="w-full flex-1 overflow-y-auto bg-slate-100 p-4 rounded-xl border border-slate-200 flex flex-col items-center gap-6">
            {pages.map((pageContent, pageIdx) => {
              const renderedElements = parseMarkdownWithPlaceholders(pageContent);
              return (
                <div 
                  key={pageIdx} 
                  className="bg-white text-slate-800 w-full max-w-[210mm] min-h-[297mm] h-auto shrink-0 p-10 md:p-12 shadow-2xl border border-slate-200 box-border font-sans leading-relaxed text-sm select-text text-left relative"
                >
                  {/* Page Indicator */}
                  <div className="absolute top-3 right-4 text-[10px] text-slate-400 font-sans select-none no-print">
                    Page {pageIdx + 1}
                  </div>

                  {/* CSS rules for nested markdown elements to match PDF exactly */}
                  <style>{`
                    .preview-container h1, .preview-container h2, .preview-container h3, .preview-container h4 {
                      color: #0f172a;
                      font-weight: 700;
                      margin-top: 18pt;
                      margin-bottom: 6pt;
                      letter-spacing: -0.01em;
                    }
                     .preview-container h1 {
                      font-size: 16pt;
                      border-bottom: 2pt solid #0f172a;
                      padding-bottom: 6pt;
                      margin-top: 0;
                      color: #0f172a;
                    }
                    .preview-container h2 {
                      font-size: 13pt;
                      border-bottom: 1pt solid #e2e8f0;
                      padding-bottom: 4pt;
                      color: #0f172a;
                    }
                    .preview-container h3 {
                      font-size: 11pt;
                      color: #16a34a;
                    }
                    .preview-container p {
                      margin-top: 0;
                      margin-bottom: 8pt;
                      color: #334155;
                    }
                    .preview-container ul, .preview-container ol {
                      margin-top: 0;
                      margin-bottom: 10pt;
                      padding-left: 20pt;
                    }
                    .preview-container li {
                      margin-bottom: 4pt;
                      color: #334155;
                    }
                    .preview-container table {
                      width: 100%;
                      border-collapse: collapse;
                      margin: 15pt 0;
                      font-size: 9pt;
                      border: 1px solid #e2e8f0;
                      border-radius: 4px;
                      overflow: hidden;
                    }
                    .preview-container th, .preview-container td {
                      padding: 6pt 10pt;
                      text-align: left;
                    }
                    .preview-container th {
                      background-color: #f8fafc;
                      color: #1e293b;
                      font-weight: 600;
                      border-bottom: 2px solid #e2e8f0;
                      text-transform: uppercase;
                      font-size: 8pt;
                      letter-spacing: 0.05em;
                    }
                    .preview-container td {
                      border-bottom: 1px solid #f1f5f9;
                      color: #475569;
                    }
                    .preview-container tr:nth-child(even) {
                      background-color: #f8fafc;
                    }
                    .preview-container blockquote {
                      margin: 15pt 0;
                      padding: 10pt 12pt;
                      background-color: #f8fafc;
                      border-left: 3.5pt solid #94a3b8;
                      color: #475569;
                      border-radius: 0 4pt 4pt 0;
                      font-style: italic;
                    }
                  `}</style>

                  <div className="preview-container">
                    {renderedElements.map((el, idx) => {
                      if (el.type === 'text') {
                        return (
                          <div key={idx} className="mb-4">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              components={{
                                p: createInteractiveComponent('p'),
                                h1: createInteractiveComponent('h1'),
                                h2: createInteractiveComponent('h2'),
                                h3: createInteractiveComponent('h3'),
                                li: createInteractiveComponent('li'),
                              }}
                            >
                              {el.content}
                            </ReactMarkdown>
                          </div>
                        );
                      } else if (el.type === 'placeholder') {
                        const mapping = imageMappings[el.id];
                        
                        let imgStyle = { maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' };
                        if (mapping) {
                          if (mapping.size === 'small') {
                            imgStyle = { ...imgStyle, width: '30%', maxWidth: '200px' };
                          } else if (mapping.size === 'medium') {
                            imgStyle = { ...imgStyle, width: '60%', maxWidth: '400px' };
                          } else if (mapping.size === 'large') {
                            imgStyle = { ...imgStyle, width: '100%' };
                          } else if (mapping.size === 'custom') {
                            if (mapping.customWidth) imgStyle.width = mapping.customWidth;
                            if (mapping.customHeight) imgStyle.height = mapping.customHeight;
                          }
                        }

                        return (
                          <div key={idx} className="my-6 border rounded-lg overflow-hidden border-indigo-200 bg-indigo-50/50 p-4 font-sans no-print">
                            {/* Placeholder Header */}
                            <div className="flex justify-between items-center border-b border-indigo-100 pb-2 mb-3">
                              <div className="flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-indigo-500" />
                                <span className="text-xs font-bold text-indigo-700">IMAGE PLACEHOLDER {el.id}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-indigo-500 italic">{el.label}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeImage(el.id, el.label);
                                  }}
                                  title="Delete Placeholder from document"
                                  className="text-indigo-400 hover:text-red-500 transition-colors p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Image Preview / Upload Button */}
                            {mapping?.url ? (
                              <div className="flex flex-col gap-4">
                                <div className="border border-slate-200 bg-white p-2 rounded relative group">
                                  <img src={mapping.url} style={imgStyle} alt={el.label} />
                                </div>

                                <div className="flex flex-wrap gap-4 items-center justify-between bg-white border border-indigo-100 p-3 rounded-lg text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-700">Size:</span>
                                    <select
                                      value={mapping.size}
                                      onChange={(e) => updateImageSettings(el.id, 'size', e.target.value)}
                                      className="bg-slate-50 border border-slate-200 p-1.5 rounded outline-none text-slate-700"
                                    >
                                      <option value="small">Small (30%)</option>
                                      <option value="medium">Medium (60%)</option>
                                      <option value="large">Large (100%)</option>
                                      <option value="custom">Custom Dimensions</option>
                                    </select>
                                  </div>

                                  {mapping.size === 'custom' && (
                                    <div className="flex gap-2 items-center">
                                      <input
                                        type="text"
                                        placeholder="Width"
                                        value={mapping.customWidth}
                                        onChange={(e) => updateImageSettings(el.id, 'customWidth', e.target.value)}
                                        className="bg-slate-50 border border-slate-200 p-1.5 rounded w-24 outline-none"
                                      />
                                      <input
                                        type="text"
                                        placeholder="Height"
                                        value={mapping.customHeight}
                                        onChange={(e) => updateImageSettings(el.id, 'customHeight', e.target.value)}
                                        className="bg-slate-50 border border-slate-200 p-1.5 rounded w-24 outline-none"
                                      />
                                    </div>
                                  )}

                                  <div className="text-[10px] text-slate-400 italic ml-auto">
                                    Image uploaded
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="border border-dashed border-indigo-300 bg-indigo-50/20 rounded-lg p-5 flex flex-col items-center justify-center text-center relative cursor-pointer hover:bg-indigo-50/60 transition-all">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                      handleImageUpload(el.id, e.target.files[0]);
                                    }
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer"
                                />
                                <Upload className="w-6 h-6 text-indigo-400 mb-2" />
                                <span className="text-xs font-semibold text-indigo-700">Click to upload image</span>
                                <span className="text-[10px] text-slate-500 mt-1">PNG, JPG, JPEG</span>
                              </div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditMode;
