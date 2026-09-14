import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { APP_NAME, APP_TAGLINE, APP_VERSION, REPO_URL } from './version';
import { hrefFor, ROUTES, type RouteDef } from './routes';

function NavItems({ current }: { current: RouteDef }) {
  return (
    <>
      {ROUTES.filter((route) => route.inNav).map((route) => (
        <a
          key={route.id}
          className="nav-item"
          href={hrefFor(route)}
          aria-current={route.id === current.id ? 'page' : undefined}
        >
          <span className="nav-item__indicator">
            <Icon name={route.icon} size={20} />
          </span>
          {route.navLabel}
        </a>
      ))}
    </>
  );
}

export function AppShell({ route, children }: { route: RouteDef; children: ReactNode }) {
  return (
    <div className="app">
      <header className="app-bar">
        <a className="app-bar__brand" href={hrefFor('home')}>
          <span className="app-bar__logo" aria-hidden="true">
            PDF
          </span>
          <span className="app-bar__titles">
            <span className="app-bar__title">{APP_NAME}</span>
            <span className="app-bar__tagline">{APP_TAGLINE}</span>
          </span>
        </a>
        <div className="spacer" />
        <div className="app-bar__actions">
          <a
            className="icon-btn"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHubリポジトリを開く"
            title="GitHubリポジトリを開く"
          >
            <Icon name="file_copy" size={20} />
          </a>
          <a className="icon-btn" href={hrefFor('help')} aria-label="ヘルプ" title="ヘルプ">
            <Icon name="help" size={20} />
          </a>
        </div>
      </header>

      <div className="app__body">
        <nav className="nav-rail" aria-label="メインナビゲーション">
          <div className="nav-rail__list">
            <NavItems current={route} />
          </div>
        </nav>

        <main className="app__main">
          {children}
          <footer className="app-footer">
            <div className="app-footer__row">
              <span>
                {APP_NAME} v{APP_VERSION}
              </span>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href={hrefFor('help')}>ヘルプ</a>
              <a href={hrefFor('settings')}>設定</a>
            </div>
            <p className="text-small" style={{ marginTop: 8 }}>
              PDFの処理はすべてお使いのブラウザの中だけで行われます。ファイルがサーバーへ送られることはありません。
            </p>
          </footer>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <NavItems current={route} />
      </nav>
    </div>
  );
}
