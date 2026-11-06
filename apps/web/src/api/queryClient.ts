import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
import { keys } from './keys';
import type { MeResponse } from './types';

/** A 401 from anywhere means the session ended: flip `me` to signed-out so the auth gate redirects. */
function handleError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401 && error.code === 'unauthenticated') {
    queryClient.setQueryData<MeResponse>(keys.auth.me, (previous) => ({
      user: null,
      mode: previous?.mode ?? 'demo',
    }));
  }
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // 4xx answers are final. Network failures and 5xx get one more try.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
        failureCount < 1,
    },
    mutations: { retry: false },
  },
});
