import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';

const Sidebar: React.FC = () => {
  const location = useLocation();
  
  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="logo">SKYVERN</h1>
      </div>
      <nav className="sidebar-nav">
        <ul>
          <li>
            <Link to="/" className={isActive('/') ? 'active' : ''}>
              <span className="icon">📊</span>
              <span>Dashboard</span>
            </Link>
          </li>
          <li>
            <Link to="/workflows" className={isActive('/workflows') ? 'active' : ''}>
              <span className="icon">⚡</span>
              <span>Workflows</span>
            </Link>
          </li>
          <li>
            <Link to="/tasks" className={isActive('/tasks') ? 'active' : ''}>
              <span className="icon">📝</span>
              <span>Tasks</span>
            </Link>
          </li>
          <li>
            <Link to="/settings" className={isActive('/settings') ? 'active' : ''}>
              <span className="icon">⚙️</span>
              <span>Settings</span>
            </Link>
          </li>
        </ul>
      </nav>
      <div className="sidebar-footer">
        <a href="https://docs.skyvern.com" target="_blank" rel="noopener noreferrer">
          <span className="icon">📚</span>
          <span>API Docs</span>
        </a>
      </div>
    </aside>
  );
};

export default Sidebar;