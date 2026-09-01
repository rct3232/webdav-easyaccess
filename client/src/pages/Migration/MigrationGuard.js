import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getMigrationStatus } from '../../services/migrationService';

const POLL_INTERVAL_MS = 4000;

// App-wide migration guard (D2/D3 double safety): while a migration is active
// the server blocks every route except the allow-list; this client-side poll
// force-redirects to /migration so the operator cannot navigate away.
const MigrationGuard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    let disposed = false;

    const check = async () => {
      try {
        const status = await getMigrationStatus();
        if (disposed) return;
        const active = Boolean(status && status.active);
        // /migration is where the operator must stay; /login stays reachable so
        // an expired session can be re-established mid-migration (allow-list).
        if (
          active &&
          pathnameRef.current !== '/migration' &&
          pathnameRef.current !== '/login'
        ) {
          navigate('/migration', { replace: true });
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
  }, [navigate]);

  return <Outlet />;
};

export default MigrationGuard;
