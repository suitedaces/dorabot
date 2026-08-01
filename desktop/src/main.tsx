import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './globals.css';

// Without a boundary here, one throw anywhere outside the editor panel unmounts
// the whole root and the window goes blank with no way back. Reload rather than
// re-render, because a root-level failure usually recurs on retry.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary onReset={() => window.location.reload()}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
