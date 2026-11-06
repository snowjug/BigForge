import type { ApiError } from './client';

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError;
  }
}
