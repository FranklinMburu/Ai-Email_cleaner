import React from 'react';
import LoginPage from './auth/LoginPage';
import DashboardLayout from './dashboard/DashboardLayout';
import { useAuthSession } from '../hooks/useAuthSession';
import { useNotifications } from '../hooks/useNotifications';
import './Dashboard.css';

/**
 * Dashboard - Root component that manages auth state and renders appropriate view
 * 
 * Refactored as a lightweight orchestrator that delegates to:
 * - LoginPage: OAuth authentication
 * - DashboardLayout: Main dashboard with tabs
 * 
 * Original 510-line monolith split into focused components:
 * - auth/LoginPage.js: OAuth login UI
 * - dashboard/DashboardLayout.js: Main state and header
 * - dashboard/DashboardTabs.js: Tab navigation coordinator
 * - dashboard/OverviewTab.js: Inbox overview and sync
 * - dashboard/RecommendationsTab.js: Report display with expandable categories
 * - dashboard/ActionsTab.js: Dry-run and execute operations
 * - dashboard/LogsTab.js: Paginated and searchable logs
 * - common/*: Shared UI components and hooks
 */
export function Dashboard() {
  const auth = useAuthSession();
  const notifications = useNotifications();

  const handleLogin = (userEmail, sessionId) => {
    auth.login(userEmail, sessionId);
  };

  const handleLogout = () => {
    auth.logout();
  };

  // Show login if not authenticated
  if (!auth.isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Show dashboard if authenticated
  return (
    <DashboardLayout
      userEmail={auth.userEmail}
      onLogout={handleLogout}
      notifications={notifications}
    />
  );
}

export default Dashboard;
