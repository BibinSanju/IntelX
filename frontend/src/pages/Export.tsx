import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Download, AlertCircle, CheckSquare, Square, ChevronDown, ChevronRight } from 'lucide-react';
import './Export.css';
import { API_BASE } from '../config';

interface Question {
  id: string;
  category: string;
  subtopic?: string;
  title: string;
  description: string;
  testCases?: any;
  companies?: string[];
}

export default function Export() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<'topic' | 'company'>('topic');
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
        setError('Failed to fetch questions.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchQuestions();
  }, []);

  // Group questions dynamically based on groupBy state
  const groupedQuestions = questions.reduce((acc, q) => {
    if (groupBy === 'topic') {
      const topic = q.subtopic || q.category || 'General';
      if (!acc[topic]) acc[topic] = [];
      acc[topic].push(q);
    } else if (groupBy === 'company') {
      const companies = q.companies && q.companies.length > 0 ? q.companies : ['No Company'];
      companies.forEach(company => {
        if (!acc[company]) acc[company] = [];
        // Prevent duplicate pushes if a question has duplicate company tags somehow
        if (!acc[company].find(existing => existing.id === q.id)) {
          acc[company].push(q);
        }
      });
    }
    return acc;
  }, {} as Record<string, Question[]>);

  const toggleGroupExpand = (topic: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(topic)) {
      newExpanded.delete(topic);
    } else {
      newExpanded.add(topic);
    }
    setExpandedGroups(newExpanded);
  };

  const toggleGroupSelect = (topic: string, groupQuestions: Question[]) => {
    const groupIds = groupQuestions.map(q => q.id);
    const allSelected = groupIds.every(id => selectedIds.has(id));
    
    const newSelected = new Set(selectedIds);
    if (allSelected) {
      // Deselect all
      groupIds.forEach(id => newSelected.delete(id));
    } else {
      // Select all
      groupIds.forEach(id => newSelected.add(id));
    }
    setSelectedIds(newSelected);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const selected = questions.filter((q) => selectedIds.has(q.id));
    downloadFile('intelx_export.json', JSON.stringify(selected, null, 2), 'application/json');
  };

  const exportTXT = () => {
    const selected = questions.filter((q) => selectedIds.has(q.id));
    let txtContent = 'IntelX Problem Export\n=====================\n\n';

    selected.forEach((q) => {
      txtContent += `Title: ${q.title}\n`;
      txtContent += `Category: ${q.category}\n`;
      txtContent += `Subtopic: ${q.subtopic || 'N/A'}
`;
      txtContent += `Description:\n${q.description.replace(/<[^>]+>/g, '')}\n\n`;

      if (q.testCases && Array.isArray(q.testCases)) {
        txtContent += `Test Cases:\n`;
        q.testCases.forEach((tc: any, idx: number) => {
          txtContent += `  Case ${idx + 1}:\n`;
          txtContent += `    Input: ${JSON.stringify(tc.input)}\n`;
          txtContent += `    Output: ${JSON.stringify(tc.expectedOutput)}\n`;
        });
      }
      txtContent += '\n----------------------------------------\n\n';
    });

    downloadFile('intelx_export.txt', txtContent, 'text/plain');
  };

  const exportMoodleXML = () => {
    const selected = questions.filter((q) => selectedIds.has(q.id));
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n';

    selected.forEach((q) => {
      let testcasesXml = '';
      if (q.testCases && Array.isArray(q.testCases)) {
        q.testCases.forEach((tc: any, idx: number) => {
          const inputStr = JSON.stringify(tc.input);
          const outputStr = JSON.stringify(tc.expectedOutput);
          testcasesXml += `
    <testcase testtype="0" useasexample="${idx === 0 ? '1' : '0'}" hiderestiffail="0" mark="1.0000000" >
      <testcode>
        <text><![CDATA[${inputStr}]]></text>
      </testcode>
      <expected>
        <text><![CDATA[${outputStr}]]></text>
      </expected>
    </testcase>`;
        });
      }

      xml += `
  <question type="coderunner">
    <name>
      <text><![CDATA[${q.title}]]></text>
    </name>
    <questiontext format="html">
      <text><![CDATA[${q.description}]]></text>
    </questiontext>
    <coderunnertype>python3</coderunnertype>
    <testcases>
${testcasesXml}
    </testcases>
  </question>\n`;
    });

    xml += '</quiz>';
    downloadFile('moodle_coderunner_export.xml', xml, 'application/xml');
  };

  return (
    <div className="container export-container animate-fade-in">
      <div className="export-header flex-between">
        <div>
          <h1 className="page-title text-gradient">Bulk Export</h1>
          <p className="page-subtitle">Download grouped questions for your LMS or Moodle portal.</p>
        </div>
        
        <div className="group-toggle">
          <button 
            className={`toggle-btn ${groupBy === 'topic' ? 'active' : ''}`}
            onClick={() => { setGroupBy('topic'); setExpandedGroups(new Set()); }}
          >
            By Topic
          </button>
          <button 
            className={`toggle-btn ${groupBy === 'company' ? 'active' : ''}`}
            onClick={() => { setGroupBy('company'); setExpandedGroups(new Set()); }}
          >
            By Company
          </button>
        </div>

        <div className="export-actions">
          <button 
            className="btn-secondary" 
            onClick={exportTXT}
            disabled={selectedIds.size === 0}
          >
            <Download size={18} /> TXT
          </button>
          <button 
            className="btn-secondary" 
            onClick={exportJSON}
            disabled={selectedIds.size === 0}
          >
            <Download size={18} /> JSON
          </button>
          <button 
            className="btn-primary" 
            onClick={exportMoodleXML}
            disabled={selectedIds.size === 0}
          >
            <Download size={18} /> Moodle XML
          </button>
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
          <span>Loading questions...</span>
        </div>
      ) : (
        <div className="groups-container">
          {Object.keys(groupedQuestions).length === 0 ? (
            <div className="empty-state glass-panel">No questions found.</div>
          ) : (
            Object.entries(groupedQuestions).map(([topic, groupQs]) => {
              const groupIds = groupQs.map(q => q.id);
              const allSelected = groupIds.every(id => selectedIds.has(id));
              const someSelected = groupIds.some(id => selectedIds.has(id));
              const isExpanded = expandedGroups.has(topic);

              return (
                <div key={topic} className="topic-group glass-panel">
                  <div className="topic-header">
                    <div 
                      className="topic-checkbox"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGroupSelect(topic, groupQs);
                      }}
                    >
                      {allSelected ? (
                        <CheckSquare size={20} className="text-primary" />
                      ) : someSelected ? (
                        <Square size={20} className="text-primary" style={{ opacity: 0.7 }} />
                      ) : (
                        <Square size={20} className="text-secondary" />
                      )}
                    </div>
                    <div 
                      className="topic-title-area"
                      onClick={() => toggleGroupExpand(topic)}
                    >
                      <h3 className="topic-title">{topic} <span className="topic-count">({groupQs.length})</span></h3>
                      {isExpanded ? <ChevronDown size={20} className="text-secondary" /> : <ChevronRight size={20} className="text-secondary" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="topic-content">
                      <table className="export-table nested-table">
                        <tbody>
                          {groupQs.map((q) => {
                            const isSelected = selectedIds.has(q.id);
                            return (
                              <tr 
                                key={q.id} 
                                className={`export-row ${isSelected ? 'selected' : ''}`}
                                onClick={() => toggleSelect(q.id)}
                              >
                                <td className="checkbox-col">
                                  {isSelected ? (
                                    <CheckSquare size={18} className="text-primary" />
                                  ) : (
                                    <Square size={18} className="text-secondary" />
                                  )}
                                </td>
                                <td className="font-medium">{q.title}</td>
                                <td><span className="category-tag">{q.category}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
