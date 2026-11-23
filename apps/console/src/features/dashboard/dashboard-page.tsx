import { t } from '@/lib/i18n';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import ResourcesPage from '../resources/resources-page';

/** The monitoring service keeps its port; retired evaluation links land here. */
export default function DashboardPage() {
  useEffect(() => {
    const normalize = () => {
      if (location.hash === '#resources' || location.hash === '#main-content') return;
      const url = new URL(location.href);
      url.hash = 'resources';
      for (const key of ['test', 'model', 'backend', 'thinking', 'metric', 'protocolQuery']) url.searchParams.delete(key);
      history.replaceState(null, '', url);
    };
    normalize();
    addEventListener('hashchange', normalize);
    return () => removeEventListener('hashchange', normalize);
  }, []);
  return <AppShell surface="dashboard" page="resources" status={<span className="status-pill"><span className="status-dot" />{t("只读监控")}</span>}><ResourcesPage /></AppShell>;
}
