import { Suspense, lazy } from 'react';
import { AppShell } from './app/AppShell';
import { SettingsProvider } from './app/SettingsContext';
import { TemplatesProvider } from './app/TemplatesContext';
import { useHashRoute } from './app/useHashRoute';
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

function CurrentPage() {
  const route = useHashRoute();

  const content = (() => {
    switch (route.id) {
      case 'organize':
        return <OrganizePage />;
      case 'redact':
        return <RedactPage />;
      case 'batch':
        return <BatchPage />;
      case 'settings':
        return <SettingsPage />;
      case 'help':
        return <HelpPage />;
      case 'home':
      default:
        return <HomePage />;
    }
  })();

  // key を変えて、画面を切り替えるたびに各ツールの状態を作り直す。
  // 前の画面で開いたPDFがメモリに残り続けるのを防ぐ狙いもある。
  return (
    <AppShell route={route}>
      <Suspense fallback={<PageLoading />}>
        <div key={route.id}>{content}</div>
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
