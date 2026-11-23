import { t, errorText } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { config } from '@/lib/config';
import { resourceStatus, sampleAge, type ResourceEnvelope } from './resource-state';

export function useResources() {
  const [envelope, setEnvelope] = useState<ResourceEnvelope | null>(null), [error, setError] = useState('');
  const [paused, setPaused] = useState(false), [interval, setIntervalSeconds] = useState(1), [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [receivedAt, setReceivedAt] = useState(0), [now, setNow] = useState(Date.now());
  const [fetching, setFetching] = useState(false), requestInFlight = useRef(false), manualVersion = useRef(0);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', change);
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { document.removeEventListener('visibilitychange', change); clearInterval(ticker); };
  }, []);
  useEffect(() => {
    if (config.demo || paused || !visible) { setFetching(false); return; }
    let active = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const version = manualVersion.current;
      requestInFlight.current = true; setFetching(true);
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const response = await fetch('/api/resources', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(t("资源监控暂不可用，请重试。"));
        const next: ResourceEnvelope = await response.json();
        if (!['live', 'warming', 'stale'].includes(next.status) || !Array.isArray(next.history) || next.sample && (!Array.isArray(next.sample.cores) || !Array.isArray(next.sample.models) || !next.sample.accelerators)) throw new Error(t("资源数据格式异常，请重试。"));
        if (active && version === manualVersion.current) { setEnvelope(next); setReceivedAt(Date.now()); setNow(Date.now()); setError(''); }
      } catch (cause) {
        if (active && version === manualVersion.current) setError(controller.signal.aborted ? t("读取超时，正在尝试重新连接。") : (cause as Error).message);
      } finally {
        clearTimeout(timeout);
        if (active) {
          requestInFlight.current = false; setFetching(false);
          timer = setTimeout(() => setRefresh(value => value + 1), interval * 1000);
        }
      }
    }
    void poll();
    return () => { active = false; requestInFlight.current = false; controller.abort(); clearTimeout(timer); };
  }, [paused, visible, interval, refresh]);
  const age = sampleAge(envelope, receivedAt, now);
  async function readCardOnce(bdf: string) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch('/api/resources/card-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bdf }), signal: controller.signal });
      const next = await response.json();
      if (!response.ok) throw new Error(errorText(next.error || t("单次读取失败，请稍后重试。"), next.code));
      if (!next.sample?.accelerators?.houmo?.some((card: { bdf: string }) => card.bdf === bdf)) throw new Error(t("尚未取得设备采样，请稍后重试。"));
      manualVersion.current++; setEnvelope(next); setReceivedAt(Date.now()); setNow(Date.now()); setError('');
      // Cancel any older in-flight GET and resume ordinary, non-waking host polling.
      setRefresh(value => value + 1);
    } catch (cause) {
      throw new Error(controller.signal.aborted ? t("读取超时，请稍后手动重试。") : (cause as Error).message);
    } finally { clearTimeout(timeout); }
  }
  return { envelope, error: config.demo ? t("预览未连接设备，资源监控需要 O6N 本机采集接口。") : error, paused, setPaused, interval, setIntervalSeconds,
    readCardOnce: !config.demo && !paused && visible ? readCardOnce : undefined,
    fetching: fetching && !paused && visible, canRefresh: !config.demo && !paused && visible && !fetching,
    refresh: () => { if (!config.demo && !paused && visible && !requestInFlight.current) setRefresh(value => value + 1); },
    age, status: resourceStatus(envelope, age, error, paused, visible, Math.max(4, interval + 2)) };
}
