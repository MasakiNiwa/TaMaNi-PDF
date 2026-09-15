import { hrefFor } from '../../app/routes';
import { useSettings } from '../../app/SettingsContext';
import { APP_NAME, APP_VERSION, ISSUES_URL, REPO_URL } from '../../app/version';
import { Icon } from '../../ui/Icon';
import { Banner, Collapsible } from '../../ui/primitives';

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <details className="card card--outlined" style={{ marginBottom: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{question}</summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

export function HelpPage() {
  // 自動位置合わせは既定でオフ。いまどちらなのかで説明を切り替える。
  const { settings } = useSettings();
  const autoAlign = settings.templateAutoAlign;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">
          <Icon name="help" size={24} />
          ヘルプ
        </h1>
        <p className="page__lead">
          {APP_NAME} の使い方と、知っておいてほしい注意点をまとめています。
          見出しを押すと、その中身が開きます。
        </p>
      </header>

      {/* ここだけは開いた状態にしておく。いちばん先に知ってほしい内容のため。 */}
      <Collapsible title="ファイルの扱いについて" icon="shield" defaultOpen>
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
                端末に保存するのは「設定」と「墨消しテンプレート (範囲の座標)」だけです。
                PDFそのものは保存しません。
              </li>
              <li>
                <a href={hrefFor('settings')}>設定</a> の<strong>自動位置合わせ</strong>
                {autoAlign ? (
                  <>
                    は<strong>オンです</strong>。これから保存するテンプレートには、範囲の座標に加えて
                    そのページを96px幅まで縮めた白黒の簡易画像が入ります。本文が読める大きさではありませんが、
                    大きな見出しなど<strong>内容の一部が判別できる場合があります</strong>。
                    置き場所はこの端末のブラウザと、書き出したJSONファイルの中だけです。
                  </>
                ) : (
                  <>
                    は<strong>オフ (既定)</strong> です。オンにすると当たる精度が上がりますが、
                    テンプレートにページの簡易画像 (96px幅・白黒) が一緒に保存されるようになります
                    (内容の一部が判別できる場合があります)。
                  </>
                )}
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              ソースコードは <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a> で公開しているので、
              実際の動きを確認できます。
            </p>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="ページ整理の使い方" icon="pages">
        <div className="card card--outlined">
          <ol style={{ marginTop: 0, paddingLeft: '1.2em' }}>
            <li>
              PDFをドラッグ&ドロップ (スマホはタップして選択) します。複数まとめて読み込めます。
              <strong>画像 (JPEG・PNG) から始めることもできます。</strong>
            </li>
            <li>
              あとからPDFを足すときは、<strong>中身を見て入れるページを選べます</strong>。
              毎回すべて入れたいときは、<a href={hrefFor('settings')}>設定</a> の
              「PDFを追加するとき」を「すべて追加する」にしてください。
            </li>
            <li>
              各ページの右上にある<strong>つまみ</strong> (点が6つ並んだ印) を
              <strong>なぞると並べ替え</strong>られます。長押しは要りません。
              つまみ以外をなぞったときは、並べ替えではなく一覧のスクロールになります。
            </li>
            <li>各ページのボタンで回転・複製・削除、左右の矢印で1つずつ移動ができます。</li>
            <li>
              <strong>サムネイルを押すと、そのページだけを画面いっぱいに表示</strong>します。
              2本指のピンチや画面を2回叩く操作で拡大でき、そのまま回転・削除・選択もできます。
              小さくて読めないページを確かめたいときは、これがいちばん確実です。
            </li>
            <li>
              一覧そのものの大きさも、ツールバーの<strong>虫めがね</strong>で変えられます
              (小・中・大・特大)。選んだ大きさは次に開いたときも残ります。
            </li>
            <li>
              必要なページだけにチェックを付けて<strong>「選択以外を削除」</strong>を押すと、
              そのページだけが残ります。ページ数が多いPDFから数ページを抜き出すときに便利です
              (間違えても<strong>戻す</strong>で元に戻せます)。
            </li>
            <li>
              ツールバーの<strong>「ページ番号」</strong>で、書き出すPDFに通し番号を入れられます。
              位置 (上下 × 左中右)、書き方 (1 / - 1 - / 1 / 12 / P.1)、開始番号、文字の大きさ、
              1ページ目を飛ばすかを選べます。番号は欧文フォントで描くため、日本語は入れられません。
            </li>
            <li>
              まとめて操作したいときは、カード右上のチェックを付けてからツールバーのボタンを押します。チェックを1つも
              付けていないときは、回転ボタンが全ページに効きます。
            </li>
            <li>
              一覧の上に貼り付く<strong>ツールバーの「PDFを書き出す」</strong>で端末に保存されます。
              ページ数が多くても、下までたどる必要はありません。
            </li>
          </ol>
          <p style={{ marginBottom: 0 }}>
            JPEG・PNGの画像もページとして追加できます。ツールバーの「空白ページ」で白紙も足せます。
            ページ整理では中身を作り直さないので、<strong>文字は文字のまま残ります</strong>。
          </p>
        </div>
      </Collapsible>

      <Collapsible title="墨消しの使い方と仕組み" icon="draw">
        <div className="stack">
          <div className="card card--outlined">
            <ol style={{ marginTop: 0, paddingLeft: '1.2em' }}>
              <li>PDFを1つ読み込みます。</li>
              <li>塗る色 (黒 / 白) と「適用先」を選びます。</li>
              <li>プレビューの上をドラッグして、隠したい部分を囲みます。</li>
              <li>「墨消しして書き出す」で保存します。</li>
            </ol>
            <p>
              色・適用先・拡大・ページ送り・テンプレート・書き出しは、プレビューの上 (PCの横長の画面では右)
              にまとまっています。PDFを下までたどらなくても操作できます。
            </p>
            <p>
              「適用先」で<strong>全ページ</strong>や<strong>奇数ページ</strong>などを選ぶと、同じ位置をまとめて隠せます。
              ヘッダーやフッターに入っている情報を消すときに便利です。
            </p>

            <h3 style={{ marginTop: 16, marginBottom: 8 }}>位置をきっちり合わせるには</h3>
            <ul style={{ marginTop: 0, paddingLeft: '1.2em' }}>
              <li>
                作った範囲を<strong>タップ (クリック) すると選択</strong>されます。そのままドラッグすれば移動、
                <strong>右下のつまみ</strong>を引けば大きさを変えられます。
              </li>
              <li>
                <strong>2本指でつまむ</strong>と拡大・縮小できます。そのまま2本指を動かすと、
                上下左右に表示位置を動かせます (パソコンではホイール、Ctrl+ホイールで拡大縮小)。
                拡大してから指定すると、細かい位置まで正確に合わせられます。
              </li>
              <li>
                <strong>PCやタブレットの横長の画面</strong>では、PDFが画面の高さいっぱいに広がり、操作パネルが右に並びます。
                広く見ながら範囲を合わせられます。スマホは向きを変えても縦長と同じ並びのままです。
              </li>
              <li>右側 (スマホでは下) の一覧からも、範囲を選んだり削除したりできます。</li>
              <li>
                操作を間違えたら、画面右上の<strong>戻す</strong>でひとつ前に戻せます。
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              別のPDFを扱いたくなったら、画面右上の<strong>クリア</strong>で最初の画面に戻せます。
              保存済みのテンプレートは消えません。
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
      </Collapsible>

      <Collapsible title="テンプレートと一括墨消し" icon="layers">
        <div className="card card--outlined">
          <p>
            同じ発行元から届く、書式がまったく同じPDF (請求書や明細など) を毎回同じ場所で墨消しするなら、
            範囲をテンプレートとして保存しておけます。
          </p>
          <ol style={{ paddingLeft: '1.2em' }}>
            <li>墨消し画面で範囲を指定し、「テンプレート」→「保存」で名前を付けて保存します。</li>
            <li>
              <strong>自動位置合わせ</strong>を
              <a href={hrefFor('settings')}>設定</a> でオンにしておくと、
              保存したときのページの見え方も一緒に覚えて、印刷やスキャンで中身が少しずれているPDFにも
              範囲を合わせてから当てられます (いまは
              <strong>{autoAlign ? 'オン' : 'オフ'}</strong>)。
            </li>
            <li>
              次回からは「呼び出し」で同じ範囲を一発で復元できます。
              <a href={hrefFor('batch')}>一括墨消し</a> を使えば、複数のPDFにまとめて適用できます。
            </li>
            <li>
              実行する前に<strong>「1件目でプレビュー」</strong>で、テンプレートがどこに当たるかを
              確かめられます。書式が少しでも違うとずれるので、まとめて処理する前の確認をおすすめします。
            </li>
            <li>できあがったPDFは1つずつ、またはZIPでまとめて保存できます。</li>
            <li>
              テンプレートの<strong>範囲がどのページにも当たらない</strong>とき (「3ページ目のみ」を
              1ページのPDFに当てたときなど) は、失敗として止めます。
              何も隠れていないPDFができてしまわないようにするためです。
            </li>
            <li>
              テンプレートや画質を変えると、前の条件で作った結果は破棄します。
              違う条件で作ったPDFが混ざらないよう、もう一度実行してください。
            </li>
          </ol>
          <p>
            範囲はページに対する<strong>割合</strong>で保存しているため、用紙サイズが違っても同じ位置に当たります。
            {autoAlign
              ? '自動位置合わせは、そこからさらに「どれだけずれているか」を測って範囲を動かします。補正した量と一致度はプレビューと一覧に出るので、目安にしてください。'
              : '自動位置合わせはオフなので、保存した座標のとおりに当てます。書式が同じPDFなら、これで当たります。'}
          </p>
          <p style={{ marginBottom: 0 }}>
            書式そのものが違うPDFや、似た配置が見つからないPDFでは補正されません。
            <strong>出力結果は必ず目で確認してください</strong>。
          </p>
        </div>
      </Collapsible>

      <Collapsible title="よくある質問" icon="help">

        <Faq question="読み込めないPDFがあります">
          パスワードで保護されたPDFは扱えません。パスワードを解除してから読み込んでください。
          また、ファイルが破損している場合も読み込めないことがあります。
        </Faq>

        <Faq question="ヘルプや設定を見ると、編集中の内容は消えますか">
          <p style={{ marginTop: 0, marginBottom: 0 }}>
            消えません。整理・墨消し・一括の作業は、他の画面へ移っても残ります。
            消えるのは<strong>タブを閉じたとき</strong>と、各画面の<strong>クリア</strong>を押したときだけです
            (このツールはPDFをどこにも保存しないため、閉じると手元からもなくなります)。
            範囲を指定したまま別のPDFへ切り替えるときは、消える前に確認します。
          </p>
        </Faq>

        <Faq question="ページ数が多いPDFでも使えますか">
          <p style={{ marginTop: 0, marginBottom: 0 }}>
            ページ整理の一覧は、ページ数が多いとき<strong>画面に入っているぶんだけ</strong>を描きます。
            そのため数百ページでも一覧の操作は軽いままです。選択・回転・書き出しは、
            画面に出ていないページにも効きます。
            ただし並べ替えのドラッグは、画面に見えている範囲どうしで行ってください
            (離れた場所へ動かすときは、矢印ボタンで少しずつ送るほうが確実です)。
          </p>
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

        <Faq question="自動位置合わせはどこまで合わせられますか">
          <p style={{ marginTop: 0 }}>
            <strong>既定ではオフ</strong>です (いまは <strong>{autoAlign ? 'オン' : 'オフ'}</strong>)。
            <a href={hrefFor('settings')}>設定</a> でオンにすると使えます。
          </p>
          <p>
            ページ全体が<strong>平行にずれている</strong>場合と、<strong>少し拡大縮小されている</strong>場合に対応します
            (おおむね上下左右12%、大きさ±5%まで)。スキャンし直したPDFや、余白の取り方が変わったPDFが対象です。
          </p>
          <p>
            項目の位置そのものが違う書式や、傾いてスキャンされたPDFは合わせられません。
            合わせられないと判断したときは、補正せずそのまま当てて「似た配置が見つからず」と表示します。
          </p>
          <p style={{ marginBottom: 0 }}>
            また、ずれを測るのは<strong>基準にした1ページだけ</strong>で、その結果を全ページに当てます。
            ページごとにずれ方が違う書類 (1枚ずつスキャンし直したものなど) では合いません。
            <strong>出力結果は必ず目で確認してください。</strong>
          </p>
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
      </Collapsible>

      <Collapsible title="不具合の報告・要望" icon="info">
        <div className="card card--outlined">
          <p style={{ marginBottom: 0 }}>
            現在のバージョンは <strong>v{APP_VERSION}</strong> です。
            気づいた点は <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">GitHub Issues</a> までお寄せください。
            <br />
            報告の際は、<strong>PDFそのものは添付せず</strong>、操作の手順と症状をお書きいただけると助かります。
          </p>
        </div>
      </Collapsible>
    </div>
  );
}
