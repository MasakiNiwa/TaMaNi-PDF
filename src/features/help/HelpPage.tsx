import { hrefFor } from '../../app/routes';
import { APP_NAME, APP_VERSION, ISSUES_URL, REPO_URL } from '../../app/version';
import { Icon } from '../../ui/Icon';
import { Banner } from '../../ui/primitives';

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="card card--outlined" style={{ marginBottom: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{question}</summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

export function HelpPage() {
  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">
          <Icon name="help" size={24} />
          ヘルプ
        </h1>
        <p className="page__lead">{APP_NAME} の使い方と、知っておいてほしい注意点をまとめています。</p>
      </header>

      <section className="section">
        <h2 className="section__title">
          <Icon name="shield" size={20} />
          ファイルの扱いについて
        </h2>
        <div className="stack">
          <Banner tone="privacy">
            <strong>PDFはあなたの端末から出ません。</strong>
            <br />
            このツールにはファイルを受け取るサーバーがありません。読み込み・編集・書き出しはすべてブラウザの中で行われます。
          </Banner>
          <div className="card card--outlined">
            <p>技術的には次のようにして担保しています。</p>
            <ul style={{ marginTop: 0, paddingLeft: '1.2em' }}>
              <li>サーバー側の処理を一切持たない、静的なページとして配信しています。</li>
              <li>
                ブラウザのセキュリティ機能 (Content Security Policy) で、<strong>外部への通信そのものを禁止</strong>
                しています。仮に不具合があっても、ファイルが外に送られる経路がありません。
              </li>
              <li>フォントやアイコンを含め、外部サービスからの読み込みを使っていません。</li>
              <li>アクセス解析や広告のタグを入れていません。</li>
              <li>
                端末に保存するのは「設定」と「墨消しテンプレート (範囲の座標)」だけです。PDFの中身は保存しません。
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              ソースコードは <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a> で公開しているので、
              実際の動きを確認できます。
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">
          <Icon name="pages" size={20} />
          ページ整理の使い方
        </h2>
        <div className="card card--outlined">
          <ol style={{ marginTop: 0, paddingLeft: '1.2em' }}>
            <li>PDFをドラッグ&ドロップ (スマホはタップして選択) します。複数まとめて読み込めます。</li>
            <li>ページをドラッグ (スマホは長押ししてから移動) すると並べ替えられます。</li>
            <li>各ページのボタンで回転・複製・削除ができます。</li>
            <li>
              まとめて操作したいときは、カード右上のチェックを付けてからツールバーのボタンを押します。チェックを1つも
              付けていないときは、回転ボタンが全ページに効きます。
            </li>
            <li>「PDFを書き出す」で端末に保存されます。</li>
          </ol>
          <p style={{ marginBottom: 0 }}>
            JPEG・PNGの画像もページとして追加できます。空白ページの追加も可能です。
            ページ整理では中身を作り直さないので、<strong>文字は文字のまま残ります</strong>。
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">
          <Icon name="draw" size={20} />
          墨消しの使い方と仕組み
        </h2>
        <div className="stack">
          <div className="card card--outlined">
            <ol style={{ marginTop: 0, paddingLeft: '1.2em' }}>
              <li>PDFを1つ読み込みます。</li>
              <li>塗る色 (黒 / 白) と「適用先」を選びます。</li>
              <li>プレビューの上をドラッグして、隠したい部分を囲みます。</li>
              <li>「墨消しして書き出す」で保存します。</li>
            </ol>
            <p style={{ marginBottom: 0 }}>
              「適用先」で<strong>全ページ</strong>や<strong>奇数ページ</strong>などを選ぶと、同じ位置をまとめて隠せます。
              ヘッダーやフッターに入っている情報を消すときに便利です。
            </p>
          </div>

          <div className="card card--outlined">
            <h3 style={{ marginBottom: 8 }}>なぜ「画像化」するのか</h3>
            <p>
              PDFに黒い四角を重ねただけの墨消しは、<strong>下にある文字がそのまま残ります</strong>。
              コピー&ペーストしたり、別のソフトで開いたりすると読めてしまう、よくある事故です。
            </p>
            <p style={{ marginBottom: 0 }}>
              {APP_NAME} では、全ページを一度<strong>画像に変換してから</strong>塗りつぶし、その画像だけで
              PDFを作り直します。隠した部分の情報は出力されたPDFの中に残りません。
            </p>
          </div>

          <Banner tone="warning">
            画像化するため、出力されたPDFは<strong>文字検索・テキスト選択ができなくなります</strong>。
            しおり・注釈・入力フォームも失われます。元のPDFは必ず手元に残しておいてください。
          </Banner>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">
          <Icon name="layers" size={20} />
          テンプレートと一括墨消し
        </h2>
        <div className="card card--outlined">
          <p>
            同じ発行元から届く、書式がまったく同じPDF (請求書や明細など) を毎回同じ場所で墨消しするなら、
            範囲をテンプレートとして保存しておけます。
          </p>
          <ol style={{ paddingLeft: '1.2em' }}>
            <li>墨消し画面で範囲を指定し、「テンプレート」→「保存」で名前を付けて保存します。</li>
            <li>
              次回からは「呼び出し」で同じ範囲を一発で復元できます。
              <a href={hrefFor('batch')}>一括墨消し</a> を使えば、複数のPDFにまとめて適用できます。
            </li>
            <li>できあがったPDFは1つずつ、またはZIPでまとめて保存できます。</li>
          </ol>
          <p style={{ marginBottom: 0 }}>
            範囲はページに対する<strong>割合</strong>で保存しているため、用紙サイズが違っても同じ位置に当たります。
            ただし書式がずれているPDFでは位置がずれることがあるので、<strong>出力結果は必ず目で確認してください</strong>。
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">よくある質問</h2>

        <Faq question="読み込めないPDFがあります">
          パスワードで保護されたPDFは扱えません。パスワードを解除してから読み込んでください。
          また、ファイルが破損している場合も読み込めないことがあります。
        </Faq>

        <Faq question="処理が重い・途中で止まる">
          ページ数の多いPDFや高い解像度を指定すると、端末のメモリを多く使います。
          <a href={hrefFor('settings')}>設定</a> で解像度を下げる (150dpi以下) と軽くなります。
          スマホで数百ページのPDFを扱うのは難しいことがあります。
        </Faq>

        <Faq question="墨消し後のファイルサイズが大きくなりました">
          画像として作り直すためです。<a href={hrefFor('settings')}>設定</a> で解像度を下げるか、
          画像の形式をJPEGにして画質を下げると小さくなります。
        </Faq>

        <Faq question="保存したテンプレートは他の端末でも使えますか">
          テンプレートはブラウザごとに保存されるため、そのままでは共有されません。
          <a href={hrefFor('settings')}>設定</a> からJSONに書き出し、別の端末で読み込んでください。
        </Faq>

        <Faq question="ブラウザのデータを消すとどうなりますか">
          設定とテンプレートが消えます。PDFの中身はもともと保存していないので影響ありません。
        </Faq>

        <Faq question="対応ブラウザは">
          Chrome / Edge / Safari / Firefox の最新版を想定しています。スマートフォンでも利用できます。
        </Faq>
      </section>

      <section className="section">
        <h2 className="section__title">不具合の報告・要望</h2>
        <div className="card card--outlined">
          <p style={{ marginBottom: 0 }}>
            現在のバージョンは <strong>v{APP_VERSION}</strong> です。
            気づいた点は <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">GitHub Issues</a> までお寄せください。
            <br />
            報告の際は、<strong>PDFそのものは添付せず</strong>、操作の手順と症状をお書きいただけると助かります。
          </p>
        </div>
      </section>
    </div>
  );
}
