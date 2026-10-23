import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { 
  AlertCircle, CheckCircle, Clock, Plus, Download, Trash2, 
  Eye, CheckSquare, Square, X, RefreshCw, Layers, FileCode,
  Mic, UploadCloud, Loader2, Sparkles 
} from 'lucide-react';
import './Staging.css';
import { API_BASE } from '../config';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

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
  inputTags?: string[];
  inputHints?: string[];
  sourceUrl?: string | null;
  sourceMetadata?: { content_type?: string; contentType?: string } | null;
  enrichment?: {
    status?: string;
    confidence?: number;
    contentType?: string;
    metadata?: {
      detailed_answer?: string;
      concise_answer?: string;
      expected_keywords?: string[];
      expected_concepts?: string[];
      scoring_rubric?: { max_score?: number; criteria?: string[] };
    };
    question?: { title?: string; url?: string };
  } | null;
  testCases?: Array<{ input: string; expectedOutput?: string; output?: string }>;
  sandboxVerdict?: string | null;
}

const isTheoryQuestion = (question: StagedQuestion) =>
  question.sourceMetadata?.content_type === 'theory'
  || question.sourceMetadata?.contentType === 'theory'
  || question.enrichment?.contentType === 'theory';

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
  const [tags, setTags] = useState('');
  const [hints, setHints] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [sttFeedback, setSttFeedback] = useState<string | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // Audio Recorder Hook for Faculty Ingest Modal
  const {
    isRecording,
    isTranscribing,
    formattedDuration,
    error: audioError,
    startRecording,
    stopRecording,
    cancelRecording,
    transcribeFile,
  } = useAudioRecorder();

  // Inspector Modal state
  const [inspectingQuestion, setInspectingQuestion] = useState<StagedQuestion | null>(null);

  // Prevent background scrolling and enable Escape key dismiss when any modal is open
  useEffect(() => {
    if (inspectingQuestion || isIngestModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setInspectingQuestion(null);
          setIsIngestModalOpen(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [inspectingQuestion, isIngestModalOpen]);

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
        source,
        tags,
        hints
      });
      if (res.data.success) {
        setRawText('');
        setTags('');
        setHints('');
        setIsIngestModalOpen(false);
        fetchStaged();
      }
    } catch (err) {
      alert('Failed to ingest question');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleStopRecording = async () => {
    const text = await stopRecording();
    if (text) {
      setRawText(prev => prev.trim() ? `${prev}\n\n${text}` : text);
      setSource('Audio Transcription');
      setSttFeedback('Transcribed via Groq Whisper!');
      setTimeout(() => setSttFeedback(null), 4000);
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await transcribeFile(file);
    if (text) {
      setRawText(prev => prev.trim() ? `${prev}\n\n${text}` : text);
      setSource('Audio Transcription');
      setSttFeedback(`Transcribed "${file.name}" via Groq Whisper!`);
      setTimeout(() => setSttFeedback(null), 4000);
    }
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = '';
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

        <div className="header-actions">
          <button className="staging-action-btn secondary" onClick={fetchStaged}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
          <button className="staging-action-btn primary" onClick={() => setIsIngestModalOpen(true)}>
            <Plus size={16} />
            <span>Ingest Raw Prompt</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="staging-tabs-wrapper">
        <div className="staging-tabs">
          {['ALL', 'STAGED', 'PENDING_SUMMARY', 'PENDING_AI', 'DUPLICATE_FOUND', 'FAILED_PREPROCESSING', 'FAILED_SANDBOX', 'FAILED_AI', 'FAILED_SECURITY'].map(tab => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar animate-fade-in">
          <div className="selected-count">
            <span className="font-semibold">{selectedIds.size} questions selected</span>
          </div>
          <div className="bulk-buttons">
            <button className="staging-action-btn secondary" onClick={() => handleExportXml()}>
              <Download size={15} />
              <span>Export Selected to XML</span>
            </button>
            <button className="staging-action-btn danger" onClick={handleBulkDiscard}>
              <Trash2 size={15} />
              <span>Discard Selected</span>
            </button>
            <button className="staging-action-btn primary" onClick={handleBulkApprove}>
              <CheckCircle size={15} />
              <span>Approve Selected</span>
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
                  {isTheoryQuestion(q) ? (
                    <span>Assessment: <strong>Reference answer + rubric</strong></span>
                  ) : (
                    <span>Test Cases: <strong>{q.testCases?.length || 0}/10 Verified</strong></span>
                  )}
                  <span>{new Date(q.createdAt).toLocaleString()}</span>
                </div>

                <p className="raw-snippet">{q.rawText}</p>

                <div className="staged-actions">
                  <div className="staged-left-actions">
                    <button 
                      className="staging-action-btn secondary"
                      onClick={() => setInspectingQuestion(q)}
                    >
                      <Eye size={15} />
                      <span>Inspect &amp; Diff</span>
                    </button>
                    <button 
                      className="staging-action-btn secondary"
                      onClick={() => handleExportXml([q.id])}
                    >
                      <Download size={15} />
                      <span>Moodle XML</span>
                    </button>
                  </div>

                  <div className="staged-right-actions">
                    <button 
                      className="staging-action-btn danger" 
                      onClick={() => handleDiscard(q.id)}
                    >
                      <Trash2 size={15} />
                      <span>Discard</span>
                    </button>
                    <button 
                      className="staging-action-btn primary" 
                      onClick={() => handleApprove(q.id)}
                    >
                      <CheckCircle size={15} />
                      <span>Approve to Live</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ingest Modal */}
      {isIngestModalOpen && createPortal(
        <div className="modal-overlay" onClick={() => setIsIngestModalOpen(false)}>
          <div className="ingest-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="inspector-modal-header" style={{ padding: '0 0 16px 0', borderBottom: '1px solid #e2e8f0' }}>
              <h2 className="inspector-title">Ingest Raw Interview Prompt</h2>
              <button className="close-btn" onClick={() => setIsIngestModalOpen(false)} title="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleIngestSubmit} style={{ marginTop: '16px' }}>
              <div style={{ marginBottom: '16px' }}>
                <label className="block text-sm font-semibold mb-2" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>Source Type</label>
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

              <div style={{ marginBottom: '16px' }}>
                <label className="block text-sm font-semibold mb-2" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                  Topic Tags (optional, comma-separated)
                </label>
                <input
                  className="input-field"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="arrays, graph, dynamic programming"
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label className="block text-sm font-semibold mb-2" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                  Remembered Hints (optional, one per line)
                </label>
                <textarea
                  className="input-field textarea-field"
                  rows={3}
                  value={hints}
                  onChange={(e) => setHints(e.target.value)}
                  placeholder={'Use a hash map\nInterviewer requested O(n)'}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <label className="block text-sm font-semibold" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                    Raw Question Statement
                  </label>

                  <div className="feeder-stt-toolbar">
                    <input 
                      type="file" 
                      ref={audioFileInputRef} 
                      accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" 
                      style={{ display: 'none' }} 
                      onChange={handleAudioFileUpload} 
                    />

                    {isRecording ? (
                      <div className="stt-active-recording">
                        <span className="stt-pulsing-circle" />
                        <span className="stt-timer-text">Listening... {formattedDuration}</span>
                        <button 
                          type="button" 
                          className="stt-chip-btn stop" 
                          onClick={handleStopRecording}
                          title="Finish speech and transcribe"
                        >
                          <Square size={12} fill="currentColor" />
                          <span>Done</span>
                        </button>
                        <button 
                          type="button" 
                          className="stt-chip-btn cancel" 
                          onClick={cancelRecording}
                          title="Cancel recording"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : isTranscribing ? (
                      <div className="stt-transcribing-badge">
                        <Loader2 size={13} className="spin-fast text-brand" />
                        <span>Transcribing...</span>
                      </div>
                    ) : (
                      <div className="stt-idle-actions">
                        <button 
                          type="button" 
                          className="stt-action-chip voice"
                          onClick={startRecording}
                          title="Record speech with microphone"
                        >
                          <Mic size={13} />
                          <span>Dictate</span>
                        </button>
                        <button 
                          type="button" 
                          className="stt-action-chip upload"
                          onClick={() => audioFileInputRef.current?.click()}
                          title="Upload audio file (.mp3, .m4a, .wav)"
                        >
                          <UploadCloud size={13} />
                          <span>Audio File</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {sttFeedback && (
                  <div className="stt-feedback-banner animate-fade-in" style={{ marginBottom: '10px' }}>
                    <Sparkles size={14} className="text-brand" />
                    <span>{sttFeedback}</span>
                  </div>
                )}

                {audioError && (
                  <div className="stt-error-banner animate-fade-in" style={{ marginBottom: '10px' }}>
                    <AlertCircle size={14} />
                    <span>{audioError}</span>
                  </div>
                )}

                <textarea 
                  className="input-field textarea-field" 
                  rows={6}
                  placeholder="Paste unformatted question text, or click 'Dictate' to speak. Groq Whisper will transcribe speech into text..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="staging-action-btn secondary" onClick={() => setIsIngestModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="staging-action-btn primary" disabled={isIngesting}>
                  {isIngesting ? 'Ingesting...' : 'Start Pipeline'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Side-by-Side Testcase Inspector Modal */}
      {inspectingQuestion && createPortal(
        <div className="modal-overlay" onClick={() => setInspectingQuestion(null)}>
          <div className="inspector-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Pinned Header */}
            <div className="inspector-modal-header">
              <div className="inspector-title-area">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h2 className="inspector-title">{inspectingQuestion.title || 'Untitled Question'}</h2>
                  <span className={`badge badge-${inspectingQuestion.status.toLowerCase()}`}>
                    {inspectingQuestion.status}
                  </span>
                </div>
                <div className="inspector-tax-path">
                  Taxonomy: <code>$course$/top/{inspectingQuestion.category || 'DSA'}/{inspectingQuestion.subtopic || 'General'}</code>
                </div>
              </div>
              <button className="close-btn" onClick={() => setInspectingQuestion(null)} title="Close Inspector">
                <X size={20} />
              </button>
            </div>

            {/* Structured 2-Column Body */}
            <div className="inspector-modal-body">
              {/* Left Column: Problem Description & Constraints */}
              <div className="inspector-col">
                <div className="inspector-section-card">
                  <div className="inspector-card-header">
                    <span className="inspector-heading-text">Problem Statement</span>
                    <span className="inspector-heading-sub">Curated Problem</span>
                  </div>
                  <div className="inspector-desc-scroll">
                    <div 
                      className="inspector-html-content" 
                      dangerouslySetInnerHTML={{ __html: inspectingQuestion.description || inspectingQuestion.rawText }}
                    />
                    {inspectingQuestion.constraints && (
                      <div className="inspector-constraints-box">
                        <h4 className="inspector-constraints-title">Constraints</h4>
                        <div 
                          className="inspector-html-content" 
                          dangerouslySetInnerHTML={{ __html: inspectingQuestion.constraints }} 
                        />
                      </div>
                    )}
                    {inspectingQuestion.inputTags && inspectingQuestion.inputTags.length > 0 && (
                      <div className="inspector-constraints-box">
                        <h4 className="inspector-constraints-title">Submitted Tags</h4>
                        <div>{inspectingQuestion.inputTags.join(', ')}</div>
                      </div>
                    )}
                    {inspectingQuestion.inputHints && inspectingQuestion.inputHints.length > 0 && (
                      <div className="inspector-constraints-box">
                        <h4 className="inspector-constraints-title">Submitted Hints</h4>
                        <ul>{inspectingQuestion.inputHints.map((hint, index) => <li key={index}>{hint}</li>)}</ul>
                      </div>
                    )}
                    {inspectingQuestion.enrichment?.status === 'matched' && inspectingQuestion.enrichment.question?.url && (
                      <div className="inspector-constraints-box">
                        <h4 className="inspector-constraints-title">LeetCode Evidence</h4>
                        <a href={inspectingQuestion.enrichment.question.url} target="_blank" rel="noreferrer">
                          {inspectingQuestion.enrichment.question.title || 'View matched problem'}
                        </a>
                        {typeof inspectingQuestion.enrichment.confidence === 'number' && (
                          <span> ({Math.round(inspectingQuestion.enrichment.confidence * 100)}% confidence)</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: 10 Standard I/O Test Cases */}
              <div className="inspector-col">
                <div className="inspector-section-card">
                  <div className="inspector-card-header">
                    <span className="inspector-heading-text">
                      {isTheoryQuestion(inspectingQuestion) ? 'Reference Answer & Scoring Rubric' : '10 Standard I/O Test Cases'}
                    </span>
                    <span className="badge badge-success">
                      {inspectingQuestion.sandboxVerdict || '10/10 Verified'}
                    </span>
                  </div>
                  <div className="inspector-tc-scroll">
                    {isTheoryQuestion(inspectingQuestion) ? (
                      <div className="tc-card-item">
                        <div className="tc-card-title">Reference answer</div>
                        <pre className="tc-pre" style={{ whiteSpace: 'pre-wrap' }}>
                          {inspectingQuestion.enrichment?.metadata?.detailed_answer
                            || inspectingQuestion.enrichment?.metadata?.concise_answer
                            || 'Reference answer is not available.'}
                        </pre>
                        <div className="tc-card-title" style={{ marginTop: '16px' }}>Scoring rubric</div>
                        <ul>
                          {(inspectingQuestion.enrichment?.metadata?.scoring_rubric?.criteria || []).map((criterion, index) => (
                            <li key={index}>{criterion}</li>
                          ))}
                        </ul>
                      </div>
                    ) : inspectingQuestion.testCases && inspectingQuestion.testCases.length > 0 ? (
                      inspectingQuestion.testCases.map((tc, idx) => (
                        <div key={idx} className="tc-card-item">
                          <div className="tc-card-title">
                            Case {idx + 1} {idx < 3 ? '(Sample)' : idx < 7 ? '(Edge)' : '(Stress)'}
                          </div>
                          <div className="tc-io-grid">
                            <div className="tc-io-block">
                              <span className="tc-io-label">stdin</span>
                              <pre className="tc-pre">{tc.input || '(empty)'}</pre>
                            </div>
                            <div className="tc-io-block">
                              <span className="tc-io-label">stdout</span>
                              <pre className="tc-pre">{tc.expectedOutput ?? tc.output ?? ''}</pre>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-muted text-sm italic" style={{ padding: '24px', textAlign: 'center' }}>
                        No test cases generated yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Pinned Modal Footer */}
            <div className="inspector-modal-footer">
              <button 
                type="button" 
                className="staging-action-btn secondary" 
                onClick={() => handleExportXml([inspectingQuestion.id])}
              >
                <Download size={15} />
                <span>Export Moodle XML</span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  type="button" 
                  className="staging-action-btn danger" 
                  onClick={() => handleDiscard(inspectingQuestion.id)}
                >
                  <Trash2 size={15} />
                  <span>Discard</span>
                </button>
                <button 
                  type="button" 
                  className="staging-action-btn primary" 
                  onClick={() => handleApprove(inspectingQuestion.id)}
                >
                  <CheckCircle size={15} />
                  <span>Approve &amp; Publish</span>
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
