import { QueryClientProvider } from '@tanstack/react-query';
import { type ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { queryClient } from './api/queryClient';
import { RequireAuth } from './auth/RequireAuth';
import { ROUTE_PATTERNS } from './routes';
import { AppShell } from './shell/AppShell';
import { RouteError } from './shell/RouteError';
import { ToastProvider } from './ui';
import './api/register';

type PageModule = { default: ComponentType };

/** Each page is its own chunk: `{ path, lazy: page(() => import('./pages/XPage')) }`. */
const page = (load: () => Promise<PageModule>) => async () => ({
  Component: (await load()).default,
});

/**
 * The route table. Page modules live in src/pages/<Name>Page.tsx with a default export; replacing a
 * stub means replacing that file, nothing here changes. Paths and params: src/routes.ts and routes.md.
 */
export const router = createBrowserRouter([
  {
    path: ROUTE_PATTERNS.login,
    lazy: page(() => import('./pages/LoginPage')),
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import('./pages/HomePage')) },
      { path: 'run', lazy: page(() => import('./pages/RunPage')) },
      { path: 'traces', lazy: page(() => import('./pages/TracesPage')) },
      { path: 'traces/:runId', lazy: page(() => import('./pages/TraceDetailPage')) },
      { path: 'learn', lazy: page(() => import('./pages/LearnPage')) },
      { path: 'reflexes', lazy: page(() => import('./pages/ReflexesPage')) },
      { path: 'reflexes/:versionId', lazy: page(() => import('./pages/ReflexDetailPage')) },
      { path: 'shadow', lazy: page(() => import('./pages/ShadowPage')) },
      { path: 'economics', lazy: page(() => import('./pages/EconomicsPage')) },
      { path: 'drift', lazy: page(() => import('./pages/DriftPage')) },
      { path: 'governance', lazy: page(() => import('./pages/GovernancePage')) },
      { path: 'settings', lazy: page(() => import('./pages/SettingsPage')) },
      { path: '*', lazy: page(() => import('./pages/NotFoundPage')) },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
