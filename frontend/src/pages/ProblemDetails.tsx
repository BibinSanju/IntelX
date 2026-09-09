import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, AlertCircle, FileCode } from 'lucide-react';
import './ProblemDetails.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://intelx-148e.onrender.com';

interface Question {
  id: string;
  title: string;
  description: string;
  category: string;
  subtopic?: string;
  difficulty?: string;
  testCases?: any;
}

export default function ProblemDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchQuestion = async () => {
      try {
        const response = await axios.get(`${API_BASE}/questions/${id}`);
        if (response.data.success) {
          setQuestion(response.data.data);
        } else {
          setError('Question not found');
        }
      } catch (err) {
        setError('Failed to fetch question details');
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchQuestion();
  }, [id]);

  if (loading) {
    return (
      <div className="container flex-center" style={{ minHeight: '60vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (error || !question) {
    return (
      <div className="container" style={{ marginTop: '40px' }}>
        <div className="error-banner flex-center">
          <AlertCircle size={20} />
          <span>{error || 'Question not found'}</span>
        </div>
        <button className="btn-secondary mt-4 flex-center" onClick={() => navigate('/problems')}>
          <ArrowLeft size={16} style={{ marginRight: '8px' }} /> Back to Problems
        </button>
      </div>
    );
  }

  return (
    <div className="container problem-details-container animate-fade-in">
      <div className="mb-4">
        <button className="back-button flex-center" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} style={{ marginRight: '8px' }} />
          <span>Back</span>
        </button>
      </div>

      <div className="glass-panel p-6 problem-details-card">
        <div className="problem-details-header">
          <h1 className="problem-title text-gradient">{question.title}</h1>
          <div className="problem-meta-badges flex gap-2 mt-3">
            <span className={`difficulty-tag ${question.difficulty?.toLowerCase() || 'medium'}`}>
              {question.difficulty || 'Medium'}
            </span>
            <span className="category-tag">{question.category}</span>
            {question.subtopic && <span className="category-tag">{question.subtopic}</span>}
          </div>
        </div>

        <hr className="divider my-6" />

        <div className="problem-description prose prose-invert">
          <div dangerouslySetInnerHTML={{ __html: question.description }} />
        </div>

        {question.testCases && Array.isArray(question.testCases) && question.testCases.length > 0 && (
          <div className="problem-testcases-section mt-8">
            <h2 className="testcases-title flex-center">
              <FileCode size={20} />
              <span>Test Cases ({question.testCases.length})</span>
            </h2>
            <div className="testcases-grid">
              {question.testCases.map((tc: any, index: number) => (
                <div key={index} className="example-box glass-panel p-4 rounded-md mb-3">
                  <div className="text-sm font-semibold text-muted mb-2">Case {index + 1}</div>
                  <div className="mb-2">
                    <strong className="text-xs text-muted block mb-1">Standard Input (stdin):</strong>
                    <pre className="p-3 bg-black bg-opacity-40 rounded text-xs whitespace-pre-wrap">
                      {typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <strong className="text-xs text-muted block mb-1">Expected Output (stdout):</strong>
                    <pre className="p-3 bg-black bg-opacity-40 rounded text-xs whitespace-pre-wrap">
                      {typeof tc.expectedOutput === 'string' ? tc.expectedOutput : JSON.stringify(tc.expectedOutput, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
