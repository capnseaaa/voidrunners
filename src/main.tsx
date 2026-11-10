import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/** Last-resort boundary: a UI crash shows a recoverable message instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('VOIDRUNNERS crashed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app crt">
        <div className="modal">
          <div className="panel">
            <h2>System Fault</h2>
            <p>Something went wrong. Your saved progress is safe.</p>
            <p className="err">{String(this.state.error.message || this.state.error)}</p>
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
