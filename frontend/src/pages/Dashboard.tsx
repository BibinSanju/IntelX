import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Code2, 
  BrainCircuit, 
  Network, 
  Cpu, 
  Layout, 
  Database, 
  Cloud, 
  ShieldCheck, 
  ArrowRight,
  Sparkles
} from 'lucide-react';
import './Dashboard.css';

const categories = [
  {
    id: 'dsa',
    name: 'Data Structures and Algorithms',
    shortName: 'DSA',
    icon: Code2,
    color: '#00864B',
    bgColor: '#e8f5ee',
    questionsCount: 45,
    description: 'Master core problem solving, recursion, graphs, dynamic programming, and LeetCode patterns.'
  },
  {
    id: 'machine-learning',
    name: 'Machine Learning & AI',
    shortName: 'ML',
    icon: BrainCircuit,
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    questionsCount: 28,
    description: 'Neural networks, PyTorch, model optimization, supervised algorithms, and generative AI.'
  },
  {
    id: 'system-design',
    name: 'System Design & Architecture',
    shortName: 'SYS-DESIGN',
    icon: Layout,
    color: '#b45309',
    bgColor: '#fffbeb',
    questionsCount: 18,
    description: 'Scalability, microservices, load balancers, caching strategies, and distributed storage.'
  },
  {
    id: 'dbms',
    name: 'Database Management Systems',
    shortName: 'DBMS',
    icon: Database,
    color: '#0284c7',
    bgColor: '#f0f9ff',
    questionsCount: 32,
    description: 'SQL queries, ACID transactions, indexing, B-Trees, normalization, and NoSQL engines.'
  },
  {
    id: 'computer-networks',
    name: 'Computer Networks',
    shortName: 'NETWORKING',
    icon: Network,
    color: '#2563eb',
    bgColor: '#eff6ff',
    questionsCount: 22,
    description: 'TCP/IP stack, socket programming, HTTP/3, routing protocols, and CDN architectures.'
  },
  {
    id: 'cyber-security',
    name: 'Cyber Security & Cryptography',
    shortName: 'SECURITY',
    icon: ShieldCheck,
    color: '#059669',
    bgColor: '#ecfdf5',
    questionsCount: 16,
    description: 'OWASP Top 10, penetration testing, symmetric/asymmetric encryption, and network defense.'
  },
  {
    id: 'cloud-computing',
    name: 'Cloud Computing & DevOps',
    shortName: 'CLOUD',
    icon: Cloud,
    color: '#0891b2',
    bgColor: '#ecfeff',
    questionsCount: 20,
    description: 'Docker containers, Kubernetes orchestration, AWS, GCP, CI/CD pipelines, and Terraform.'
  },
  {
    id: 'operating-systems',
    name: 'Operating Systems & Kernels',
    shortName: 'OS',
    icon: Cpu,
    color: '#e11d48',
    bgColor: '#fff1f2',
    questionsCount: 24,
    description: 'Process scheduling, deadlocks, memory virtualization, POSIX threads, and paging.'
  }
];

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="siet-domains-container animate-fade-in">

      {/* Domain Header */}
      <div className="siet-domains-header">
        <div className="siet-badge-green">
          <Sparkles size={14} /> Placement Curricula
        </div>
        <h1 className="siet-domains-title">Technical Domains &amp; Assessment Tracks</h1>
        <p className="siet-domains-subtitle">
          Select a core engineering domain to practice problem sets, review interview questions, and prepare for campus drives.
        </p>
      </div>

      {/* Grid of Domain Cards */}
      <div className="siet-categories-grid">
        {categories.map((cat) => (
          <div 
            key={cat.id} 
            className="siet-category-card" 
            onClick={() => navigate(`/category/${cat.id}`)}
          >
            <div className="cat-card-top">
              <div 
                className="siet-cat-icon-box" 
                style={{ backgroundColor: cat.bgColor, color: cat.color }}
              >
                <cat.icon size={28} />
              </div>
              <span className="cat-q-count">{cat.questionsCount} Problems</span>
            </div>

            <div className="cat-card-body">
              <span className="siet-cat-tag" style={{ color: cat.color }}>{cat.shortName}</span>
              <h2 className="siet-cat-name">{cat.name}</h2>
              <p className="siet-cat-desc">{cat.description}</p>
            </div>

            <div className="cat-card-footer">
              <span className="cat-explore-text">Explore Questions</span>
              <ArrowRight size={16} className="cat-arrow" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
