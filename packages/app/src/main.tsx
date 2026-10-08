import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initPwa } from './pwaUpdate';
import './style.css';

// アプリの枠を実際に見えている高さに合わせる（モバイルのアドレスバー・キーボード対策）。
function fitViewport(): void {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  document.documentElement.style.setProperty('--app-h', `${h}px`);
}
fitViewport();
window.visualViewport?.addEventListener('resize', fitViewport);
window.addEventListener('resize', fitViewport);

initPwa();

const el = document.getElementById('root');
if (!el) throw new Error('root element not found');
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
