import React from 'react';
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
import ProtectedRoute from './components/ProtectedRoute';
import { useAuthStore } from './store/useAuthStore';

function App() {
  const { isAuthenticated, user } = useAuthStore();
  const userRole = user?.role || 'STUDENT';
  const defaultHome = !isAuthenticated ? '/login' : (userRole === 'FACULTY' ? '/staging' : '/');

  return (
    <Router>
      <div className="app-container">
        <Navbar />
        <main>
          <Routes>
            {/* Student-Only Question Feeder */}
            <Route 
              path="/" 
              element={
                <ProtectedRoute allowedRole="STUDENT">
                  <SubmitPrompt />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/submit-prompt" 
              element={
                <ProtectedRoute allowedRole="STUDENT">
                  <SubmitPrompt />
                </ProtectedRoute>
              } 
            />

            {/* Faculty-Only Portal Routes */}
            <Route 
              path="/staging" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <Staging />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/export" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <Export />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/problems" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <ProblemsList />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/problems/:id" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <ProblemDetails />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/category/:name" 
              element={
                <ProtectedRoute allowedRole="FACULTY">
                  <CategoryView />
                </ProtectedRoute>
              } 
            />

            {/* Authenticated Profile Route */}
            <Route 
              path="/profile" 
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              } 
            />

            {/* Public Authentication Routes */}
            <Route 
              path="/login" 
              element={isAuthenticated ? <Navigate to={defaultHome} replace /> : <Login />} 
            />
            <Route 
              path="/signup" 
              element={isAuthenticated ? <Navigate to={defaultHome} replace /> : <Signup />} 
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to={defaultHome} replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
