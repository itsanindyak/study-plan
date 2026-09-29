import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useSettingsStore } from './store/useSettingsStore';

import './styles/globals.css';
import './styles/layout.css';
import './styles/timeline.css';
import './styles/sessions.css';
import './styles/deadlines.css';
import './styles/modal.css';
import './styles/notes.css';
import './styles/focus.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

document.documentElement.dataset.theme = useSettingsStore.getState().theme;

useSettingsStore.subscribe((state) => {
  document.documentElement.dataset.theme = state.theme;
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
