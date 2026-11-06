import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/prefs';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/data.css';
import './styles/overlay.css';
import './styles/feedback.css';
import './styles/shell.css';
import './styles/splash.css';
import './styles/demo.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('The #root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
