import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import CategoryView from './pages/CategoryView';
import ProblemsList from './pages/ProblemsList';
import ProblemDetails from './pages/ProblemDetails';
import SubmitPrompt from './pages/SubmitPrompt';
import Profile from './pages/Profile';
import Export from './pages/Export';
import Staging from './pages/Staging';
import { useAuthStore } from './store/useAuthStore';

function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <Router>
      <div className="app-container">
        <Navbar />
        <main>
          <Routes>
            <Route 
              path="/" 
              element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />} 
            />
            <Route 
              path="/login" 
              element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} 
            />
            <Route 
              path="/signup" 
              element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Signup />} 
            />
            <Route 
              path="/dashboard" 
              element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" replace />} 
            />
            <Route 
              path="/category/:name" 
              element={isAuthenticated ? <CategoryView /> : <Navigate to="/login" replace />} 
            />
            <Route path="/submit-prompt" element={<SubmitPrompt />} />
            <Route path="/problems" element={<ProblemsList />} />
            <Route path="/problems/:id" element={<ProblemDetails />} />
            <Route path="/export" element={<Export />} />
            <Route path="/staging" element={<Staging />} />
            <Route 
              path="/profile" 
              element={isAuthenticated ? <Profile /> : <Navigate to="/login" replace />} 
            />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
