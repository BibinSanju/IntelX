import React, { useState } from 'react';
import axios from 'axios';
import { Send, CheckCircle2, AlertCircle, Building2, User, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export default function SubmitPrompt() {
  const navigate = useNavigate();
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [rawText, setRawText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    setError('');
    setIsSubmitting(true);

    try {
      const sourceTag = company ? `Student Interview (${company}${role ? ` - ${role}` : ''})` : 'Student Interview';
      const res = await axios.post(`${API_BASE}/api/ingest`, {
        raw_text: rawText,
        source: sourceTag
      });

      if (res.data.success) {
        setSuccessId(res.data.questionId);
        setRawText('');
        setCompany('');
        setRole('');
      } else {
        setError(res.data.error || 'Failed to submit question');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit. Backend server unreachable.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container animate-fade-in" style={{ maxWidth: '800px', paddingTop: '40px', paddingBottom: '80px' }}>
      <div className="text-center mb-8">
        <h1 className="page-title text-gradient">Campus Interview Question Feeder</h1>
        <p className="page-subtitle">
          Contribute technical questions asked in your recent placement drives. Our automated AI &amp; Sandbox pipeline will curate, verify test cases, and publish them to the LMS.
        </p>
      </div>

      {successId ? (
        <div className="glass-panel p-8 text-center animate-fade-in" style={{ borderRadius: '12px' }}>
          <CheckCircle2 size={48} className="text-green mx-auto mb-4" style={{ color: '#10b981' }} />
          <h2 className="text-2xl font-bold mb-2">Question Ingested Successfully!</h2>
          <p className="text-muted mb-4">
            Tracking ID: <code>{successId}</code>
          </p>
          <p className="text-sm text-secondary mb-6">
            Your question is now entering the <strong>384-d Deduplication &amp; Sandbox Verification</strong> pipeline. Once 10/10 test cases pass, faculty will review and export it to the Moodle LMS.
          </p>
          <div className="flex-center gap-3">
            <button className="btn-secondary" onClick={() => setSuccessId(null)}>
              Submit Another Question
            </button>
            <button className="btn-primary" onClick={() => navigate('/staging')}>
              View in Staging Queue
            </button>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-8" style={{ borderRadius: '12px' }}>
          {error && (
            <div className="error-banner flex-center mb-6">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4 mb-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                  <Building2 size={16} className="text-muted" /> Company Name
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Amazon, Google, Zoho, TCS" 
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                  <User size={16} className="text-muted" /> Target Role
                </label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. SDE-1, Cloud Engineer, Graduate Trainee" 
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-semibold mb-2 flex items-center gap-2">
                <BookOpen size={16} className="text-muted" /> Raw Interview Question Description
              </label>
              <textarea 
                className="input-field" 
                rows={8}
                placeholder="Paste the problem statement as you remember it. Include sample input/output or constraints if available..."
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                required
                style={{ width: '100%', resize: 'vertical' }}
              />
              <p className="text-xs text-muted mt-2">
                Don't worry about perfect formatting — the pipeline automatically structures constraints, generates test cases, and runs sandbox verification.
              </p>
            </div>

            <button 
              type="submit" 
              className="btn-primary flex-center w-full" 
              style={{ width: '100%', padding: '12px', fontSize: '1rem' }}
              disabled={isSubmitting}
            >
              <Send size={18} style={{ marginRight: '8px' }} />
              {isSubmitting ? 'Ingesting into Pipeline...' : 'Submit to Question Bank'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
