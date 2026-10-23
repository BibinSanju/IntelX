import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Send, CheckCircle2, AlertCircle, Building2, User, FileText, 
  RefreshCw, Cpu, ArrowRight, Sparkles, Check, Mic, Square, 
  UploadCloud, X, Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import './SubmitPrompt.css';

const QUICK_COMPANIES = ['Google', 'Amazon', 'Microsoft', 'Zoho', 'TCS', 'Infosys'];

interface PipelineQuestionData {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  subtopic: string | null;
  sandboxVerdict: string | null;
  status: string;
  testCases?: any[];
  inputTags?: string[];
  inputHints?: string[];
  preprocessing?: {
    provider?: string;
    status?: string;
    model?: string;
  } | null;
  enrichment?: {
    provider?: string;
    status?: string;
    confidence?: number;
    question?: { title?: string; url?: string; topicTags?: Array<{ name: string }> };
  } | null;
}

export default function SubmitPrompt() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [tags, setTags] = useState('');
  const [hints, setHints] = useState('');
  const [rawText, setRawText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [pipelineData, setPipelineData] = useState<PipelineQuestionData | null>(null);
  const [error, setError] = useState('');
  const [sttFeedback, setSttFeedback] = useState<string | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  // Audio Recorder Hook for high-speed Groq Whisper STT
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

  // Poll for pipeline progress if activeQuestionId is set
  useEffect(() => {
    if (!activeQuestionId) return;

    let isSubscribed = true;
    const interval = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/status/${activeQuestionId}`);
        if (res.data.success && isSubscribed) {
          setPipelineData(res.data.data);
          const currentStatus = res.data.status;
          if (['STAGED', 'DUPLICATE_FOUND', 'FAILED_PREPROCESSING', 'FAILED_SANDBOX', 'FAILED_AI', 'FAILED_SECURITY'].includes(currentStatus)) {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.warn('Failed to poll question status:', err);
      }
    }, 2000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [activeQuestionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    setError('');
    setIsSubmitting(true);
    setPipelineData(null);

    try {
      const sourceTag = company.trim() 
        ? `Student (${company.trim()}${role.trim() ? ` - ${role.trim()}` : ''})` 
        : 'Student Interview';
        
      const res = await axios.post(`${API_BASE}/api/ingest`, {
        raw_text: rawText,
        source: sourceTag,
        tags,
        hints
      });

      if (res.data.success) {
        setActiveQuestionId(res.data.questionId);
      } else {
        setError(res.data.error || 'Failed to submit question');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to connect to backend server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    cancelRecording();
    setActiveQuestionId(null);
    setPipelineData(null);
    setRawText('');
    setCompany('');
    setRole('');
    setTags('');
    setHints('');
    setSttFeedback(null);
  };

  const handleStopRecording = async () => {
    const text = await stopRecording();
    if (text) {
      setRawText(prev => prev.trim() ? `${prev}\n\n${text}` : text);
      setSttFeedback('Speech transcribed successfully via Groq Whisper!');
      setTimeout(() => setSttFeedback(null), 4000);
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await transcribeFile(file);
    if (text) {
      setRawText(prev => prev.trim() ? `${prev}\n\n${text}` : text);
      setSttFeedback(`Audio file "${file.name}" transcribed successfully!`);
      setTimeout(() => setSttFeedback(null), 4000);
    }
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = '';
    }
  };

  const currentStatus = pipelineData?.status || (activeQuestionId ? 'PENDING_AI' : 'IDLE');

  const getStepState = (stepIndex: number) => {
    if (!activeQuestionId) return 'pending';

    if (currentStatus === 'FAILED_PREPROCESSING') {
      return stepIndex === 0 ? 'failed' : 'pending';
    }
    
    if (currentStatus === 'DUPLICATE_FOUND') {
      if (stepIndex <= 1) return 'completed';
      if (stepIndex === 2) return 'failed';
      return 'pending';
    }

    if (currentStatus === 'FAILED_SECURITY') {
      if (stepIndex < 4) return 'completed';
      if (stepIndex === 4) return 'failed';
      return 'pending';
    }

    if (currentStatus === 'FAILED_AI') {
      if (pipelineData?.title) {
        if (stepIndex < 3) return 'completed';
        if (stepIndex === 3) return 'failed';
        return 'pending';
      }
      if (stepIndex === 0) return 'completed';
      if (stepIndex === 1) return 'failed';
      return 'pending';
    }

    if (currentStatus === 'FAILED_SANDBOX') {
      if (stepIndex < 4) return 'completed';
      if (stepIndex === 4) return 'failed';
      return 'pending';
    }

    if (currentStatus === 'STAGED') return 'completed';
    if (currentStatus === 'PENDING_SANDBOX') {
      if (stepIndex < 4) return 'completed';
      if (stepIndex === 4) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_SYNTHESIS') {
      if (stepIndex < 3) return 'completed';
      if (stepIndex === 3) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_DEDUP') {
      if (stepIndex < 2) return 'completed';
      if (stepIndex === 2) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_ENRICHMENT') {
      if (stepIndex === 0) return 'completed';
      if (stepIndex === 1) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_AI' || currentStatus === 'PENDING_SUMMARY') {
      if (stepIndex === 0) return 'active';
      return 'pending';
    }

    return 'pending';
  };

  return (
    <div className="feeder-page-wrapper animate-fade-in">
      <div className="feeder-shell">
        
        {/* Clean, Simple Header */}
        <div className="feeder-header-simple">
          <h1 className="feeder-main-heading">Submit Placement Question</h1>
          <p className="feeder-sub-heading">
            Share technical or coding questions from your campus drives.
          </p>
        </div>

        {/* Clean, Organised Form Card */}
        {!activeQuestionId ? (
          <div className="feeder-card-clean">
            {error && (
              <div className="feeder-alert-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="feeder-form-clean">
              {/* Symmetrical 2-Column Row for Company & Role */}
              <div className="feeder-row-grid">
                <div className="feeder-input-group">
                  <label className="feeder-clean-label">
                    <Building2 size={15} /> Company Name
                  </label>
                  <input 
                    type="text" 
                    className="feeder-text-input" 
                    placeholder="e.g. Google, Amazon, Zoho" 
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>

                <div className="feeder-input-group">
                  <label className="feeder-clean-label">
                    <User size={15} /> Role &amp; Round <span className="feeder-label-opt">(Optional)</span>
                  </label>
                  <input 
                    type="text" 
                    className="feeder-text-input" 
                    placeholder="e.g. SDE Intern, OA, Technical Round" 
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  />
                </div>
              </div>

              <div className="feeder-row-grid">
                <div className="feeder-input-group">
                  <label className="feeder-clean-label">
                    Topic Tags <span className="feeder-label-opt">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    className="feeder-text-input"
                    placeholder="e.g. arrays, sliding window, graphs"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </div>

                <div className="feeder-input-group">
                  <label className="feeder-clean-label">
                    Remembered Hints <span className="feeder-label-opt">(Optional; one per line)</span>
                  </label>
                  <textarea
                    className="feeder-textarea-input"
                    rows={3}
                    placeholder="Use a hash map&#10;Interviewer asked for O(n)"
                    value={hints}
                    onChange={(e) => setHints(e.target.value)}
                  />
                </div>
              </div>

              {/* Problem Description Area with STT Dictation */}
              <div className="feeder-input-group">
                <div className="feeder-label-bar flex-between">
                  <label className="feeder-clean-label">
                    <FileText size={15} /> Problem Statement &amp; Notes
                  </label>

                  {/* STT Dictation & Voice Toolbar */}
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
                        <span>Transcribing audio...</span>
                      </div>
                    ) : (
                      <div className="stt-idle-actions">
                        <button 
                          type="button" 
                          className="stt-action-chip voice"
                          onClick={startRecording}
                          title="Record your voice to dictate question"
                        >
                          <Mic size={14} />
                          <span>Dictate (Voice STT)</span>
                        </button>
                        <button 
                          type="button" 
                          className="stt-action-chip upload"
                          onClick={() => audioFileInputRef.current?.click()}
                          title="Upload an audio file (.mp3, .m4a, .wav, .webm)"
                        >
                          <UploadCloud size={14} />
                          <span>Upload Voice Note</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* STT Feedback Banner */}
                {sttFeedback && (
                  <div className="stt-feedback-banner animate-fade-in">
                    <Sparkles size={14} className="text-brand" />
                    <span>{sttFeedback}</span>
                  </div>
                )}

                {/* Audio Error Alert */}
                {audioError && (
                  <div className="stt-error-banner animate-fade-in">
                    <AlertCircle size={14} />
                    <span>{audioError}</span>
                  </div>
                )}

                <textarea 
                  className="feeder-textarea-input" 
                  rows={7}
                  placeholder="Paste, type, or click 'Dictate' to speak the question. Groq Whisper will transcribe your voice into problem text..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  required
                />
                <div className="feeder-textarea-footer">
                  <span className="feeder-footer-count">
                    {rawText.length} characters
                  </span>
                </div>
              </div>

              {/* Clean Action Button */}
              <div className="feeder-action-row">
                <button 
                  type="submit" 
                  className="feeder-primary-btn" 
                  disabled={isSubmitting || !rawText.trim()}
                >
                  <Send size={17} />
                  <span>{isSubmitting ? 'Submitting Question...' : 'Submit Question'}</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Live Progress Card */
          <div className="feeder-card-clean animate-fade-in">
            <div className="feeder-tracker-head">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu size={18} className="text-brand" />
                  <h3 className="feeder-tracker-title">Question Processing Pipeline</h3>
                </div>
                <p className="feeder-tracker-sub">
                  ID: <code>{activeQuestionId}</code>
                </p>
              </div>

              <div>
                {currentStatus === 'STAGED' && (
                  <span className="feeder-status-tag ready">10/10 Verified &amp; Staged</span>
                )}
                {currentStatus === 'DUPLICATE_FOUND' && (
                  <span className="feeder-status-tag warn">Duplicate Found</span>
                )}
                {currentStatus === 'FAILED_SECURITY' && (
                  <span className="feeder-status-tag danger">Flagged Content</span>
                )}
                {['FAILED_PREPROCESSING', 'FAILED_AI', 'FAILED_SANDBOX'].includes(currentStatus) && (
                  <span className="feeder-status-tag danger">Processing Failed</span>
                )}
                {['PENDING_AI', 'PENDING_SUMMARY', 'PENDING_ENRICHMENT', 'PENDING_DEDUP', 'PENDING_SYNTHESIS', 'PENDING_SANDBOX'].includes(currentStatus) && (
                  <span className="feeder-status-tag processing">Processing...</span>
                )}
              </div>
            </div>

            <div className="feeder-stepper-list">
              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(0)}`}>
                  {getStepState(0) === 'completed' ? <Check size={16} /> : '1'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">Normalize &amp; Prepare</div>
                  <div className="feeder-step-desc">
                    BeautifulSoup produces Markdown; Google AI Studio creates the structured evidence brief.
                    {currentStatus === 'FAILED_PREPROCESSING' && pipelineData?.sandboxVerdict && (
                      <div className="feeder-step-alert">{pipelineData.sandboxVerdict}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(1)}`}>
                  {getStepState(1) === 'completed' ? <Check size={16} /> : '2'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">Groq Reconstruction &amp; Enrichment</div>
                  <div className="feeder-step-desc">Groq formalizes the problem and checks LeetCode hints, tags, and discussions.</div>
                </div>
              </div>

              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(2)}`}>
                  {getStepState(2) === 'completed' ? <Check size={16} /> : '3'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">Duplicate Detection</div>
                  <div className="feeder-step-desc">
                    Comparing against existing database questions.
                    {currentStatus === 'DUPLICATE_FOUND' && (
                      <div className="feeder-step-alert">
                        ⚠️ This question already exists in the question bank.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(3)}`}>
                  {getStepState(3) === 'completed' ? <Check size={16} /> : '4'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">AI Problem &amp; Testcase Synthesis</div>
                  <div className="feeder-step-desc">Generates formatted description and 10 verified test cases.</div>
                </div>
              </div>

              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(4)}`}>
                  {getStepState(4) === 'completed' ? <Check size={16} /> : '5'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">Code Sandbox Execution</div>
                  <div className="feeder-step-desc">
                    Verifying solution against synthesized test cases.
                    {pipelineData?.sandboxVerdict && (
                      <span className="feeder-verdict"> (Verdict: {pipelineData.sandboxVerdict})</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="feeder-step-item">
                <div className={`feeder-step-circle ${getStepState(5)}`}>
                  {getStepState(5) === 'completed' ? <Check size={16} /> : '6'}
                </div>
                <div className="feeder-step-body">
                  <div className="feeder-step-name">Staged for Review</div>
                  <div className="feeder-step-desc">Ready in the question bank for faculty review and LMS export.</div>
                </div>
              </div>
            </div>

            {/* Structured Preview */}
            {pipelineData && pipelineData.title && (
              <div className="feeder-result-box">
                <div className="feeder-result-header">
                  <span className="feeder-result-label">Reconstructed Problem</span>
                  <span className="feeder-result-tag">{pipelineData.category || 'DSA'}</span>
                </div>
                <h4 className="feeder-result-title">{pipelineData.title}</h4>
                {pipelineData.enrichment?.status === 'matched' && pipelineData.enrichment.question && (
                  <div className="feeder-result-tests">
                    <Sparkles size={16} />
                    Matched LeetCode evidence:&nbsp;
                    <a href={pipelineData.enrichment.question.url} target="_blank" rel="noreferrer">
                      {pipelineData.enrichment.question.title || 'View problem'}
                    </a>
                    {typeof pipelineData.enrichment.confidence === 'number' && (
                      <span>&nbsp;({Math.round(pipelineData.enrichment.confidence * 100)}% confidence)</span>
                    )}
                  </div>
                )}
                {pipelineData.description && (
                  <div 
                    className="feeder-result-desc" 
                    dangerouslySetInnerHTML={{ __html: pipelineData.description }}
                  />
                )}
                {pipelineData.testCases && Array.isArray(pipelineData.testCases) && (
                  <div className="feeder-result-tests">
                    <CheckCircle2 size={16} /> {pipelineData.testCases.length} Test cases synthesized &amp; verified.
                  </div>
                )}
              </div>
            )}

            <div className="feeder-card-foot">
              <button type="button" className="feeder-secondary-btn" onClick={handleReset}>
                <RefreshCw size={15} />
                <span>Submit Another Question</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
