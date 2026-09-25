import { useEffect, useMemo, useState, type FormEvent } from 'react';
import cloudbase from '@cloudbase/js-sdk';
import { AdminShell, type PageKey } from './components/admin-shell';
import { ErrorState, LoadingState } from './components/ui';
import type { AdminSnapshot } from './domain/models';
import { DashboardPage } from './pages/dashboard-page';
import { OrganizationPage } from './pages/organization-page';
import { PermissionPage } from './pages/permission-page';
import { UsersPage } from './pages/users-page';
import { MemoryAdminRepository } from './services/admin-repository';
import { AdminService } from './services/admin-service';
import { ADMIN_SEED } from './services/seed';
import { CloudAdminService } from './services/cloud-admin-service';
import { createCloudBaseAdminRuntime, type CloudBaseAdminRuntime, type CloudBaseBrowserSdk } from './cloud/cloudbase-admin-runtime';

const TITLES: Record<PageKey, string> = {
  dashboard: '工作台',
  organization: '学校/班级管理',
  users: '用户管理',
  permission: '权限管理',
};

const repository = new MemoryAdminRepository(ADMIN_SEED);
const service = new AdminService(repository, {
  actorId: 'admin-zhou',
  actorName: '周老师',
  schoolIds: ['school-demo-001'],
  permissions: [...ADMIN_SEED.roles[0]!.permissions],
});

type RuntimeWindow = Window & { __YAREI_ADMIN_RUNTIME__?: CloudBaseAdminRuntime; cloudbase?: CloudBaseBrowserSdk };

function configuredRuntime(): CloudBaseAdminRuntime | undefined {
  const currentWindow = window as RuntimeWindow;
  if (currentWindow.__YAREI_ADMIN_RUNTIME__) return currentWindow.__YAREI_ADMIN_RUNTIME__;
  const environmentId = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_CLOUDBASE_ENV_ID;
  if (!environmentId) return undefined;
  try {
    const sdk = currentWindow.cloudbase ?? { init: cloudbase.init } as CloudBaseBrowserSdk;
    const runtime = createCloudBaseAdminRuntime({ sdk, environmentId });
    currentWindow.__YAREI_ADMIN_RUNTIME__ = runtime;
    return runtime;
  } catch {
    return undefined;
  }
}

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [snapshot, setSnapshot] = useState<AdminSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' }>();
  const runtime = useMemo(configuredRuntime, []);
  const [activeService, setActiveService] = useState<AdminService>(service);
  const [cloudLogin, setCloudLogin] = useState({ mobile: '', password: '' });
  const [cloudLoginError, setCloudLoginError] = useState('');
  const [cloudLoginBusy, setCloudLoginBusy] = useState(false);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(undefined), 2600);
  };

  const refresh = async () => {
    if (!snapshot) setLoading(true);
    setError('');
    const result = await activeService.snapshot();
    if (!result.ok) {
      if (snapshot) notify(`刷新失败，已保留原数据：${result.message}`, 'error');
      else setError(result.message);
      setLoading(false);
      return;
    }
    setSnapshot(result.data);
    setLoading(false);
  };

  useEffect(() => {
    if (!runtime) return;
    void runtime.sessions.getCurrentSession().then((result) => {
      if (result.ok) setActiveService(new CloudAdminService(runtime));
    });
  }, [runtime]);
  useEffect(() => { void refresh(); }, [activeService]);

  const loginToCloud = async (event: FormEvent) => {
    event.preventDefault();
    if (!runtime) return;
    setCloudLoginBusy(true); setCloudLoginError('');
    const signedIn = await runtime.signInWithPassword(cloudLogin);
    if (!signedIn.ok) { setCloudLoginError(signedIn.error.message); setCloudLoginBusy(false); return; }
    const session = await runtime.sessions.bootstrap();
    setCloudLoginBusy(false);
    if (!session.ok) { setCloudLoginError(session.error.message); return; }
    setActiveService(new CloudAdminService(runtime));
  };

  const content = !snapshot || loading
    ? <LoadingState />
    : error
      ? <ErrorState message={error} onRetry={refresh} />
      : page === 'dashboard'
        ? <DashboardPage snapshot={snapshot} onNavigate={setPage} />
        : page === 'organization'
          ? <OrganizationPage snapshot={snapshot} service={activeService} onChanged={refresh} notify={notify} />
          : page === 'users'
            ? <UsersPage snapshot={snapshot} service={activeService} onChanged={refresh} notify={notify} />
            : <PermissionPage snapshot={snapshot} service={activeService} onChanged={refresh} notify={notify} />;

  return <>
    {runtime && activeService === service && <form className="cloud-login" onSubmit={loginToCloud} aria-label="后台云端登录">
      <strong>连接后台云端</strong><input value={cloudLogin.mobile} onChange={(event) => setCloudLogin({ ...cloudLogin, mobile: event.target.value })} placeholder="后台手机号" inputMode="numeric" />
      <input value={cloudLogin.password} onChange={(event) => setCloudLogin({ ...cloudLogin, password: event.target.value })} placeholder="密码" type="password" />
      <button type="submit" disabled={cloudLoginBusy}>{cloudLoginBusy ? '登录中…' : '登录云端'}</button>{cloudLoginError && <span>{cloudLoginError}</span>}
    </form>}
    <AdminShell active={page} title={TITLES[page]} onNavigate={setPage} onRefresh={refresh}>{content}</AdminShell>
    {toast && <div className={`toast toast--${toast.type}`} role="status">{toast.type === 'success' ? '✓' : '!'} {toast.message}</div>}
  </>;
}
