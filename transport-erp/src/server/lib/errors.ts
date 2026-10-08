export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d);
export const forbidden = (m = "You do not have permission to do this.") => new AppError(403, m);
export const notFound = (m = "Record not found.") => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);
