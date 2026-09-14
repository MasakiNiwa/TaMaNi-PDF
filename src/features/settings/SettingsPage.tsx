import { useCallback, useRef, useState } from 'react';
import { useSettings } from '../../app/SettingsContext';
import { useTemplates } from '../../app/TemplatesContext';
import { APP_NAME, APP_VERSION, BUILD_DATE, ISSUES_URL, LICENSE_URL, REPO_URL } from '../../app/version';
import { DPI_CHOICES } from '../../core/storage/settings';
import { buildExportFile, parseImportFile } from '../../core/storage/templates';
import { clearAll, isStorageAvailable } from '../../core/storage/store';
import { saveText } from '../../core/util/download';
import { formatDateTime } from '../../core/util/format';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Banner, Collapsible, SettingRow } from '../../ui/primitives';
import { useSnackbar } from '../../ui/Snackbar';

export function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const templates = useTemplates();
  const snackbar = useSnackbar();
  const importRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const storageOk = isStorageAvailable();

  const exportTemplates = useCallback(() => {
    if (templates.templates.length === 0) return;
    const file = buildExportFile(templates.templates);
    saveText(JSON.stringify(file, null, 2), `tamani-pdf_templates_${new Date().toISOString().slice(0, 10)}.json`);
    snackbar.success('テンプレートを書き出しました。');
  }, [templates.templates, snackbar]);

  const importTemplates = useCallback(
    async (file: File) => {
      try {
        const count = templates.importMany(parseImportFile(await file.text()));
        snackbar.success(`${count}件のテンプレートを読み込みました。`);
      } catch (error) {
        snackbar.error(error instanceof Error ? error.message : 'テンプレートを読み込めませんでした。');
      }
    },
    [templates, snackbar],
  );

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">
          <Icon name="settings" size={24} />
          設定
        </h1>
        <p className="page__lead">設定はこの端末のブラウザにだけ保存されます。</p>
      </header>

      {!storageOk ? (
        <div style={{ marginBottom: 20 }}>
          <Banner tone="warning">
            このブラウザでは設定を保存できません (プライベートモードなどの可能性があります)。
            設定の変更はこのタブを閉じるまで有効です。
          </Banner>
        </div>
      ) : null}

      <section className="section">
        <h2 className="section__title">表示</h2>
        <div className="card card--outlined">
          <SettingRow title="テーマ" description="画面の配色を選びます。">
            <select
              className="select"
              value={settings.theme}
              onChange={(event) => update({ theme: event.target.value as typeof settings.theme })}
              aria-label="テーマ"
            >
              <option value="system">端末に合わせる</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </SettingRow>

          <SettingRow title="サムネイルの大きさ" description="ページ整理の一覧に表示する大きさです。">
            <select
              className="select"
              value={settings.thumbnailSize}
              onChange={(event) =>
                update({ thumbnailSize: event.target.value as typeof settings.thumbnailSize })
              }
              aria-label="サムネイルの大きさ"
            >
              <option value="small">小</option>
              <option value="medium">中</option>
              <option value="large">大</option>
            </select>
          </SettingRow>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">墨消しの出力</h2>
        <div className="card card--outlined">
          <SettingRow
            title="解像度 (dpi)"
            description="高いほどきれいですが、処理が重くファイルが大きくなります。"
          >
            <select
              className="select"
              value={settings.redactDpi}
              onChange={(event) => update({ redactDpi: Number(event.target.value) })}
              aria-label="解像度"
            >
              {DPI_CHOICES.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {dpi} dpi{dpi === 150 ? ' (推奨)' : ''}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            title="画像の形式"
            description="JPEGは軽く、PNGは文字がくっきりしますがファイルが大きくなります。"
          >
            <select
              className="select"
              value={settings.redactFormat}
              onChange={(event) => update({ redactFormat: event.target.value as 'jpeg' | 'png' })}
              aria-label="画像の形式"
            >
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
            </select>
          </SettingRow>

          {settings.redactFormat === 'jpeg' ? (
            <SettingRow title="JPEGの画質" description={`現在: ${Math.round(settings.jpegQuality * 100)}%`}>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.02}
                value={settings.jpegQuality}
                onChange={(event) => update({ jpegQuality: Number(event.target.value) })}
                aria-label="JPEGの画質"
                style={{ width: '100%' }}
              />
            </SettingRow>
          ) : null}

          <SettingRow title="既定の塗りつぶし色" description="墨消し画面を開いたときに選ばれている色です。">
            <select
              className="select"
              value={settings.defaultRedactColor}
              onChange={(event) => update({ defaultRedactColor: event.target.value as 'black' | 'white' })}
              aria-label="既定の塗りつぶし色"
            >
              <option value="black">黒</option>
              <option value="white">白</option>
            </select>
          </SettingRow>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">ファイル名</h2>
        <div className="card card--outlined">
          <SettingRow title="ページ整理の接尾辞" description="例: 資料_edited.pdf">
            <input
              className="input"
              value={settings.organizeSuffix}
              maxLength={20}
              onChange={(event) => update({ organizeSuffix: event.target.value })}
              aria-label="ページ整理の接尾辞"
            />
          </SettingRow>
          <SettingRow title="墨消しの接尾辞" description="例: 資料_redacted.pdf">
            <input
              className="input"
              value={settings.redactSuffix}
              maxLength={20}
              onChange={(event) => update({ redactSuffix: event.target.value })}
              aria-label="墨消しの接尾辞"
            />
          </SettingRow>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">墨消しテンプレート ({templates.templates.length})</h2>
        <div className="card card--outlined">
          <SettingRow title="自動位置合わせ">
            <select
              className="select"
              value={settings.templateAutoAlign ? 'on' : 'off'}
              onChange={(event) => update({ templateAutoAlign: event.target.value === 'on' })}
              aria-label="自動位置合わせ"
            >
              <option value="on">使う</option>
              <option value="off">使わない (既定)</option>
            </select>
          </SettingRow>

          {/* 説明は長くなるので畳んでおく。読みたい人だけが開ける形にする。 */}
          <div style={{ margin: '4px 0 14px' }}>
            <Collapsible title="自動位置合わせとは? (保存されるものの説明)" icon="info">
              <p style={{ marginTop: 0 }}>
                <strong>オフのとき</strong> — テンプレートに保存するのは範囲の座標だけです。
                書式がまったく同じPDFなら、これで十分に当たります。
              </p>
              <p>
                <strong>オンにすると</strong> — 印刷やスキャンで中身が少しずれているPDFにも、
                ずれを測って範囲を合わせてから当てられるようになり、当たる精度が上がります。
              </p>
              <p>
                そのかわり、テンプレートを保存するときに
                <strong>そのページを96px幅まで縮めた白黒の簡易画像</strong> (文字は読み取れない粗さ) を
                一緒に保存します。置き場所は次の2か所だけで、どちらも端末の外には出ません
                (このアプリは外部へ通信しません)。
              </p>
              <ul style={{ paddingLeft: '1.2em' }}>
                <li>この端末のブラウザ (localStorage)</li>
                <li>テンプレートを書き出したJSONファイルの中</li>
              </ul>
              <p style={{ marginBottom: 0 }}>
                簡易画像が付くのは、オンにしたあとで保存したテンプレートだけです。
                すでにあるテンプレートに付けたいときは、保存し直してください。
              </p>
            </Collapsible>
          </div>

          {templates.templates.length === 0 ? (
            <p className="text-small muted">まだテンプレートがありません。墨消し画面で範囲を指定して保存できます。</p>
          ) : (
            <div className="template-list">
              {templates.templates.map((template) => (
                <div className="template-item" key={template.id}>
                  <div className="template-item__body">
                    <div className="template-item__name">{template.name}</div>
                    <div className="template-item__meta">
                      {template.rects.length}個の範囲 ・ 更新 {formatDateTime(template.updatedAt)}
                      {template.anchor ? ' ・ 自動位置合わせあり' : ''}
                    </div>
                  </div>
                  <IconButton
                    icon="edit"
                    label="名前を変更"
                    small
                    onClick={() => setRenaming({ id: template.id, name: template.name })}
                  />
                  <IconButton
                    icon="delete"
                    label="削除"
                    small
                    danger
                    onClick={() => templates.remove(template.id)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <Button
              small
              variant="outlined"
              icon="download"
              disabled={templates.templates.length === 0}
              onClick={exportTemplates}
            >
              JSONに書き出す
            </Button>
            <Button small variant="outlined" icon="upload" onClick={() => importRef.current?.click()}>
              JSONから読み込む
            </Button>
            <input
              ref={importRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importTemplates(file);
                event.target.value = '';
              }}
            />
          </div>
          <p className="text-small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            {templates.templates.some((template) => template.anchor)
              ? '書き出したJSONに入るのは、範囲の座標と、自動位置合わせ用の簡易画像 (96px幅の白黒。文字は読めません) です。PDFそのものは含まれません。'
              : '書き出したJSONに入るのは範囲の座標だけです。PDFの中身は含まれません。'}
          </p>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">保存データ</h2>
        <div className="card card--outlined">
          <div className="row">
            <Button small variant="outlined" icon="refresh" onClick={reset}>
              設定を初期値に戻す
            </Button>
            <Button small variant="danger" icon="delete" onClick={() => setConfirmClear(true)}>
              保存データをすべて削除
            </Button>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">このアプリについて</h2>
        <div className="card card--outlined">
          <SettingRow title="バージョン" description={`ビルド日: ${BUILD_DATE}`}>
            <span className="chip">v{APP_VERSION}</span>
          </SettingRow>
          <SettingRow title="ソースコード" description="不具合の報告や要望はGitHubへどうぞ。">
            <div className="row">
              <a className="btn btn--outlined btn--small" href={REPO_URL} target="_blank" rel="noopener noreferrer">
                リポジトリ
              </a>
              <a className="btn btn--text btn--small" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
                Issues
              </a>
            </div>
          </SettingRow>
          <SettingRow title="ライセンス" description={`${APP_NAME} は MIT ライセンスで公開しています。`}>
            <a className="btn btn--outlined btn--small" href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
              LICENSE
            </a>
          </SettingRow>
        </div>
      </section>

      <Dialog
        open={renaming !== null}
        title="テンプレート名を変更"
        onClose={() => setRenaming(null)}
        actions={
          <>
            <Button onClick={() => setRenaming(null)}>キャンセル</Button>
            <Button
              variant="filled"
              onClick={() => {
                if (renaming) templates.update(renaming.id, { name: renaming.name });
                setRenaming(null);
              }}
            >
              変更する
            </Button>
          </>
        }
      >
        <input
          className="input"
          value={renaming?.name ?? ''}
          maxLength={80}
          onChange={(event) => setRenaming((current) => (current ? { ...current, name: event.target.value } : null))}
          aria-label="テンプレート名"
        />
      </Dialog>

      <Dialog
        open={confirmClear}
        title="保存データをすべて削除しますか?"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button onClick={() => setConfirmClear(false)}>キャンセル</Button>
            <Button
              variant="danger"
              onClick={() => {
                clearAll();
                templates.removeAll();
                reset();
                setConfirmClear(false);
                snackbar.success('保存データを削除しました。');
              }}
            >
              削除する
            </Button>
          </>
        }
      >
        <p>設定と墨消しテンプレートがすべて消えます。元に戻せません。</p>
        <p className="text-small muted" style={{ marginBottom: 0 }}>
          必要なテンプレートは先にJSONへ書き出しておいてください。
        </p>
      </Dialog>
    </div>
  );
}
