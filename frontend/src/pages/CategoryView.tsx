import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ChevronRight, Circle, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import './CategoryView.css';
import { API_BASE } from '../config';

// Removed hardcoded categorySubtopics

const categoryNames: Record<string, string> = {
  'dsa': 'Data Structures and Algorithms',
  'machine-learning': 'Machine Learning',
  'computer-networks': 'Computer Networks',
  'system-design': 'System Design',
  'dbms': 'DBMS',
  'cyber-security': 'Cyber Security',
  'cloud-computing': 'Cloud Computing',
  'operating-systems': 'Operating Systems'
};

interface Question {
  id: string;
  category: string;
  subtopic: string;
  difficulty: string;
  title: string;
}

export default function CategoryView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeSubtopic, setActiveSubtopic] = useState<string>('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [subtopics, setSubtopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const categoryTitle = name ? categoryNames[name] || name : 'Category';

  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE}/questions`);
        if (response.data.success) {
          // Filter by category (case insensitive/mapping)
          const allQuestions: Question[] = response.data.data;
          
          let backendCategory = name;
          if (name === 'dsa') backendCategory = 'DSA';
          else if (name === 'dbms') backendCategory = 'DBMS';
          else if (name === 'machine-learning') backendCategory = 'Machine Learning';
          else if (name === 'system-design') backendCategory = 'System Design';
          else if (name === 'computer-networks') backendCategory = 'Computer Networks';
          else if (name === 'cyber-security') backendCategory = 'Cyber Security';
          else if (name === 'cloud-computing') backendCategory = 'Cloud Computing';
          else if (name === 'operating-systems') backendCategory = 'Operating Systems';

          const categoryQuestions = allQuestions.filter(
            q => q.category.toLowerCase() === backendCategory?.toLowerCase()
          );
          setQuestions(categoryQuestions);

          const uniqueSubtopics = Array.from(
            new Set(categoryQuestions.map(q => q.subtopic || 'General'))
          ).sort();
          
          if (uniqueSubtopics.length === 0) {
            uniqueSubtopics.push('General');
          }
          
          setSubtopics(uniqueSubtopics);
          setActiveSubtopic(uniqueSubtopics[0]);
        }
      } catch (err: any) {
        setError('Failed to fetch questions. Is the backend running?');
      } finally {
        setLoading(false);
      }
    };

    fetchQuestions();
  }, [name]);

  const filteredQuestions = questions.filter(
    q => (q.subtopic || 'General').toLowerCase() === activeSubtopic.toLowerCase()
  );

  return (
    <div className="category-view-container animate-fade-in">
      <div className="category-header">
        <button className="back-button" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={20} />
          <span>Dashboard</span>
        </button>
        <h1 className="page-title text-gradient">{categoryTitle}</h1>
      </div>

      <div className="category-content">
        {/* Sidebar Subtopics */}
        <aside className="subtopics-sidebar glass-panel">
          <h3 className="sidebar-title">Topics</h3>
          <ul className="subtopics-list">
            {subtopics.map(topic => (
              <li key={topic}>
                <button 
                  className={`subtopic-btn ${activeSubtopic === topic ? 'active' : ''}`}
                  onClick={() => setActiveSubtopic(topic)}
                >
                  <ChevronRight size={16} className="topic-icon" />
                  {topic}
                  <span className="topic-count">
                    {questions.filter(q => (q.subtopic || 'General').toLowerCase() === topic.toLowerCase()).length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Problems List */}
        <div className="problems-main glass-panel">
          <div className="problems-main-header">
            <h2>{activeSubtopic} Problems</h2>
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
              <span>Loading {activeSubtopic} challenges...</span>
            </div>
          ) : (
            <table className="problems-table">
              <thead>
                <tr>
                  <th className="status-col">Status</th>
                  <th>Title</th>
                  <th>Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuestions.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-state">
                      No questions available in {activeSubtopic} yet.
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
                        <span className={`difficulty-tag ${(q.difficulty || 'medium').toLowerCase()}`}>
                          {q.difficulty || 'Medium'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
