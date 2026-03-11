import React, { useState, useEffect } from 'react';
import api from '../../services/api';

/**
 * LoginPage - OAuth login page for Gmail authentication
 */
export function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Listen for OAuth messages from popup
    const handleOAuthMessage = (event) => {
      if (event.data && event.data.type === 'oauth_success') {
        onLogin(event.data.userEmail, event.data.sessionId);
      } else if (event.data && event.data.type === 'oauth_error') {
        setError('Auth error: ' + event.data.error);
      }
    };

    // Also check localStorage for fallback
    const checkLocalStorage = () => {
      const data = localStorage.getItem('oauth_success');
      if (data) {
        try {
          const parsed = JSON.parse(data);
          localStorage.removeItem('oauth_success');
          onLogin(parsed.userEmail, parsed.sessionId);
        } catch (err) {
          console.error('Error parsing oauth_success:', err);
        }
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    const timer = setInterval(checkLocalStorage, 500);

    return () => {
      window.removeEventListener('message', handleOAuthMessage);
      clearInterval(timer);
    };
  }, [onLogin]);

  const handleConnect = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.auth.initOAuth();
      const { authUrl } = res.data;

      // Open OAuth window
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      window.open(
        authUrl,
        'Gmail Auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>Gmail Inbox Cleanup Tool</h1>
        <p>Safe organization of your inbox with bulk actions</p>
        
        {error && <div className="login-error">{error}</div>}
        
        <button onClick={handleConnect} disabled={loading} className="btn btn-primary btn-large">
          {loading ? 'Connecting...' : 'Connect Gmail'}
        </button>
        
        <div className="features">
          <h3>Features</h3>
          <ul>
            <li>✓ Incremental sync of all messages</li>
            <li>✓ Rule-based categorization</li>
            <li>✓ Dry-run preview before action</li>
            <li>✓ Full audit logging</li>
            <li>✓ Protected emails never touched</li>
            <li>✓ Archive, label, or trash emails safely</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
