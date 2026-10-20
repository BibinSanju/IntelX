import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { Mail, Lock, AlertCircle, ArrowRight, Code2, GraduationCap, ShieldCheck, Zap } from 'lucide-react';
import './Auth.css';
import { API_BASE } from '../config';

export default function Login() {
  const [selectedRole, setSelectedRole] = useState<'STUDENT' | 'FACULTY'>('STUDENT');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const login = useAuthStore(state => state.login);

  const handleRoleTabChange = (role: 'STUDENT' | 'FACULTY') => {
    setSelectedRole(role);
    setError('');
  };

  const setDemoCredentials = (role: 'STUDENT' | 'FACULTY') => {
    setSelectedRole(role);
    if (role === 'STUDENT') {
      setIdentifier('student@intelx.edu');
      setPassword('Student@123');
    } else {
      setIdentifier('faculty@intelx.edu');
      setPassword('Faculty@123');
    }
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/login`, { 
        email: identifier, 
        password,
        expectedRole: selectedRole
      });
      if (response.data.success) {
        const user = response.data.user;
        login(user, response.data.token);
        
        // Role-based redirect
        if (user.role === 'FACULTY') {
          navigate('/staging');
        } else {
          navigate('/');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to login with provided credentials');
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
            className={`siet-role-tab ${selectedRole === 'STUDENT' ? 'active' : ''}`}
            onClick={() => handleRoleTabChange('STUDENT')}
          >
            <GraduationCap size={18} />
            <span>Student Portal</span>
          </button>
          <button
            type="button"
            className={`siet-role-tab ${selectedRole === 'FACULTY' ? 'active' : ''}`}
            onClick={() => handleRoleTabChange('FACULTY')}
          >
            <ShieldCheck size={18} />
            <span>Faculty Portal</span>
          </button>
        </div>

        {/* Welcome titles */}
        <div className="siet-login-headings">
          <h2 className="siet-login-title">
            {selectedRole === 'STUDENT' ? 'Student Sign In' : 'Faculty Sign In'}
          </h2>
        </div>

        {/* Quick Demo Logins Pill Strip */}
        <div className="siet-quick-demo-strip">
          <span className="siet-demo-label">
            <Zap size={14} /> Quick Demo:
          </span>
          <button 
            type="button" 
            className={`siet-demo-pill ${selectedRole === 'STUDENT' ? 'highlight' : ''}`}
            onClick={() => setDemoCredentials('STUDENT')}
          >
            Student
          </button>
          <button 
            type="button" 
            className={`siet-demo-pill ${selectedRole === 'FACULTY' ? 'highlight' : ''}`}
            onClick={() => setDemoCredentials('FACULTY')}
          >
            Faculty
          </button>
        </div>

        {error && (
          <div className="siet-login-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="siet-login-form">
          {/* Username / Email */}
          <div className="siet-form-field">
            <label className="siet-form-label">EMAIL OR USERNAME</label>
            <div className="siet-input-container">
              <Mail size={18} className="siet-input-icon" />
              <input 
                type="text" 
                className="siet-login-input" 
                placeholder={selectedRole === 'STUDENT' ? 'student@intelx.edu' : 'faculty@intelx.edu'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
          </div>
          
          {/* Password with Forgot Password link */}
          <div className="siet-form-field">
            <div className="siet-label-row">
              <label className="siet-form-label">PASSWORD</label>
              <button 
                type="button" 
                className="siet-forgot-link"
                onClick={() => alert('Demo passwords: Student@123 for Student, Faculty@123 for Faculty')}
              >
                Forgot Password?
              </button>
            </div>
            <div className="siet-input-container">
              <Lock size={18} className="siet-input-icon" />
              <input 
                type="password" 
                className="siet-login-input" 
                placeholder="••••••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Submit button: Green Pill */}
          <button type="submit" className="siet-submit-btn" disabled={isLoading}>
            <ArrowRight size={18} />
            <span>{isLoading ? 'SIGNING IN...' : 'SIGN IN'}</span>
          </button>
        </form>

        <div className="siet-auth-switch">
          <span>Need an account?</span>
          <Link to={`/signup?role=${selectedRole.toLowerCase()}`}>Register Here</Link>
        </div>
      </div>
    </div>
  );
}
