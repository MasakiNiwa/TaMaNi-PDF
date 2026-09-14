import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createId } from '../core/util/id';
import { Icon } from './Icon';
import { IconButton } from './Button';

type SnackTone = 'info' | 'success' | 'error';

interface SnackItem {
  id: string;
  message: string;
  tone: SnackTone;
}

interface SnackbarApi {
  show: (message: string, tone?: SnackTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarApi | null>(null);

const TONE_ICON = {
  info: 'info',
  success: 'check',
  error: 'error',
} as const;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SnackItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, tone: SnackTone = 'info') => {
      const id = createId('snack');
      setItems((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const api = useMemo<SnackbarApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show],
  );

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="snackbar-host" role="status" aria-live="polite">
          {items.map((item) => (
            <div key={item.id} className={`snackbar snackbar--${item.tone}`}>
              <Icon name={TONE_ICON[item.tone]} size={18} />
              <span className="spacer">{item.message}</span>
              <IconButton
                className="snackbar__close"
                icon="close"
                label="閉じる"
                small
                onClick={() => dismiss(item.id)}
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarApi {
  const context = useContext(SnackbarContext);
  if (!context) throw new Error('SnackbarProvider の内側で使ってください。');
  return context;
}
