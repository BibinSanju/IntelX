import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { CheckCircle } from 'lucide-react';
import './Profile.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://intelx-148e.onrender.com';

interface UserData {
  username: string;
  joinedAt: string;
  rank: number;
  reputation: number;
  views: number;
  discuss: number;
  solution: number;
  stats: {
    totalSolved: number;
    difficultyBreakdown: {
      Easy: number;
      Medium: number;
      Hard: number;
    };
    calendarHeatmap: Record<string, number>;
    totalActiveDays: number;
    maxStreak: number;
  };
  totalAvailable?: {
    Total: number;
    Easy: number;
    Medium: number;
    Hard: number;
  };
}

// Simple component to render the heatmap
const Heatmap = ({ data }: { data: Record<string, number> }) => {
  // Generate last 52 weeks (364 days)
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  return (
    <div className="heatmap-grid">
      {days.map((date, idx) => {
        const dateStr = date.toISOString().split('T')[0];
        const count = data[dateStr] || 0;
        let level = 0;
        if (count > 0) level = 1;
        if (count >= 2) level = 2;
        if (count >= 4) level = 3;
        if (count >= 6) level = 4;
        
        return (
          <div 
            key={idx} 
            className={`heatmap-cell level-${level}`} 
            title={`${dateStr}: ${count} submissions`}
          />
        );
      })}
    </div>
  );
};

export default function Profile() {
  const { user } = useAuthStore();
  const [profileData, setProfileData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      try {
        const response = await axios.get(`${API_BASE}/users/${user.id}`);
        if (response.data.success) {
          setProfileData(response.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch profile', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user]);

  if (loading) {
    return (
      <div className="container flex-center" style={{ minHeight: '60vh' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="container flex-center">
        <h2>Profile not found</h2>
      </div>
    );
  }

  const { stats, totalAvailable } = profileData;
  
  // Use DB data if available, fallback to 0 to avoid crashes
  const TOTAL_QUESTIONS = totalAvailable?.Total || 0;
  const TOTAL_EASY = totalAvailable?.Easy || 0;
  const TOTAL_MEDIUM = totalAvailable?.Medium || 0;
  const TOTAL_HARD = totalAvailable?.Hard || 0;

  const totalSolved = stats?.totalSolved || 0;
  const solvedPercentage = TOTAL_QUESTIONS > 0 ? (totalSolved / TOTAL_QUESTIONS) * 100 : 0;
  
  const rank = profileData.rank || 0;
  const reputation = profileData.reputation || 0;
  const solution = profileData.solution || 0;
  const discuss = profileData.discuss || 0;
  const diffEasy = stats?.difficultyBreakdown?.Easy || 0;
  const diffMedium = stats?.difficultyBreakdown?.Medium || 0;
  const diffHard = stats?.difficultyBreakdown?.Hard || 0;
  const totalActiveDays = stats?.totalActiveDays || 0;
  const maxStreak = stats?.maxStreak || 0;
  const calendarHeatmap = stats?.calendarHeatmap || {};

  return (
    <div className="leetcode-profile-container animate-fade-in">
      {/* Left Sidebar */}
      <aside className="profile-sidebar">
        <div className="user-info-card glass-panel">
          <div className="avatar-section">
            <div className="avatar">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9ca3af" className="w-full h-full">
                <path fillRule="evenodd" d="M12 2.25c-2.42 0-4.38 1.96-4.38 4.38 0 2.41 1.96 4.37 4.38 4.37s4.38-1.96 4.38-4.37c0-2.42-1.96-4.38-4.38-4.38ZM7.5 13.5c-3.13 0-5.67 2.37-6 5.43a.75.75 0 0 0 .75.82h19.5a.75.75 0 0 0 .75-.82c-.33-3.06-2.87-5.43-6-5.43H7.5Z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="user-details">
              <h1>{profileData.username}</h1>
              <p className="username-handle">@{profileData.username.toLowerCase()}</p>
              <p className="text-muted text-xs mt-1">Joined {new Date(profileData.joinedAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="profile-main">
        {/* Solved Stats */}
        <div className="solved-card glass-panel">
          <div className="circle-progress-container">
            <svg viewBox="0 0 100 100" className="circle-svg">
              <circle cx="50" cy="50" r="45" className="circle-bg" />
              <circle 
                cx="50" cy="50" r="45" 
                className="circle-fill" 
                strokeDasharray="283" 
                strokeDashoffset={283 - (283 * solvedPercentage) / 100}
              />
            </svg>
            <div className="circle-content">
              <span className="solved-count">{totalSolved}</span>
              <span className="solved-total">/ {TOTAL_QUESTIONS}</span>
              <span className="solved-label"><CheckCircle size={14}/> Solved</span>
            </div>
          </div>

          <div className="difficulty-bars">
            <div className="diff-bar-wrapper">
              <div className="diff-label">Easy</div>
              <div className="diff-counts"><span>{diffEasy}</span>/{TOTAL_EASY}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill easy" style={{ width: `${TOTAL_EASY > 0 ? (diffEasy/TOTAL_EASY)*100 : 0}%`}}></div>
              </div>
            </div>
            <div className="diff-bar-wrapper">
              <div className="diff-label">Med.</div>
              <div className="diff-counts"><span>{diffMedium}</span>/{TOTAL_MEDIUM}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill medium" style={{ width: `${TOTAL_MEDIUM > 0 ? (diffMedium/TOTAL_MEDIUM)*100 : 0}%`}}></div>
              </div>
            </div>
            <div className="diff-bar-wrapper">
              <div className="diff-label">Hard</div>
              <div className="diff-counts"><span>{diffHard}</span>/{TOTAL_HARD}</div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill hard" style={{ width: `${TOTAL_HARD > 0 ? (diffHard/TOTAL_HARD)*100 : 0}%`}}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Submissions Calendar Heatmap */}
        <div className="heatmap-card glass-panel">
          <div className="heatmap-header">
            <h3>{totalSolved} submissions in the past one year</h3>
            <div className="heatmap-stats">
              <span>Total active days: <strong>{totalActiveDays}</strong></span>
              <span>Max streak: <strong>{maxStreak}</strong></span>
            </div>
          </div>
          <div className="heatmap-wrapper">
            <Heatmap data={calendarHeatmap} />
            <div className="heatmap-months">
              <span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span>
              <span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span>
              <span>Apr</span><span>May</span><span>Jun</span><span>Jul</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
