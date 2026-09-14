/** 利用者にそのまま見せられる日本語メッセージを持つエラー */
export class PdfUserError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'PdfUserError';
  }
}

/** pdf.js / pdf-lib の例外を利用者向けの文言に翻訳する */
export function toUserError(error: unknown, fileName?: string): PdfUserError {
  if (error instanceof PdfUserError) return error;
  const prefix = fileName ? `「${fileName}」` : 'このファイル';
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'PasswordException' || /password/i.test(message)) {
    return new PdfUserError(
      `${prefix}はパスワードで保護されています。パスワードを解除したPDFをご用意ください。`,
      error,
    );
  }
  if (name === 'InvalidPDFException' || /invalid pdf|no pdf header/i.test(message)) {
    return new PdfUserError(`${prefix}はPDFとして読み取れませんでした。ファイルが壊れている可能性があります。`, error);
  }
  if (/encrypted/i.test(message)) {
    return new PdfUserError(`${prefix}は暗号化されているため編集できません。`, error);
  }
  return new PdfUserError(`${prefix}の処理中にエラーが発生しました: ${message}`, error);
}
