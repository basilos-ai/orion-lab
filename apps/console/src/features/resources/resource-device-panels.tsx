import { getLocale } from '@/lib/locale';
import { t, errorText } from '@/lib/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Boxes, Cpu, Gauge, MemoryStick, Monitor, RotateCw, Thermometer, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@orion/harness-ui/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@orion/harness-ui/ui/card';
import { Progress } from '@orion/harness-ui/ui/progress';
import { acceleratorTelemetry, difference, finite, gib, percent, reading, type CardReading, type Reading, type ResourceSample } from './resource-state';

export function ResourcePanel({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={`panel resource-panel ${className}`} role="region" aria-label={title}>
    <CardHeader className="panel-heading"><div><CardTitle><h2>{title}</h2></CardTitle>{description && <CardDescription><p>{description}</p></CardDescription>}</div>{action && <CardAction>{action}</CardAction>}</CardHeader>
    {children}
  </Card>;
}

export function ResourceMeter({ value, label }: { value: Reading; label: string }) {
  return <Progress className="resource-meter" value={finite(value) ? Math.max(0, Math.min(100, value)) : null} role="meter" aria-label={label} aria-hidden={!finite(value)} data-unknown={!finite(value) || undefined} />;
}

function DetailMetric({ title, value, icon: Icon, action, children }: { title: string; value?: ReactNode; icon: typeof Cpu; action?: ReactNode; children: ReactNode }) {
  return <Card size="sm" className="resource-detail-metric" role="group" aria-label={title}>
    <CardHeader className="resource-detail-heading"><CardTitle><Icon aria-hidden="true" /><h3>{title}</h3></CardTitle>{action && <CardAction>{action}</CardAction>}</CardHeader>
    <CardContent className="resource-detail-content">{value !== undefined && <strong className="resource-detail-value">{value}</strong>}{children}</CardContent>
  </Card>;
}

function DetailReading({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function AcceleratorPanel({ card, age, connected = true, onReadOnce }: { card: CardReading; age: Reading; connected?: boolean; onReadOnce?: (bdf: string) => Promise<void> }) {
  const [readingOnce, setReadingOnce] = useState(false), [readError, setReadError] = useState(''), [cooldown, setCooldown] = useState(false);
  const readInFlight = useRef(false);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(false), 10000); return () => clearTimeout(timer); }, [cooldown]);
  async function readOnce() {
    if (!onReadOnce || readInFlight.current || cooldown) return;
    readInFlight.current = true; setReadingOnce(true); setReadError('');
    try { await onReadOnce(card.bdf); }
    catch (cause) { setReadError((cause as Error).message); }
    finally { readInFlight.current = false; setReadingOnce(false); setCooldown(true); }
  }
  const telemetry = acceleratorTelemetry(card, age, connected), sleeping = telemetry.mode === 'sleeping';
  const valid = telemetry.canRead, historical = telemetry.historical;
  const manualSnapshot = !!card.smi_manual && valid;
  const awaitingManual = connected && card.smi_mode === 'manual' && !card.smi_sample_at && !card.smi_error;
  const value = (key: keyof CardReading) => valid && finite(card[key]) ? card[key] as number : null;
  const sampledAt = card.smi_sample_at ? new Date(card.smi_sample_at).toLocaleTimeString(getLocale(), { timeZone: 'Asia/Shanghai', hour12: false }) : null;
  const sampleNote = sampledAt && finite(telemetry.age) ? t("上次采样 {0}（{1}）。", [sampledAt, reading(telemetry.age, 0, t(" 秒前"))]) : t("尚无设备唤醒时的采样。");
  const badge = sleeping ? t("设备休眠") : awaitingManual ? t("等待读取") : telemetry.mode === 'manual' ? t("手动快照") : telemetry.mode === 'idle' ? t("空闲 · {0} 秒采样", [card.smi_interval]) : valid ? `SMI · ${reading(telemetry.age, 1, t(" 秒前"))}` : t("SMI 暂不可用");
  return <ResourcePanel title={t("后摩加速卡 · {0}", [card.model || t("设备已识别")])} className="resource-accelerator-panel" description={`${card.bdf} · PCIe x${card.width || 'N/A'} / ${card.link || 'N/A'}`} action={<div className="resource-card-actions"><Badge variant={sleeping || historical ? 'secondary' : valid ? 'success' : 'warning'}>{badge}</Badge><Button size="sm" variant="outline" onClick={readOnce} disabled={!onReadOnce || !connected || readingOnce || cooldown} aria-label={readingOnce ? t("读取中…") : cooldown ? t("稍后可再读取") : t("读取一次后摩卡载指标")} title={t("短暂唤醒设备读取一次，随后允许自动休眠")}>{readingOnce && <RotateCw aria-hidden="true" />}{readingOnce ? t("读取中…") : cooldown ? t("稍后可再读取") : t("读取一次")}</Button></div>}>
    <p className="resource-card-read-hint">{t("推理卡指标仅在点击“读取一次”时更新，会短暂唤醒设备，完成后允许自动休眠。")}</p>
    {readError && <p className="resource-card-error" role="alert">{errorText(readError)}</p>}
    {historical && <p className="resource-panel-note" role="status">{manualSnapshot ? t("以下为手动读取的快照，不会连续查询。") : sleeping ? t("设备休眠，已暂停卡载指标查询。保留的内存和温度为历史读数。") : t("计算核连续空闲，已降低采样频率以便设备自动休眠。以下为最近一次采样。")} {sampleNote}</p>}
    {!valid && !awaitingManual && <p className="resource-card-error" role="status">{card.smi_error ? errorText(card.smi_error) : t("后摩指标未就绪或已过期。")}{t("卡载数值暂显示 N/A，主机采样继续。")}</p>}
    {awaitingManual && !sleeping && <p className="resource-panel-note" role="status">{t("尚未手动读取，点击“读取一次”获取卡载快照。")}</p>}
    <div className="resource-accelerator-grid">
      <DetailMetric title={manualSnapshot ? t("上次 IPU 负载") : t("IPU 负载")} icon={Cpu} value={sleeping && !manualSnapshot ? t("休眠") : reading(value('ipu_load'), 1, '%')}>
        <ResourceMeter value={sleeping && !manualSnapshot ? null : value('ipu_load')} label={t("后摩 IPU 负载")} />
        <dl className="resource-detail-readings">{valid && (!sleeping || manualSnapshot) && card.core_util?.length ? card.core_util.map((load, index) => <DetailReading key={index} label={t("核心 {0}", [index])}>{reading(load, 1, '%')}</DetailReading>) : <DetailReading label={t("计算核利用率")}>{sleeping ? t("暂停采样") : 'N/A'}</DetailReading>}</dl>
      </DetailMetric>
      <DetailMetric title={historical ? t("卡载内存 · 上次已用") : t("卡载内存 · 已用")} icon={MemoryStick} value={gib(value('memory_used'))}>
        <ResourceMeter value={percent(value('memory_used'), value('memory_total'))} label={t("后摩卡载内存已用百分比")} />
        <dl className="resource-detail-readings"><DetailReading label={t("总量")}>{gib(value('memory_total'))}</DetailReading><DetailReading label={t("可用")}>{gib(value('memory_free'))}</DetailReading></dl>
      </DetailMetric>
      <DetailMetric title={historical ? t("上次核心温度 · 最高") : t("核心温度 · 最高")} icon={Thermometer} value={reading(value('core_temp'), 1, ' °C')}>
        <dl className="resource-detail-readings"><DetailReading label={historical ? t("上次 DDR 温度") : t("DDR 温度")}>{reading(value('ddr_temp'), 1, ' °C')}</DetailReading></dl>
      </DetailMetric>
      <DetailMetric title={manualSnapshot ? t("上次板卡功耗") : t("板卡功耗")} icon={Zap} value={sleeping && !manualSnapshot ? 'N/A' : reading(value('power_w'), 2, ' W')}>
        <dl className="resource-detail-readings"><DetailReading label={manualSnapshot ? t("上次工作频率") : t("工作频率")}>{sleeping && !manualSnapshot ? 'N/A' : reading(value('frequency_mhz'), 0, ' MHz')}</DetailReading></dl>
        <p className="resource-detail-note">{manualSnapshot ? t("手动读取时的板卡功耗") : sleeping ? t("休眠期间不读取功耗与频率") : t("仅统计板卡功耗")}</p>
      </DetailMetric>
    </div>
    <div className="resource-card-meta"><span>{t("驱动")}<b>{card.driver_version || 'N/A'}</b></span><span>{t("固件")}<b>{card.firmware_version || 'N/A'}</b></span></div>
  </ResourcePanel>;
}

export function SystemResourcesPanel({ sample }: { sample: ResourceSample }) {
  const swapUsed = difference(sample.swap_total, sample.swap_free);
  return <ResourcePanel title={t("GPU / CIX NPU / 容器")} className="resource-system-panel" description={t("按设备分组，仅展示可读取的指标")}>
    <div className="resource-system-grid">
      <DetailMetric title="GPU" icon={Monitor} value={sample.accelerators.gpu.length ? undefined : 'N/A'} action={<Badge variant="outline">{sample.accelerators.gpu.length ? t("已识别") : t("未提供")}</Badge>}>
        {sample.accelerators.gpu.length ? sample.accelerators.gpu.map((gpu, index) => <div className="resource-device-reading" key={`${gpu.name}-${index}`}><p className="resource-device-name">{gpu.name}</p><dl className="resource-detail-readings"><DetailReading label={t("利用率")}>{reading(gpu.busy, 1, '%')}</DetailReading><DetailReading label={t("显存已用")}>{gib(gpu.vram_used)}</DetailReading><DetailReading label={t("显存总量")}>{gib(gpu.vram_total)}</DetailReading></dl></div>) : <p className="resource-detail-note">{t("暂无可读取的 GPU 指标")}</p>}
      </DetailMetric>
      <DetailMetric title="CIX NPU" icon={Cpu} value={sample.accelerators.npu.length ? undefined : 'N/A'} action={<Badge variant={sample.accelerators.aipu_loaded ? 'success' : 'outline'}>{sample.accelerators.aipu_loaded ? t("已加载") : t("未检测到")}</Badge>}>
        {sample.accelerators.npu.map((npu, index) => <div className="resource-device-reading" key={`${npu.name}-${index}`}><p className="resource-device-name">{npu.name}</p><strong className="resource-detail-value resource-frequency-value">{finite(npu.frequency) ? reading(npu.frequency / 1e9, 2, ' GHz') : 'N/A'}</strong></div>)}
        <p className="resource-detail-note">{t("利用率 N/A · 接口未暴露")}</p>
      </DetailMetric>
      <DetailMetric title="Docker" icon={Boxes} value={reading(sample.docker_count, 0, t(" 个"))}>
        <dl className="resource-detail-readings"><DetailReading label={t("内存合计")}>{gib(sample.docker_memory)}</DetailReading></dl><p className="resource-detail-note">{t("cgroup 统计，含缓存")}</p>
      </DetailMetric>
      <DetailMetric title="Swap" icon={Gauge} value={gib(swapUsed)} action={sample.swap_total === 0 ? <Badge variant="outline">{t("未启用")}</Badge> : undefined}>
        <ResourceMeter value={percent(swapUsed, sample.swap_total)} label={t("Swap 已用百分比")} />
        <dl className="resource-detail-readings"><DetailReading label={t("总量")}>{gib(sample.swap_total)}</DetailReading></dl>
      </DetailMetric>
    </div>
  </ResourcePanel>;
}
