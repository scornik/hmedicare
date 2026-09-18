import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Navigate, Outlet, createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { queryClient, setTenant } from './api';
import { useSignedIn } from './auth/hooks';
import { onAuthChange, refresh } from './auth/session';
import { I18nProvider, useI18n } from './i18n/i18n';
import { DashboardPage } from './pages/DashboardPage';
import { ForbiddenPage, NotFoundPage, OfflinePage } from './pages/ErrorPages';
import { LoginPage } from './pages/LoginPage';
import { TenantPickerPage } from './pages/TenantPickerPage';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** Guard for signed-in routes. UX only: every API call is authorized server-side. */
function RequireAuth() {
  const signedIn = useSignedIn();
  return signedIn ? <Outlet /> : <Navigate to="/login" replace />;
}

function Shell() {
  const online = useOnline();
  return online ? <Outlet /> : <OfflinePage />;
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/offline', element: <OfflinePage /> },
      { path: '/forbidden', element: <ForbiddenPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/select-tenant', element: <TenantPickerPage /> },
          { path: '/dashboard', element: <DashboardPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

function Boot() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // After a reload the access token is gone; the httpOnly refresh cookie may restore the session.
    void refresh().finally(() => setReady(true));
    return onAuthChange((signedIn) => {
      if (!signedIn) {
        setTenant(null);
        queryClient.clear();
      }
    });
  }, []);
  if (!ready) return <p className="center">{t('common.loading')}</p>;
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <Boot />
      </QueryClientProvider>
    </I18nProvider>
  );
}
