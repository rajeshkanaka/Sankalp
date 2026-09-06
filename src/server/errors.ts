export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public current?: unknown,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export const notFound = () => new AppError(404, 'NOT_FOUND', 'This record is unavailable.');
