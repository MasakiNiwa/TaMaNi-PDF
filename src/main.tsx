import './core/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/pages.css';
import './styles/redact.css';

/**
 * 他サイトの iframe に埋め込まれた状態で動かさない。
 * CSP の frame-ancestors は <meta> では効かないため、ここでも確認する。
 * クリックジャッキングでファイル選択を誘導されるのを防ぐのが狙い。
 */
if (window.top !== window.self) {
  document.body.textContent = 'たまにPDF は他のサイトに埋め込んだ状態では利用できません。';
} else {
  const container = document.getElementById('root');
  if (container) {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}
