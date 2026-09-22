import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { ActivePageProvider } from './app/ActivePage';
import { AppShell } from './app/AppShell';
import { SettingsProvider } from './app/SettingsContext';
import { TemplatesProvider } from './app/TemplatesContext';
import { useHashRoute } from './app/useHashRoute';
import type { RouteId } from './app/routes';
import { HelpPage } from './features/help/HelpPage';
import { HomePage } from './features/home/HomePage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ProgressBar } from './ui/primitives';
import { SnackbarProvider } from './ui/Snackbar';

// PDFを扱う画面は pdf.js / pdf-lib を読み込むため重い。
// ホームやヘルプを開いただけでは読み込まれないよう、必要になってから取りに行く。
const OrganizePage = lazy(() =>
  import('./features/organize/OrganizePage').then((module) => ({ default: module.OrganizePage })),
);
const RedactPage = lazy(() =>
  import('./features/redact/RedactPage').then((module) => ({ default: module.RedactPage })),
);
const BatchPage = lazy(() =>
  import('./features/batch/BatchPage').then((module) => ({ default: module.BatchPage })),
);
const CompressPage = lazy(() =>
  import('./features/compress/CompressPage').then((module) => ({ default: module.CompressPage })),
);

/**
 * 作業状態を持つ画面。
 *
 * これらは一度開いたら、他の画面へ移っても作り直さずに隠しておく。
 * 「使い方を確認したい」「画質を変えたい」でヘルプや設定を開いただけで
 * 読み込んだPDFと編集内容が消えてしまうのを避けるため。
 *
 * PDFは端末のメモリに置いたままになるが、外には出ない。
 * 手放したいときは各画面の「クリア」で閉じられる。
 */
const WORKSPACE_ROUTES: RouteId[] = ['organize', 'redact', 'batch', 'compress'];

function PageLoading() {
  return (
    <div className="page" style={{ paddingTop: 40 }}>
      <ProgressBar />
      <p className="text-small muted" style={{ marginTop: 12 }}>
        読み込んでいます…
      </p>
    </div>
  );
}

function Workspace({ id, active, children }: { id: RouteId; active: boolean; children: ReactNode }) {
  return (
    <div key={id} style={active ? undefined : { display: 'none' }} aria-hidden={active ? undefined : true}>
      <ActivePageProvider value={active}>{children}</ActivePageProvider>
    </div>
  );
}

function CurrentPage() {
  const route = useHashRoute();

  // 一度開いた作業画面だけを残す (開いていない画面は読み込みもしない)
  const [opened, setOpened] = useState<RouteId[]>([]);
  useEffect(() => {
    if (!WORKSPACE_ROUTES.includes(route.id)) return;
    setOpened((current) => (current.includes(route.id) ? current : [...current, route.id]));
  }, [route.id]);

  const simplePage = (() => {
    switch (route.id) {
      case 'settings':
        return <SettingsPage />;
      case 'help':
        return <HelpPage />;
      case 'home':
        return <HomePage />;
      default:
        return null;
    }
  })();

  return (
    <AppShell route={route}>
      <Suspense fallback={<PageLoading />}>
        {opened.includes('organize') ? (
          <Workspace id="organize" active={route.id === 'organize'}>
            <OrganizePage />
          </Workspace>
        ) : null}
        {opened.includes('redact') ? (
          <Workspace id="redact" active={route.id === 'redact'}>
            <RedactPage />
          </Workspace>
        ) : null}
        {opened.includes('batch') ? (
          <Workspace id="batch" active={route.id === 'batch'}>
            <BatchPage />
          </Workspace>
        ) : null}
        {opened.includes('compress') ? (
          <Workspace id="compress" active={route.id === 'compress'}>
            <CompressPage />
          </Workspace>
        ) : null}
        {simplePage}
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <TemplatesProvider>
        <SnackbarProvider>
          <CurrentPage />
        </SnackbarProvider>
      </TemplatesProvider>
    </SettingsProvider>
  );
}
