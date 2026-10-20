import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { Mail, Lock, User, AlertCircle, ArrowRight, Code2, GraduationCap, ShieldCheck } from 'lucide-react';
import './Auth.css';
import { API_BASE } from '../config';

export default function Signup() {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') === 'faculty' ? 'FACULTY' : 'STUDENT';
  const [role, setRole] = useState<'STUDENT' | 'FACULTY'>(initialRole);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const login = useAuthStore(state => state.login);

  useEffect(() => {
    if (searchParams.get('role') === 'faculty') {
      setRole('FACULTY');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/signup`, { 
        username, 
        email, 
        password,
        role 
      });
      if (response.data.success) {
        const user = response.data.user;
        login(user, response.data.token);
        if (user.role === 'FACULTY') {
          navigate('/staging');
        } else {
          navigate('/');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="siet-login-wrapper">
      <div className="siet-login-card animate-fade-in">
        {/* Brand header: IntelX */}
        <div className="siet-card-brand">
          <div className="siet-crest-box">
            <Code2 size={24} color="#00864B" />
          </div>
          <div className="siet-brand-text">
            <h1 className="siet-brand-name">INTELX</h1>
            <span className="siet-portal-tag">PLACEMENT PLATFORM</span>
          </div>
        </div>

        {/* Role Selector Tabs */}
        <div className="siet-role-tabs">
          <button
            type="button"
            className={`siet-role-tab ${role === 'STUDENT' ? 'active' : ''}`}
            onClick={() => setRole('STUDENT')}
          >
            <GraduationCap size={18} />
            <span>Student Account</span>
          </button>
          <button
            type="button"
            className={`siet-role-tab ${role === 'FACULTY' ? 'active' : ''}`}
            onClick={() => setRole('FACULTY')}
          >
            <ShieldCheck size={18} />
            <span>Faculty Account</span>
          </button>
        </div>

        {/* Create Account headings */}
        <div className="siet-login-headings">
          <h2 className="siet-login-title">
            {role === 'STUDENT' ? 'Register Student' : 'Register Faculty'}
          </h2>
        </div>

        {error && (
          <div className="siet-login-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="siet-login-form">
          <div className="siet-form-field">
            <label className="siet-form-label">FULL NAME / USERNAME</label>
            <div className="siet-input-container">
              <User size={18} className="siet-input-icon" />
              <input 
                type="text" 
                className="siet-login-input" 
                placeholder={role === 'STUDENT' ? 'Student Full Name' : 'Faculty Name / Title'} 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="siet-form-field">
            <label className="siet-form-label">EMAIL ADDRESS</label>
            <div className="siet-input-container">
              <Mail size={18} className="siet-input-icon" />
              <input 
                type="email" 
                className="siet-login-input" 
                placeholder={role === 'STUDENT' ? 'student@example.com' : 'faculty@example.com'} 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          
          <div className="siet-form-field">
            <label className="siet-form-label">PASSWORD</label>
            <div className="siet-input-container">
              <Lock size={18} className="siet-input-icon" />
              <input 
                type="password" 
                className="siet-login-input" 
                placeholder="Create password (min 6 characters)" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="siet-submit-btn" disabled={isLoading}>
            <ArrowRight size={18} />
            <span>{isLoading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}</span>
          </button>
        </form>

        <div className="siet-auth-switch">
          <span>Already registered?</span>
          <Link to="/login">Sign In Here</Link>
        </div>
      </div>
    </div>
  );
}
