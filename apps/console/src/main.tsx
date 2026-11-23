import { t } from '@/lib/i18n';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { useLocale } from './lib/use-locale';
import './styles/index.css';
const Chat = lazy(() => import('./features/chat/chat-page'));
const Dashboard = lazy(() => import('./features/dashboard/dashboard-page'));
const root = document.getElementById('root')!;
document.documentElement.dataset.surface = root.dataset.surface || 'dashboard';
function LocalizedApp() {
  const locale = useLocale();
  useEffect(() => {
    const chat = root.dataset.surface === 'chat';
    document.title = chat ? t('Orion Lab · 智能对话') : t('Orion Lab · 资源监控');
    document.querySelector('meta[name="description"]')?.setAttribute('content', chat ? t('本地与云端模型对话、自动选模和真实输入审核状态。') : t('Orion O6N 设备资源、后摩加速卡和模型进程的实时监控。'));
  }, [locale]);
  useEffect(() => {
    const update = (event: Event) => { const field = event.target; if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return; field.setCustomValidity(''); if (!field.validity.valid) field.setCustomValidity(t(field.validity.valueMissing ? '请填写此字段。' : '请检查此字段的格式或长度。')); };
    const clear = (event: Event) => { const field = event.target; if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setCustomValidity(''); };
    document.addEventListener('invalid', update, true); document.addEventListener('input', clear, true);
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea').forEach(field => { if (field.validity.customError) { field.setCustomValidity(''); if (!field.validity.valid) field.setCustomValidity(t(field.validity.valueMissing ? '请填写此字段。' : '请检查此字段的格式或长度。')); } });
    return () => { document.removeEventListener('invalid', update, true); document.removeEventListener('input', clear, true); };
  }, [locale]);
  return <Suspense fallback={<div className="app-loading" role="status">{t('正在载入工作台…')}</div>}>{root.dataset.surface === 'chat' ? <Chat /> : <Dashboard />}</Suspense>;
}
createRoot(root).render(<LocalizedApp />);
