/**
 * Custom hook for managing user authentication state and session
 */
import { useState, useCallback, useEffect } from 'react';

export const useAuthSession = () => {
  const [userEmail, setUserEmail] = useState(() => {
    return localStorage.getItem('userEmail') || '';
  });

  const [sessionId, setSessionId] = useState(() => {
    return localStorage.getItem('sessionId') || '';
  });

  const isAuthenticated = userEmail && sessionId;

  useEffect(() => {
    if (userEmail) {
      localStorage.setItem('userEmail', userEmail);
    } else {
      localStorage.removeItem('userEmail');
    }
  }, [userEmail]);

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('sessionId', sessionId);
    } else {
      localStorage.removeItem('sessionId');
    }
  }, [sessionId]);

  const login = useCallback((email, session) => {
    setUserEmail(email);
    setSessionId(session);
  }, []);

  const logout = useCallback(() => {
    setUserEmail('');
    setSessionId('');
  }, []);

  return {
    userEmail,
    sessionId,
    isAuthenticated,
    login,
    logout,
  };
};
