import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  loadTemplates,
  saveTemplates,
  TEMPLATE_VERSION,
  type RedactTemplate,
  type TemplateAnchor,
  type TemplateRect,
} from '../core/storage/templates';
import { createId } from '../core/util/id';

interface TemplatesApi {
  templates: RedactTemplate[];
  /** 名前と範囲から新しいテンプレートを保存する */
  create: (
    name: string,
    rects: TemplateRect[],
    sourcePageCount?: number,
    anchor?: TemplateAnchor,
  ) => RedactTemplate;
  update: (id: string, patch: Partial<Pick<RedactTemplate, 'name' | 'rects'>>) => void;
  remove: (id: string) => void;
  /** 読み込んだテンプレートを追加する (同名でも別物として足す) */
  importMany: (items: RedactTemplate[]) => number;
  removeAll: () => void;
}

const TemplatesContext = createContext<TemplatesApi | null>(null);

export function TemplatesProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<RedactTemplate[]>(() => loadTemplates());

  const persist = useCallback((next: RedactTemplate[]) => {
    setTemplates(next);
    saveTemplates(next);
  }, []);

  const create = useCallback(
    (name: string, rects: TemplateRect[], sourcePageCount?: number, anchor?: TemplateAnchor) => {
      const now = new Date().toISOString();
      const template: RedactTemplate = {
        id: createId('tpl'),
        name: name.trim() || '名称未設定',
        version: TEMPLATE_VERSION,
        rects,
        createdAt: now,
        updatedAt: now,
        sourcePageCount,
        anchor,
      };
      persist([...templates, template]);
      return template;
    },
    [persist, templates],
  );

  const update = useCallback(
    (id: string, patch: Partial<Pick<RedactTemplate, 'name' | 'rects'>>) => {
      persist(
        templates.map((template) =>
          template.id === id ? { ...template, ...patch, updatedAt: new Date().toISOString() } : template,
        ),
      );
    },
    [persist, templates],
  );

  const remove = useCallback(
    (id: string) => persist(templates.filter((template) => template.id !== id)),
    [persist, templates],
  );

  const importMany = useCallback(
    (items: RedactTemplate[]) => {
      // 読み込み元と id が衝突しないよう振り直す
      const stamped = items.map((item) => ({ ...item, id: createId('tpl') }));
      persist([...templates, ...stamped]);
      return stamped.length;
    },
    [persist, templates],
  );

  const removeAll = useCallback(() => persist([]), [persist]);

  const api = useMemo<TemplatesApi>(
    () => ({ templates, create, update, remove, importMany, removeAll }),
    [templates, create, update, remove, importMany, removeAll],
  );

  return <TemplatesContext.Provider value={api}>{children}</TemplatesContext.Provider>;
}

export function useTemplates(): TemplatesApi {
  const context = useContext(TemplatesContext);
  if (!context) throw new Error('TemplatesProvider の内側で使ってください。');
  return context;
}
