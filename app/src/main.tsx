import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

import './styles/globals.css';
import './styles/layout.css';
import './styles/timeline.css';
import './styles/sessions.css';
import './styles/deadlines.css';
import './styles/modal.css';
import './styles/focus.css';
import './styles/focus.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
