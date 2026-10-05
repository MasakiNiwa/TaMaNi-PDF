import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setPerfPreferences } from '../core/perf/device';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../core/storage/settings';

interface SettingsApi {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsApi | null>(null);

function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = prefersDark ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    const loaded = loadSettings();
    // PDFを開く処理は React の外にあるので、速さに関わる設定はここで渡しておく
    setPerfPreferences({ parallel: loaded.parallel, gpu: loaded.gpu });
    return loaded;
  });

  useEffect(() => {
    setPerfPreferences({ parallel: settings.parallel, gpu: settings.gpu });
  }, [settings.parallel, settings.gpu]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [settings.theme]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  const api = useMemo<SettingsApi>(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('SettingsProvider の内側で使ってください。');
  return context;
}
