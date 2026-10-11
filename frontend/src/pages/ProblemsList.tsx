import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import './ProblemsList.css';
import { API_BASE } from '../config';

interface Question {
  id: string;
  category: string;
  title: string;
  description: string;
  // backend schema has these
}

export default function ProblemsList() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const response = await axios.get(`${API_BASE}/questions`);
        if (response.data.success) {
          setQuestions(response.data.data);
        }
      } catch (err: any) {
        setError('Failed to fetch questions. Is the backend running?');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuestions();
  }, []);

  return (
    <div className="container problems-container animate-fade-in">
      <div className="problems-header flex-between">
        <div>
          <h1 className="page-title text-gradient">Problem Set</h1>
          <p className="page-subtitle">Sharpen your skills with our collection of coding challenges.</p>
        </div>
      </div>

      {error && (
        <div className="error-banner flex-center">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-state flex-center">
          <div className="spinner"></div>
          <span>Loading challenges...</span>
        </div>
      ) : (
        <div className="table-container glass-panel">
          <table className="problems-table">
            <thead>
              <tr>
                <th className="status-col">Status</th>
                <th>Title</th>
                <th>Category</th>
                <th>Difficulty</th>
              </tr>
            </thead>
            <tbody>
              {questions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    No questions available yet. Check back soon!
                  </td>
                </tr>
              ) : (
                questions.map((q) => (
                  <tr key={q.id} className="problem-row">
                    <td className="status-col">
                      <Circle size={18} className="status-icon pending" />
                      {/* Would replace with CheckCircle2 if solved */}
                    </td>
                    <td>
                      <Link to={`/problems/${q.id}`} className="problem-title-link">
                        {q.title}
                      </Link>
                    </td>
                    <td>
                      <span className="category-tag">{q.category}</span>
                    </td>
                    <td>
                      <span className="difficulty-tag medium">Medium</span> {/* Mock difficulty for now since it's not in schema */}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
