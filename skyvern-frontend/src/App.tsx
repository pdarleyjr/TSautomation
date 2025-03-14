import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Sidebar from './components/Sidebar';
import './App.css';

const App: React.FC = () => {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workflows" element={<Dashboard />} />
          <Route path="/tasks" element={<Dashboard />} />
          <Route path="/settings" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;