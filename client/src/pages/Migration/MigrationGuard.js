import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getMigrationStatus } from '../../services/migrationService';
import { useAuth } from '../../contexts/AuthContext';

const POLL_INTERVAL_MS = 4000;

// App-wide migration guard (D2/D3 double safety): while a migration is active
// the server blocks every route except the allow-list; this client-side poll
// force-redirects each session to the right screen — an authenticated admin to
// /migration (operator progress), everyone else (regular users and anonymous
// visitors) to the generic public /maintenance page. /login stays reachable so
// an expired admin session can be re-established mid-migration.
const MigrationGuard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      try {
        const status = await getMigrationStatus();
        if (disposed) return;
        const active = Boolean(status && status.active);
        if (!active) return;
        // While the session role is still being resolved (token present, /auth/me
        // in flight) the guard defers the decision so an admin is not misrouted
        // to the generic page; the poll + effect re-run once loading settles.
        if (loading) return;
        const pathname = pathnameRef.current;
        // /migration (admin) / /maintenance (others) are where each session must
        // stay; /login stays reachable so an expired session can re-authenticate.
        if (pathname === '/login') return;
        const isAdmin = Boolean(user && user.is_admin);
        const target = isAdmin ? '/migration' : '/maintenance';
        if (pathname !== target) {
          navigate(target, { replace: true });
        }
      } catch {
        // 401 / network errors on the status endpoint are ignored so the app
        // never breaks when the endpoint is unreachable.
      }
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [navigate, user, loading]);

  return <Outlet />;
};

export default MigrationGuard;
