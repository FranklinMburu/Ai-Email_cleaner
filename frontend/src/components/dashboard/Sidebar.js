import React from 'react';

/**
 * Sidebar - Modern navigation sidebar with collapsible menu
 */
export function Sidebar({ currentTab, setTab, userEmail, onLogout }) {
  const [collapsed, setCollapsed] = React.useState(false);

  const navItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'recommendations', label: 'Recommendations', icon: '✨' },
    { id: 'actions', label: 'Actions', icon: '⚡' },
    { id: 'logs', label: 'Logs', icon: '📋' },
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon">📧</span>
          {!collapsed && <span className="logo-text">Gmail Cleaner</span>}
        </div>
        <button 
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentTab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
            title={collapsed ? item.label : ''}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User Section */}
      <div className="sidebar-footer">
        <div className="user-info">
          <div className="user-avatar">
            {userEmail[0].toUpperCase()}
          </div>
          {!collapsed && (
            <div className="user-details">
              <div className="user-email">{userEmail}</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button 
            className="logout-btn"
            onClick={onLogout}
            title="Disconnect"
          >
            🚪
          </button>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
