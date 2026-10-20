import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { 
  Code2,
  Sparkles, 
  Layers, 
  FileCode2, 
  HelpCircle, 
  LayoutDashboard, 
  User as UserIcon, 
  LogOut, 
  Bell,
  GraduationCap,
  ShieldCheck
} from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/' && (location.pathname === '/' || location.pathname === '/submit-prompt')) return true;
    return location.pathname.startsWith(path) && path !== '/';
  };

  const userRole = user?.role || 'STUDENT';
  const brandTarget = !isAuthenticated ? '/login' : (userRole === 'FACULTY' ? '/staging' : '/');

  return (
    <nav className="siet-navbar">
      <div className="siet-nav-container">
        {/* Brand: IntelX with Clean Modern Emblem */}
        <Link to={brandTarget} className="siet-brand">
          <div className="siet-logo-badge">
            <Code2 size={24} className="siet-brand-icon" />
          </div>
          <div className="siet-brand-text">
            <span className="siet-brand-title">INTELX</span>
            <span className="siet-brand-tag">
              {isAuthenticated ? (userRole === 'FACULTY' ? 'FACULTY PORTAL' : 'STUDENT PORTAL') : 'PLACEMENT PLATFORM'}
            </span>
          </div>
        </Link>
        
        {/* Navigation Links based on Role */}
        <div className="siet-nav-links">
          {isAuthenticated && userRole === 'FACULTY' && (
            <>
              <Link to="/staging" className={`siet-nav-pill ${isActive('/staging') ? 'active' : ''}`}>
                <Layers size={16} />
                <span>Faculty Staging</span>
              </Link>

              <Link to="/export" className={`siet-nav-pill ${isActive('/export') ? 'active' : ''}`}>
                <FileCode2 size={16} />
                <span>Moodle XML</span>
              </Link>

              <Link to="/problems" className={`siet-nav-pill ${isActive('/problems') ? 'active' : ''}`}>
                <HelpCircle size={16} />
                <span>Question Bank</span>
              </Link>

              <Link to="/dashboard" className={`siet-nav-pill ${isActive('/dashboard') ? 'active' : ''}`}>
                <LayoutDashboard size={16} />
                <span>Domains</span>
              </Link>
            </>
          )}
        </div>

        {/* Right Section / User & Utilities */}
        <div className="siet-nav-right">
          <button className="siet-icon-btn" title="Notifications" aria-label="Notifications">
            <Bell size={18} />
          </button>

          {isAuthenticated ? (
            <div className="siet-auth-user">
              <Link to="/profile" className="siet-profile-pill">
                <div className="siet-avatar-circle">
                  {userRole === 'FACULTY' ? <ShieldCheck size={14} /> : <GraduationCap size={14} />}
                </div>
                <div className="siet-user-meta">
                  <span className="siet-username">{user?.username || 'User'}</span>
                  <span className={`siet-role-badge ${userRole === 'FACULTY' ? 'faculty' : 'student'}`}>
                    {userRole === 'FACULTY' ? 'FACULTY' : 'STUDENT'}
                  </span>
                </div>
              </Link>
              <button onClick={handleLogout} className="siet-logout-btn" title="Log out" aria-label="Logout">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="siet-auth-buttons">
              <Link to="/login" className="siet-login-btn">Sign in</Link>
              <Link to="/signup" className="siet-signup-btn">Get Started</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
