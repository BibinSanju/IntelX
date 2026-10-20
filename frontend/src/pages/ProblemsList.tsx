import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { 
  CheckCircle2, 
  Circle, 
  AlertCircle, 
  Search, 
  Filter, 
  RotateCw, 
  Code2, 
  Layers, 
  CheckCheck, 
  Trophy 
} from 'lucide-react';
import './ProblemsList.css';
import { API_BASE } from '../config';

interface Question {
  id: string;
  category: string;
  subtopic?: string;
  title: string;
  description: string;
  difficulty?: string;
  companies?: string[];
}

export default function ProblemsList() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const fetchQuestions = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API_BASE}/questions`);
      if (response.data.success) {
        setQuestions(response.data.data);
      }
    } catch (err: any) {
      setError('Failed to fetch questions from database');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  const filteredQuestions = questions.filter(q => {
    const matchesSearch = q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.category && q.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (q.subtopic && q.subtopic.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'ALL' || q.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['ALL', ...Array.from(new Set(questions.map(q => q.category).filter(Boolean)))];

  return (
    <div className="container problems-container animate-fade-in">
      {/* SIETHub Style Header */}
      <div className="siet-section-header">
        <div className="siet-title-row">
          <Code2 size={28} className="siet-header-icon" />
          <h1 className="siet-page-title">Placement Question Bank</h1>
        </div>
        <p className="siet-page-subtitle">
          Practice verified algorithms, system design questions, and company drive challenges curated for technical interview assessments.
        </p>
      </div>

      {/* SIETHub Summary KPI Cards */}
      <div className="siet-kpi-grid">
        <div className="siet-kpi-card">
          <div className="kpi-icon-wrap">
            <Code2 size={24} />
          </div>
          <div className="kpi-val">{questions.length}</div>
          <div className="kpi-lbl">TOTAL PROBLEMS</div>
        </div>

        <div className="siet-kpi-card">
          <div className="kpi-icon-wrap">
            <Layers size={24} />
          </div>
          <div className="kpi-val">{categories.length > 1 ? categories.length - 1 : 1}</div>
          <div className="kpi-lbl">CATEGORIES</div>
        </div>

        <div className="siet-kpi-card">
          <div className="kpi-icon-wrap">
            <CheckCheck size={24} />
          </div>
          <div className="kpi-val">100%</div>
          <div className="kpi-lbl">SANDBOX VERIFIED</div>
        </div>

        <div className="siet-kpi-card">
          <div className="kpi-icon-wrap">
            <Trophy size={24} />
          </div>
          <div className="kpi-val">Moodle</div>
          <div className="kpi-lbl">LMS READY</div>
        </div>
      </div>

      {/* Action Bar (Matching SIETHub Filters, Refresh, Search) */}
      <div className="siet-action-bar">
        <div className="action-buttons-group">
          <button 
            className="siet-gold-action-btn"
            onClick={() => {
              const nextIndex = (categories.indexOf(selectedCategory) + 1) % categories.length;
              setSelectedCategory(categories[nextIndex]);
            }}
          >
            <Filter size={16} />
            <span>Filters: {selectedCategory}</span>
          </button>

          <button className="siet-gold-action-btn" onClick={fetchQuestions}>
            <RotateCw size={16} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="siet-search-wrap">
          <Search size={18} className="siet-search-icon" />
          <input 
            type="text" 
            className="siet-search-input" 
            placeholder="Search problems by name or category..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="siet-login-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-state flex-center" style={{ minHeight: '300px', flexDirection: 'column', gap: '14px' }}>
          <div className="spinner"></div>
          <span style={{ color: '#64748b', fontWeight: 600 }}>Loading challenges...</span>
        </div>
      ) : (
        <div className="siet-table-card">
          <table className="problems-table">
            <thead>
              <tr>
                <th className="status-col">STATUS</th>
                <th>QUESTION TITLE</th>
                <th>CATEGORY</th>
                <th>SUBTOPIC</th>
                <th>DIFFICULTY</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No questions matched your search criteria.
                  </td>
                </tr>
              ) : (
                filteredQuestions.map((q) => (
                  <tr key={q.id} className="problem-row">
                    <td className="status-col">
                      <Circle size={18} className="status-icon pending" />
                    </td>
                    <td>
                      <Link to={`/problems/${q.id}`} className="problem-title-link">
                        {q.title}
                      </Link>
                    </td>
                    <td>
                      <span className="siet-category-pill">{q.category || 'DSA'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
                        {q.subtopic || 'General'}
                      </span>
                    </td>
                    <td>
                      <span className="siet-diff-pill medium">Medium</span>
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
