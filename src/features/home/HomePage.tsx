import { APP_NAME, APP_TAGLINE } from '../../app/version';
import { hrefFor, ROUTES } from '../../app/routes';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/primitives';

export function HomePage() {
  const tools = ROUTES.filter((route) => route.id !== 'home');

  return (
    <div className="page">
      <section className="home-hero">
        <h1 className="home-hero__title">{APP_NAME}</h1>
        <p className="home-hero__copy">{APP_TAGLINE}</p>
      </section>

      <div className="stack" style={{ marginBottom: 24 }}>
        <Banner tone="privacy">
          <strong>ファイルはこの端末から出ません。</strong>
          <br />
          PDFの読み込み・編集・書き出しはすべてブラウザの中で完結します。アップロードも会員登録も不要です。
        </Banner>
      </div>

      <section className="section">
        <h2 className="section__title">できること</h2>
        <div className="tool-grid">
          {tools.map((route) => (
            <a key={route.id} className="tool-card" href={hrefFor(route)}>
              <span className="tool-card__icon">
                <Icon name={route.icon} size={22} />
              </span>
              <span>
                <span className="tool-card__title">{route.label}</span>
                <span className="tool-card__desc">{route.description}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">はじめての方へ</h2>
        <div className="card card--outlined">
          <ol style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>やりたいことに合わせて上のカードを選びます。</li>
            <li>PDFをドラッグ&ドロップ、またはタップして選びます。</li>
            <li>編集して「書き出し」を押すと、端末にPDFが保存されます。</li>
          </ol>
          <p className="text-small muted" style={{ marginTop: 12, marginBottom: 0 }}>
            くわしい使い方と注意点は <a href={hrefFor('help')}>ヘルプ</a> にまとめています。
          </p>
        </div>
      </section>
    </div>
  );
}
