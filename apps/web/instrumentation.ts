/**
 * Next.js server instrumentation — wires every uncaught server error (RSC,
 * server actions, route handlers) into the SDK's error-reporting seam.
 * No `SENTRY_DSN` in the environment → guaranteed no-op.
 */
import { reportError } from "@sundayplan/sdk";

export function register(): void {
  // No boot-time setup needed; the seam is stateless.
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routeType: string },
): Promise<void> {
  await reportError(
    error,
    {
      app: "sundayplan-web",
      extra: {
        path: request.path,
        method: request.method,
        routerKind: context.routerKind,
        routeType: context.routeType,
      },
    },
    process.env as Record<string, string | undefined>,
  );
}
