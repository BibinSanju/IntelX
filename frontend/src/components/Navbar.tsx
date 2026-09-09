import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { Code2, LogOut, User as UserIcon } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="navbar glass-header">
      <div className="container flex-between">
        <Link to="/" className="nav-brand flex-center">
          <Code2 size={28} className="brand-icon text-gradient" />
          <span className="brand-text">IntelX</span>
        </Link>
        
        <div className="nav-links flex-center">
          <Link to="/submit-prompt" className="nav-link">Submit Question</Link>
          <Link to="/problems" className="nav-link">Problems</Link>
          <Link to="/staging" className="nav-link">Staging</Link>
          <Link to="/export" className="nav-link">Export</Link>
          
          {isAuthenticated ? (
            <div className="auth-group flex-center">
              <Link to="/profile" className="nav-user flex-center">
                <UserIcon size={18} />
                <span>{user?.username}</span>
              </Link>
              <button onClick={handleLogout} className="btn-icon" aria-label="Logout">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="auth-group flex-center">
              <Link to="/login" className="nav-link">Log in</Link>
              <Link to="/signup" className="btn-primary">Sign up</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
