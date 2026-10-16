import type { ErrorCode } from "@rails/shared";

/** An expected failure with the HTTP status the route should answer with (see `app.onError`). */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
    /** Machine-readable reason the client can act on (see `ErrorCode` in shared). */
    readonly code?: ErrorCode,
  ) {
    super(message);
  }
}
