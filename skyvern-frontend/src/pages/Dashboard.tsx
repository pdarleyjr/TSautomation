import React, { useState, useEffect } from 'react';
import './Dashboard.css';

interface Workflow {
  id: string;
  title: string;
  createdAt: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowTitle: string;
  status: 'completed' | 'running' | 'failed';
  createdAt: string;
}

const Dashboard: React.FC = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setWorkflows([]);
      setWorkflowRuns([]);
      setLoading(false);
    }, 1000);
  }, []);

  return (
    <div className="dashboard">
      <h1 className="page-title">Workflows</h1>
      
      <div className="dashboard-header">
        <p>Workflows are still in experimental mode. Please book a demo if you'd like to learn more.</p>
        <button className="button create-workflow-btn">
          <span className="button-icon">+</span>
          Create Workflow
        </button>
      </div>

      <div className="card">
        <h2>Workflows</h2>
        {loading ? (
          <p>Loading...</p>
        ) : workflows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>{workflow.id}</td>
                  <td>{workflow.title}</td>
                  <td>{new Date(workflow.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No workflows found</p>
        )}
      </div>

      <h2 className="section-title">Workflow Runs</h2>
      <div className="card">
        {loading ? (
          <p>Loading...</p>
        ) : workflowRuns.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Workflow ID</th>
                <th>Workflow Title</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {workflowRuns.map((run) => (
                <tr key={run.id}>
                  <td>{run.id}</td>
                  <td>{run.workflowId}</td>
                  <td>{run.workflowTitle}</td>
                  <td>
                    <span className={`status-badge ${run.status}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No workflow runs found</p>
        )}
      </div>
    </div>
  );
};

export default Dashboard;