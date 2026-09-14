import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * 本番ビルドの index.html にだけ CSP を差し込む。
 * dev サーバは HMR のために inline script / eval を使うため、開発時は適用しない。
 *
 * ポイントは connect-src を 'self' に閉じていること。
 * これによりユーザーの PDF が外部へ送信される経路が存在しなくなる。
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  // wasm-unsafe-eval は pdf.js の画像デコーダ (JBIG2 / OpenJPEG / QCMS) に必要
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "media-src 'self' blob:",
  // 同一オリジンの CMap / wasm 取得と、blob/data 経由の内部データ受け渡しのみ許可
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

function cspPlugin(): Plugin {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
  return {
    name: 'tamani-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // charset の直後に差し込む。charset は先頭 1024 バイト以内かつ
      // できるだけ先頭にある必要があるため、その前には入れない。
      const charset = /<meta\s+charset=["']?[^>]*>/i.exec(html);
      if (!charset) throw new Error('index.html に <meta charset> が見つかりません。');
      const at = charset.index + charset[0].length;
      return `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`;
    },
  };
}

export default defineConfig({
  // GitHub Pages のサブパス配信でも動くように相対パスで出力する
  base: './',
  plugins: [react(), cspPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
