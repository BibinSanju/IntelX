import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { 
  AlertCircle, CheckCircle, Clock, Plus, Download, Trash2, 
  Eye, CheckSquare, Square, X, RefreshCw, Layers, FileCode 
} from 'lucide-react';
import './Staging.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

interface StagedQuestion {
  id: string;
  rawText: string;
  title: string | null;
  description: string | null;
  category: string | null;
  subtopic: string | null;
  constraints?: string | null;
  status: string;
  source: string;
  createdAt: string;
  testCases?: Array<{ input: string; expectedOutput?: string; output?: string }>;
  sandboxVerdict?: string | null;
}

export default function Staging() {
  const [questions, setQuestions] = useState<StagedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('ALL');

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Ingest Modal state
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [source, setSource] = useState('Student Interview');
  const [isIngesting, setIsIngesting] = useState(false);

  // Inspector Modal state
  const [inspectingQuestion, setInspectingQuestion] = useState<StagedQuestion | null>(null);

  const fetchStaged = async () => {
    try {
      setLoading(true);
      const url = activeTab === 'ALL' ? `${API_BASE}/api/staged` : `${API_BASE}/api/staged?status=${activeTab}`;
      const res = await axios.get(url);
      if (res.data.success) {
        setQuestions(res.data.data);
      }
    } catch (err: any) {
      setError('Failed to fetch staged questions. Ensure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaged();
  }, [activeTab]);

  const handleApprove = async (id: string) => {
    try {
      await axios.post(`${API_BASE}/api/staged/${id}/approve`);
      setQuestions(q => q.filter(x => x.id !== id));
      if (inspectingQuestion?.id === id) setInspectingQuestion(null);
    } catch (err) {
      alert('Failed to approve question');
    }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm('Are you sure you want to discard this question?')) return;
    try {
      await axios.delete(`${API_BASE}/api/staged/${id}`);
      setQuestions(q => q.filter(x => x.id !== id));
      if (inspectingQuestion?.id === id) setInspectingQuestion(null);
    } catch (err) {
      alert('Failed to discard question');
    }
  };

  // Bulk operations
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map(q => q.id)));
    }
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await axios.post(`${API_BASE}/api/staged/${id}/approve`).catch(() => {});
    }
    setSelectedIds(new Set());
    fetchStaged();
  };

  const handleBulkDiscard = async () => {
    if (!confirm(`Discard all ${selectedIds.size} selected questions?`)) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await axios.delete(`${API_BASE}/api/staged/${id}`).catch(() => {});
    }
    setSelectedIds(new Set());
    fetchStaged();
  };

  const handleExportXml = async (ids?: string[]) => {
    const targetIds = ids || Array.from(selectedIds);
    try {
      const res = await axios.post(`${API_BASE}/api/staged/export-xml`, { questionIds: targetIds }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'moodle_coderunner_export.xml');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Failed to export Moodle XML');
    }
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    try {
      setIsIngesting(true);
      const res = await axios.post(`${API_BASE}/api/ingest`, {
        raw_text: rawText,
        source: source
      });
      if (res.data.success) {
        setRawText('');
        setIsIngestModalOpen(false);
        fetchStaged();
      }
    } catch (err) {
      alert('Failed to ingest question');
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div className="container staging-container animate-fade-in">
      {/* Header */}
      <div className="staging-header flex-between">
        <div>
          <h1 className="page-title text-gradient">Faculty Staging & Curation</h1>
          <p className="page-subtitle">Review AI-curated questions, verify 10 test cases, and package to Moodle LMS XML.</p>
        </div>

        <div className="header-actions flex gap-3">
          <button className="btn-secondary flex-center" onClick={fetchStaged}>
            <RefreshCw size={16} style={{ marginRight: '6px' }} />
            Refresh
          </button>
          <button className="btn-primary flex-center" onClick={() => setIsIngestModalOpen(true)}>
            <Plus size={16} style={{ marginRight: '6px' }} />
            Ingest Raw Prompt
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="staging-tabs flex gap-2">
        {['ALL', 'STAGED', 'PENDING_AI', 'DUPLICATE_FOUND', 'FAILED_SANDBOX'].map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar glass-panel flex-between animate-fade-in">
          <div className="selected-count flex-center">
            <span className="font-semibold">{selectedIds.size} questions selected</span>
          </div>
          <div className="bulk-buttons flex gap-2">
            <button className="btn-secondary btn-sm flex-center" onClick={() => handleExportXml()}>
              <Download size={14} style={{ marginRight: '6px' }} />
              Export Selected to Moodle XML
            </button>
            <button className="btn-approve btn-sm flex-center" onClick={handleBulkApprove}>
              <CheckCircle size={14} style={{ marginRight: '6px' }} />
              Approve Selected
            </button>
            <button className="btn-delete btn-sm flex-center" onClick={handleBulkDiscard}>
              <Trash2 size={14} style={{ marginRight: '6px' }} />
              Discard Selected
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner flex-center">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Questions Grid */}
      {loading ? (
        <div className="loading-state flex-center">
          <div className="spinner"></div>
          <span>Loading staging queue...</span>
        </div>
      ) : questions.length === 0 ? (
        <div className="empty-state glass-panel">No questions found for this status.</div>
      ) : (
        <div className="staged-grid">
          <div className="select-all-header flex items-center gap-2 mb-2">
            <button className="flex-center text-sm text-muted cursor-pointer" onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
              {selectedIds.size === questions.length ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
              <span style={{ marginLeft: '8px' }}>Select All ({questions.length})</span>
            </button>
          </div>

          {questions.map((q) => {
            const isSelected = selectedIds.has(q.id);
            return (
              <div key={q.id} data-id={q.id} className={`staged-card status-${q.status} ${isSelected ? 'selected' : ''}`}>
                <div className="card-top flex-between">
                  <div className="flex items-center gap-3">
                    <button 
                      className="checkbox-btn"
                      onClick={() => toggleSelect(q.id)}
                    >
                      {isSelected ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                    </button>
                    <h3>{q.title || 'Untitled Question'}</h3>
                  </div>

                  <div className="staged-badges flex gap-2">
                    <span className={`badge badge-${q.status.toLowerCase()}`}>{q.status}</span>
                    {q.sandboxVerdict && (
                      <span className="badge badge-success flex-center">
                        <CheckCircle size={12} style={{ marginRight: '4px' }} />
                        {q.sandboxVerdict}
                      </span>
                    )}
                  </div>
                </div>

                <div className="staged-meta">
                  <span>Source: <strong>{q.source}</strong></span>
                  <span>Taxonomy: <strong>{q.category || 'DSA'} &gt; {q.subtopic || 'General'}</strong></span>
                  <span>Test Cases: <strong>{q.testCases?.length || 0}/10 Verified</strong></span>
                  <span>{new Date(q.createdAt).toLocaleString()}</span>
                </div>

                <p className="raw-snippet">{q.rawText}</p>

                <div className="staged-actions flex-between mt-4">
                  <button 
                    className="btn-secondary btn-sm flex-center"
                    onClick={() => setInspectingQuestion(q)}
                  >
                    <Eye size={14} style={{ marginRight: '6px' }} />
                    Inspect Testcases &amp; Diff
                  </button>

                  <div className="flex gap-2">
                    <button 
                      className="btn-secondary btn-sm flex-center"
                      onClick={() => handleExportXml([q.id])}
                    >
                      <Download size={14} style={{ marginRight: '6px' }} />
                      Moodle XML
                    </button>
                    <button 
                      className="btn-approve btn-sm flex-center" 
                      onClick={() => handleApprove(q.id)}
                    >
                      <CheckCircle size={14} style={{ marginRight: '6px' }} />
                      Approve to Live
                    </button>
                    <button 
                      className="btn-delete btn-sm" 
                      onClick={() => handleDiscard(q.id)}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ingest Modal */}
      {isIngestModalOpen && (
        <div className="modal-overlay flex-center animate-fade-in">
          <div className="modal-card glass-panel">
            <div className="modal-header flex-between">
              <h2>Ingest Raw Interview Prompt</h2>
              <button className="close-btn" onClick={() => setIsIngestModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleIngestSubmit}>
              <div className="form-group mb-4">
                <label className="block text-sm font-semibold mb-2">Source Type</label>
                <select 
                  className="input-field" 
                  value={source} 
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="Student Interview">Student Interview Memory</option>
                  <option value="Faculty Note">Faculty Curated Problem</option>
                  <option value="Online Contest">Online Contest Scraping</option>
                  <option value="Audio Transcription">Audio / Voice Note Transcript</option>
                </select>
              </div>

              <div className="form-group mb-4">
                <label className="block text-sm font-semibold mb-2">Raw Question Statement</label>
                <textarea 
                  className="input-field textarea-field" 
                  rows={6}
                  placeholder="Paste unformatted question text, memory from an Amazon/Google interview, or rough notes..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  required
                />
              </div>

              <div className="modal-footer flex-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setIsIngestModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isIngesting}>
                  {isIngesting ? 'Ingesting & Processing...' : 'Start Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Side-by-Side Testcase Inspector Modal */}
      {inspectingQuestion && (
        <div className="modal-overlay flex-center animate-fade-in">
          <div className="modal-card inspector-modal glass-panel">
            <div className="modal-header flex-between">
              <div>
                <h2>{inspectingQuestion.title || 'Untitled'}</h2>
                <div className="text-xs text-muted mt-1">
                  Taxonomy: <code>$course$/top/{inspectingQuestion.category || 'DSA'}/{inspectingQuestion.subtopic || 'General'}</code>
                </div>
              </div>
              <button className="close-btn" onClick={() => setInspectingQuestion(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="inspector-body flex gap-4">
              {/* Left Column: Problem Description & Constraints */}
              <div className="inspector-left flex-1 glass-panel p-4">
                <h3 className="section-title">Problem Statement</h3>
                <div 
                  className="problem-description text-sm" 
                  dangerouslySetInnerHTML={{ __html: inspectingQuestion.description || inspectingQuestion.rawText }}
                />
                {inspectingQuestion.constraints && (
                  <div className="mt-4 pt-3 border-t border-gray-800">
                    <h4 className="text-xs font-semibold text-muted mb-1">Constraints</h4>
                    <div dangerouslySetInnerHTML={{ __html: inspectingQuestion.constraints }} />
                  </div>
                )}
              </div>

              {/* Right Column: 10 Standard I/O Test Cases */}
              <div className="inspector-right flex-1 glass-panel p-4">
                <h3 className="section-title flex-between">
                  <span>10 Standard I/O Test Cases</span>
                  <span className="badge badge-success">{inspectingQuestion.sandboxVerdict || 'Verified'}</span>
                </h3>
                <div className="testcase-list">
                  {inspectingQuestion.testCases && inspectingQuestion.testCases.length > 0 ? (
                    inspectingQuestion.testCases.map((tc, idx) => (
                      <div key={idx} className="tc-box glass-panel p-3 mb-2 rounded text-xs">
                        <div className="tc-label flex-between font-semibold mb-1">
                          <span>Case {idx + 1} {idx < 3 ? '(Sample)' : idx < 7 ? '(Edge)' : '(Stress)'}</span>
                        </div>
                        <div className="tc-io">
                          <div className="mb-1"><strong>stdin:</strong> <pre className="bg-black p-1.5 rounded mt-0.5">{tc.input || '<em>(empty)</em>'}</pre></div>
                          <div><strong>stdout:</strong> <pre className="bg-black p-1.5 rounded mt-0.5">{tc.expectedOutput ?? tc.output ?? ''}</pre></div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-muted text-sm italic">No test cases generated yet.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer flex-between mt-4 pt-3 border-t border-gray-800">
              <button className="btn-secondary btn-sm" onClick={() => handleExportXml([inspectingQuestion.id])}>
                <Download size={14} style={{ marginRight: '6px' }} />
                Export this Moodle XML
              </button>
              <div className="flex gap-2">
                <button className="btn-delete btn-sm" onClick={() => handleDiscard(inspectingQuestion.id)}>
                  Discard
                </button>
                <button className="btn-approve btn-sm" onClick={() => handleApprove(inspectingQuestion.id)}>
                  Approve &amp; Publish
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
