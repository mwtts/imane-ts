/** HTTP ステータス付きのアプリケーション例外 */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, cause?: unknown) => new HttpError(400, message, { cause });
export const unauthorized = (message = "ログインしていません。") => new HttpError(401, message);
export const forbidden = (message = "この操作を行う権限がありません。") => new HttpError(403, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
