import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

interface ProtectedRouteProps {
  children: React.ReactElement;
  allowedRole?: 'STUDENT' | 'FACULTY';
}

export default function ProtectedRoute({ children, allowedRole }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const userRole = user.role || 'STUDENT';

  // Role check
  if (allowedRole && userRole !== allowedRole) {
    if (userRole === 'STUDENT') {
      // Students only have access to Feeder
      return <Navigate to="/" replace />;
    } else {
      // Faculty redirected away from student feeder to staging
      return <Navigate to="/staging" replace />;
    }
  }

  return children;
}
