import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Send, CheckCircle2, AlertCircle, Building2, User, BookOpen, 
  ShieldCheck, RefreshCw, Layers, Cpu, Download, ArrowRight, Database
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import './SubmitPrompt.css';

const POPULAR_COMPANIES = ['Amazon', 'Google', 'Microsoft', 'Zoho', 'TCS', 'Infosys', 'Cisco', 'Cognizant'];

interface PipelineQuestionData {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  subtopic: string | null;
  sandboxVerdict: string | null;
  status: string;
  testCases?: any[];
}

export default function SubmitPrompt() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [rawText, setRawText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [pipelineData, setPipelineData] = useState<PipelineQuestionData | null>(null);
  const [error, setError] = useState('');

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
          // Stop polling if reached terminal status
          if (['STAGED', 'DUPLICATE_FOUND', 'FAILED_SANDBOX', 'FAILED_AI', 'FAILED_SECURITY'].includes(currentStatus)) {
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
      const sourceTag = company ? `Student Interview (${company}${role ? ` - ${role}` : ''})` : 'Student Interview';
      const res = await axios.post(`${API_BASE}/api/ingest`, {
        raw_text: rawText,
        source: sourceTag
      });

      if (res.data.success) {
        setActiveQuestionId(res.data.questionId);
      } else {
        setError(res.data.error || 'Failed to submit question');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit. Backend server unreachable.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setActiveQuestionId(null);
    setPipelineData(null);
    setRawText('');
    setCompany('');
    setRole('');
  };

  const currentStatus = pipelineData?.status || (activeQuestionId ? 'PENDING_AI' : 'IDLE');

  // Helper to determine step status
  const getStepState = (stepIndex: number) => {
    if (!activeQuestionId) return 'pending';
    
    // Statuses in order:
    // 0: PENDING_AI (Ingestion & Sanitization)
    // 1: PENDING_DEDUP (Staging DB Dedup)
    // 2: PENDING_SYNTHESIS (Groq Question & 10 Testcases Synthesis)
    // 3: PENDING_SANDBOX (Docker Sandbox Execution)
    // 4: STAGED (Faculty Staging Queue)
    
    if (currentStatus === 'DUPLICATE_FOUND') {
      if (stepIndex <= 1) return 'completed';
      if (stepIndex === 2) return 'failed'; // Halts here
      return 'pending';
    }

    if (currentStatus === 'FAILED_SECURITY') {
      if (stepIndex <= 3) return 'completed';
      if (stepIndex === 4) return 'failed';
      return 'pending';
    }

    if (currentStatus === 'FAILED_AI' || currentStatus === 'FAILED_SANDBOX') {
      if (stepIndex <= 2) return 'completed';
      return 'failed';
    }

    if (currentStatus === 'STAGED') return 'completed';
    if (currentStatus === 'PENDING_SANDBOX') {
      if (stepIndex < 3) return 'completed';
      if (stepIndex === 3) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_SYNTHESIS') {
      if (stepIndex < 2) return 'completed';
      if (stepIndex === 2) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_DEDUP') {
      if (stepIndex < 1) return 'completed';
      if (stepIndex === 1) return 'active';
      return 'pending';
    }
    if (currentStatus === 'PENDING_AI') {
      if (stepIndex === 0) return 'active';
      return 'pending';
    }

    return 'pending';
  };

  return (
    <div className="container feeder-container animate-fade-in">
      <div className="text-center mb-8">
        <div className="feeder-badge">
          <ShieldCheck size={16} /> Campus Placement Question Intake
        </div>
        <h1 className="page-title text-gradient">Interview Question Feeder</h1>
        <p className="page-subtitle" style={{ maxWidth: '640px', margin: '0 auto' }}>
          Contribute technical questions asked in your recent placement drives. The system reconstructs the full formal problem, verifies 10 test cases in a Docker sandbox, and stages it for Moodle LMS export.
        </p>
      </div>

      {/* Main Submission Form */}
      {!activeQuestionId ? (
        <div className="glass-panel p-8" style={{ borderRadius: '16px' }}>
          {error && (
            <div className="error-banner flex-center mb-6">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                  <Building2 size={16} className="text-accent" /> Company Name
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Amazon, Google, Zoho" 
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
                <div className="company-chips">
                  {POPULAR_COMPANIES.map(c => (
                    <button
                      type="button"
                      key={c}
                      className={`chip-btn ${company === c ? 'active' : ''}`}
                      onClick={() => setCompany(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                  <User size={16} className="text-accent" /> Role &amp; Interview Details (Optional Hints)
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. SDE-1, Technical Round 2, Online Assessment" 
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
                <p className="text-xs text-muted mt-2">
                  Helps categorize the question difficulty and company tag for faculty review.
                </p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                <BookOpen size={16} className="text-accent" /> Question Recollection &amp; Memory Notes
              </label>
              <textarea 
                className="input-field" 
                rows={9}
                placeholder="Describe what you remember from your interview:
- What was the task or scenario?
- What were the inputs and outputs?
- Any specific constraints (e.g. N <= 10^5) or sample cases?

Don't worry about perfect wording — the AI formalizes the problem and synthesizes 10 standard test cases automatically."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                required
                style={{ width: '100%', resize: 'vertical', fontSize: '0.95rem' }}
              />
              <div className="flex-between mt-2">
                <span className="text-xs text-muted flex items-center gap-1">
                  <ShieldCheck size={14} className="text-green" style={{ color: '#10b981' }} />
                  Automated Prompt Injection Defense &amp; Sanitization Active
                </span>
                <span className="text-xs text-muted">
                  {rawText.length} characters
                </span>
              </div>
            </div>

            <button 
              type="submit" 
              className="btn-primary flex-center w-full" 
              style={{ width: '100%', padding: '14px', fontSize: '1.05rem', borderRadius: '10px' }}
              disabled={isSubmitting || !rawText.trim()}
            >
              <Send size={18} style={{ marginRight: '8px' }} />
              {isSubmitting ? 'Ingesting into Pipeline...' : 'Submit & Start Curation Pipeline'}
            </button>
          </form>
        </div>
      ) : (
        /* Real-Time Live Pipeline Tracker */
        <div className="pipeline-tracker glass-panel animate-fade-in">
          <div className="tracker-header flex-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Cpu size={18} className="text-accent" />
                <h3 className="font-semibold text-lg">Curating Question &amp; Verifying Sandbox</h3>
              </div>
              <p className="text-xs text-muted">
                Tracking ID: <code>{activeQuestionId}</code>
              </p>
            </div>

            <div>
              {currentStatus === 'STAGED' && (
                <span className="badge-tag staged">10/10 Verified &amp; Staged</span>
              )}
              {currentStatus === 'DUPLICATE_FOUND' && (
                <span className="badge-tag duplicate">Duplicate in Staging DB</span>
              )}
              {currentStatus === 'FAILED_SECURITY' && (
                <span className="badge-tag security">Security Violation Blocked</span>
              )}
              {['PENDING_AI', 'PENDING_DEDUP', 'PENDING_SYNTHESIS', 'PENDING_SANDBOX'].includes(currentStatus) && (
                <span className="badge-tag staged" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderColor: '#3b82f6' }}>
                  Processing in Pipeline...
                </span>
              )}
            </div>
          </div>

          <div className="stepper-container">
            {/* Step 1 */}
            <div className="step-row">
              <div className={`step-indicator ${getStepState(0)}`}>
                {getStepState(0) === 'completed' ? <CheckCircle2 size={18} /> : <span>1</span>}
              </div>
              <div className="step-info">
                <div className="step-title">Prompt Ingestion &amp; Injection Defense</div>
                <div className="step-desc">Input received, control characters sanitized, and safe extraction boundary applied.</div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="step-row">
              <div className={`step-indicator ${getStepState(1)}`}>
                {getStepState(1) === 'completed' ? <CheckCircle2 size={18} /> : <span>2</span>}
              </div>
              <div className="step-info">
                <div className="step-title">384-d Staging Database Deduplication</div>
                <div className="step-desc">
                  Vector cosine comparison (&gt;85% threshold) against all existing student submissions in our staging database.
                  {currentStatus === 'DUPLICATE_FOUND' && (
                    <div className="text-xs text-amber-400 mt-1" style={{ color: '#f59e0b', fontWeight: 600 }}>
                      ⚠️ Duplicate Detected: Another student has already submitted this question.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="step-row">
              <div className={`step-indicator ${getStepState(2)}`}>
                {getStepState(2) === 'completed' ? <CheckCircle2 size={18} /> : <span>3</span>}
              </div>
              <div className="step-info">
                <div className="step-title">Formal Problem &amp; 10 Test Cases Synthesis</div>
                <div className="step-desc">Groq AI converts memory fragments into formal HTML statement, reference Python 3 solution, and exactly 10 concise I/O test cases (basic, edge, stress).</div>
              </div>
            </div>

            {/* Step 4 */}
            <div className="step-row">
              <div className={`step-indicator ${getStepState(3)}`}>
                {getStepState(3) === 'completed' ? <CheckCircle2 size={18} /> : <span>4</span>}
              </div>
              <div className="step-info">
                <div className="step-title">Docker Sandbox Verification (2.0s &amp; 128MB RAM)</div>
                <div className="step-desc">
                  Solution is compiled and verified against all 10 test cases in an isolated execution sandbox.
                  {pipelineData?.sandboxVerdict && (
                    <div className="text-xs mt-1" style={{ color: '#38bdf8', fontWeight: 500 }}>
                      Verdict: {pipelineData.sandboxVerdict}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 5 */}
            <div className="step-row">
              <div className={`step-indicator ${getStepState(4)}`}>
                {getStepState(4) === 'completed' ? <CheckCircle2 size={18} /> : <span>5</span>}
              </div>
              <div className="step-info">
                <div className="step-title">Staged for Faculty LMS Export</div>
                <div className="step-desc">Question published to the faculty staging queue for review, Moodle CodeRunner XML packaging, and LMS export.</div>
              </div>
            </div>
          </div>

          {/* Reconstructed Problem Preview */}
          {pipelineData && pipelineData.title && (
            <div className="reconstructed-card mx-6 mb-6" style={{ margin: '0 24px 24px' }}>
              <div className="flex-between mb-3">
                <span className="text-xs text-muted uppercase font-semibold">Reconstructed Problem</span>
                <span className="category-tag">{pipelineData.category || 'DSA'} • {pipelineData.subtopic || 'General'}</span>
              </div>
              <h3 className="text-lg font-bold mb-2 text-gradient">{pipelineData.title}</h3>
              {pipelineData.description && (
                <div 
                  className="text-sm text-secondary mb-4 line-clamp-3" 
                  style={{ maxHeight: '100px', overflow: 'hidden' }}
                  dangerouslySetInnerHTML={{ __html: pipelineData.description }}
                />
              )}
              {pipelineData.testCases && Array.isArray(pipelineData.testCases) && (
                <div className="text-xs text-muted mb-4">
                  ✅ <strong>{pipelineData.testCases.length} Standardized I/O Test Cases</strong> synthesized and verified in sandbox.
                </div>
              )}
            </div>
          )}

          {/* Action Footer */}
          <div className="p-6 bg-black bg-opacity-30 border-t border-border flex-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn-secondary flex-center" onClick={handleReset}>
              <RefreshCw size={16} style={{ marginRight: '8px' }} />
              Submit Another Question
            </button>

            <div className="flex gap-3">
              <button className="btn-primary flex-center" onClick={() => navigate('/staging')}>
                <span>View in Faculty Staging</span>
                <ArrowRight size={16} style={{ marginLeft: '8px' }} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
