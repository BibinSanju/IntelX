import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { Mail, Lock, User, AlertCircle } from 'lucide-react';
import './Auth.css';
import { API_BASE } from '../config';

export default function Signup() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const login = useAuthStore(state => state.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/signup`, { username, email, password });
      if (response.data.success) {
        login(response.data.user, response.data.token);
        navigate('/problems');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to sign up');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container container flex-center">
      <div className="auth-card glass-panel animate-fade-in">
        <h2 className="auth-title">Create Account</h2>
        <p className="auth-subtitle">Join us and start solving problems today.</p>

        {error && (
          <div className="auth-error flex-center">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <div className="input-icon">
              <User size={18} />
            </div>
            <input 
              type="text" 
              className="input-field with-icon" 
              placeholder="Username" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <div className="input-icon">
              <Mail size={18} />
            </div>
            <input 
              type="email" 
              className="input-field with-icon" 
              placeholder="Email address" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div className="input-group">
            <div className="input-icon">
              <Lock size={18} />
            </div>
            <input 
              type="password" 
              className="input-field with-icon" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary auth-submit" disabled={isLoading}>
            {isLoading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="auth-footer">
          <p>Already have an account? <Link to="/login">Log in</Link></p>
        </div>
      </div>
    </div>
  );
}
