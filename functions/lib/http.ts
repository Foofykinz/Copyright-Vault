export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class ValidationError extends Error {
  details?: Record<string, string>;
  constructor(message: string, details?: Record<string, string>) {
    super(message);
    this.details = details;
  }
}

export class NotFoundError extends Error {}

export class UnauthorizedError extends Error {}

export function errorResponse(err: unknown): Response {
  if (err instanceof ValidationError) {
    return json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return json({ error: err.message || "Not found." }, { status: 404 });
  }
  if (err instanceof UnauthorizedError) {
    return json({ error: err.message || "Unauthorized." }, { status: 401 });
  }
  console.error(err);
  return json({ error: "Unexpected server error." }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}
