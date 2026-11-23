import { t } from '@/lib/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@orion/harness-ui/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@orion/harness-ui/ui/dialog';
import { pageWindow } from '@/lib/config';

export function Modal({ open, onOpenChange, title, description, children, footer, className = '', onEscapeKeyDown, contentLabel }: { open: boolean; onOpenChange: (value: boolean) => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; className?: string; onEscapeKeyDown?: (event:KeyboardEvent)=>void; contentLabel?: string }) {
  const previous = useRef<HTMLElement | null>(null), wasOpen = useRef(false);
  if (open && !wasOpen.current) previous.current = document.activeElement as HTMLElement;
  wasOpen.current = open;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className={`console-dialog ${className} ${className.includes('mobile-sidebar') ? 'translate-x-0 translate-y-0' : ''}`} closeLabel={t("关闭弹窗")} onEscapeKeyDown={onEscapeKeyDown} onCloseAutoFocus={event => { const target = previous.current?.isConnected ? previous.current : document.querySelector<HTMLElement>('[data-navigation-trigger]'); if (target) { event.preventDefault(); target.focus(); } }}><div className="dialog-header"><DialogTitle>{title}</DialogTitle><DialogDescription className={description ? '' : 'sr-only'}>{description || title}</DialogDescription></div><div className="dialog-content" tabIndex={contentLabel ? 0 : undefined} role={contentLabel ? 'region' : undefined} aria-label={contentLabel}>{children}</div>{footer && <div className="dialog-actions">{footer}</div>}</DialogContent></Dialog>;
}
export function Empty({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty"><Search aria-hidden="true" /><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>; }
export function SearchField({ value, onChange, label, placeholder = t("搜索…") }: { value: string; onChange: (value: string) => void; label: string; placeholder?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="search-wrap"><Search aria-hidden="true" /><Input ref={input} type="search" value={value} onChange={event => onChange(event.target.value)} aria-label={label} placeholder={placeholder} />{value && <Button type="button" variant="ghost" size="icon-xs" aria-label={t("清空{0}", [label])} onClick={() => { onChange(''); input.current?.focus(); }}><X /></Button>}</div>;
}
export function Pagination({ count, page, onChange, size = 10 }: { count: number; page: number; onChange: (value: number) => void; size?: number }) {
  const bounds = pageWindow(count, page, size);
  return <div className="pagination"><span>{count ? t("{0}–{1} 条，共 {2} 条", [bounds.from + 1, bounds.to, count]) : t("0 条记录")}</span><div><Button variant="outline" size="sm" aria-label={t("上一页")} disabled={bounds.page === 1} onClick={() => onChange(bounds.page - 1)}><ChevronLeft /></Button><span className="page-number" aria-live="polite">{bounds.page} / {bounds.pages}</span><Button variant="outline" size="sm" aria-label={t("下一页")} disabled={bounds.page === bounds.pages} onClick={() => onChange(bounds.page + 1)}><ChevronRight /></Button></div></div>;
}
export function Panel({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>; }
export function CodeEvidence({ value, summary = t("查看完整证据") }: { value: unknown; summary?: string }) { return <details className="evidence"><summary>{summary}</summary><pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></details>; }
export function Retry({ title, onRetry }: { title: string; onRetry: () => void }) { return <div className="error-region" role="alert"><strong>{title}</strong><p>{t("已保留当前可用内容，请检查连接后重试。")}</p><Button variant="outline" onClick={onRetry}><RotateCw />{t("重试")}</Button></div>; }
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => { const media = matchMedia(query); const change = () => setMatches(media.matches); media.addEventListener('change', change); change(); return () => media.removeEventListener('change', change); }, [query]); return matches;
}
