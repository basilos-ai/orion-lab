import { getLocale } from '@/lib/locale';
import { t, errorText } from '@/lib/i18n';
import { Activity, ArrowDown, ArrowDownToLine, ArrowUp, Cpu, HardDrive, Info, MemoryStick, MoreHorizontal, Network, Pause, Play, RotateCw, Thermometer, Timer, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@orion/harness-ui/ui/badge';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@orion/harness-ui/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@orion/harness-ui/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@orion/harness-ui/ui/empty';
import { RadioGroup, RadioGroupItem } from '@orion/harness-ui/ui/radio-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@orion/harness-ui/ui/dropdown-menu';
import { ResourceHistory, ResourceMicroTrend } from './resource-charts';
import { AcceleratorPanel, ResourcePanel as Panel, ResourceMeter as Meter, SystemResourcesPanel } from './resource-device-panels';
import { Skeleton } from '@orion/harness-ui/ui/skeleton';
import { ResourceProcessPanel } from './resource-process-panel';
import { config, downloadFile } from '@/lib/config';
import { useResources } from './use-resources';
import { difference, finite, gib, percent, rate, reading } from './resource-state';

function Metric({ title, value, note, icon: Icon, children }: { title: string; value: string; note: string; icon: typeof Cpu; children?: ReactNode }) {
  return <Card size="sm" className="resource-metric" role="group" aria-label={title} data-overview-metric="">
    <CardHeader className="resource-metric-label"><span className="resource-metric-icon"><Icon aria-hidden="true" /></span><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="resource-metric-content"><div className="resource-metric-main"><strong className="resource-value">{value}</strong><div className="resource-metric-chart">{children}</div></div><p>{note}</p></CardContent>
  </Card>;
}

const labels = { get live() { return t("实时采集中"); }, get warming() { return t("等待首个采样"); }, get stale() { return t("数据已过期"); }, get paused() { return t("已暂停刷新"); }, get hidden() { return t("页面隐藏，暂停刷新"); } };
function clock(value?: string) { return value ? new Date(value).toLocaleTimeString(getLocale(), { timeZone: 'Asia/Shanghai', hour12: false }) : '—'; }
function uptime(seconds: number) { return t("{0} 天 {1} 时 {2} 分", [Math.floor(seconds / 86400), Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60)]); }

export default function ResourcesPage() {
  const monitor = useResources(), { envelope, error, status } = monitor, sample = envelope?.sample;
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const history = envelope?.history || [], temperatures = sample?.temperatures.map(item => item.value).filter(finite) || [];
  const maxTemp = temperatures.length ? Math.max(...temperatures) : null;
  const ramUsed = sample ? difference(sample.ram_total, sample.ram_available) : null;
  const stateLabel = config.demo ? t("演示预览") : !sample && error && !monitor.paused ? t("连接失败") : labels[status];
  function snapshot() {
    if (sample) downloadFile(t("O6N资源快照-{0}.json", [sample.timestamp.replace(/[:.]/g, '-')]), JSON.stringify({ ...envelope, view_status: status, sample_age_seconds: monitor.age, exported_at: new Date().toISOString() }, null, 2), 'application/json');
  }
  return <div className="page-content resources-page">
    <header className="page-header">
      <div><span className="resource-eyebrow">{t("设备运行状态")}</span><h1>{t("资源监控")}</h1><p>{t("查看 O6N 实时负载与模型占用，主机内存和卡载内存分别统计。")}</p></div>
    </header>
    <div className="resource-toolbar">
      <div className={`resource-live ${status}`} role="status"><Badge variant={config.demo ? 'secondary' : status === 'live' ? 'success' : status === 'stale' || error ? 'warning' : 'secondary'}><span className="status-dot" />{stateLabel}</Badge></div>
      <span className="resource-sampling">{t("主机 1 秒采样 · 推理卡仅手动读取")}</span>
      <div className="resource-toolbar-controls">
      <div className="resource-refresh">
        <span className="resource-refresh-label" id="resource-refresh-label"><Timer aria-hidden="true" />{t("刷新频率")}</span>
        <RadioGroup className="resource-refresh-options" aria-labelledby="resource-refresh-label" orientation="horizontal" value={String(monitor.interval)} onValueChange={value => monitor.setIntervalSeconds(Number(value))}>
          {[1, 2, 5].map(value => <label className="resource-refresh-option" htmlFor={`resource-interval-${value}`} key={value}>
            <RadioGroupItem id={`resource-interval-${value}`} value={String(value)} aria-label={t("{0} 秒", [value])} /><span aria-hidden="true">{value}{t("秒")}</span>
          </label>)}
        </RadioGroup>
      </div>
      <div className="page-actions resource-page-actions" role="group" aria-label={t("资源监控操作")} ref={setActionsContainer}>
        <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="resource-actions-trigger" aria-label={t("更多资源操作")} title={t("更多操作")}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="resource-actions-menu" portalContainer={actionsContainer?.closest('main')}>
            <DropdownMenuItem disabled={!monitor.canRefresh} onSelect={monitor.refresh} aria-label={t("刷新资源数据")}><RotateCw aria-hidden="true" />{t("刷新")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => monitor.setPaused(!monitor.paused)}>{monitor.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{monitor.paused ? t("继续刷新") : t("暂停刷新")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!sample} onSelect={snapshot}><ArrowDownToLine aria-hidden="true" />{t("保存快照")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </div>
    {sample && (error || envelope?.error || status === 'stale' || status === 'paused') && <Alert className="resource-state-alert" variant="warning" role="status">
      {status === 'paused' ? <Pause aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      <AlertTitle>{status === 'paused' ? t("已暂停页面刷新，当前数值为保留快照。") : t("实时数据暂不可用，保留最后一次采样。")}</AlertTitle>
      <AlertDescription>{error || envelope?.error ? errorText(error || envelope?.error) : t("继续刷新后将读取最新采样。")}{t("最后采样")}{clock(sample.timestamp)}{t("。")}</AlertDescription>
      {!monitor.paused && <AlertAction><Button variant="outline" size="sm" disabled={!monitor.canRefresh} onClick={monitor.refresh}>{t("重新连接")}</Button></AlertAction>}
    </Alert>}
    {!sample ? <>
      {monitor.paused ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Pause aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("采集已暂停")}</EmptyTitle><EmptyDescription>{t("点击继续刷新，开始读取设备指标。")}</EmptyDescription></EmptyHeader></Empty> : config.demo ? <Alert variant="info" role="status" className="resource-state-alert"><Info aria-hidden="true" /><AlertTitle>{t("尚未连接设备")}</AlertTitle><AlertDescription>{t("当前为演示预览。资源监控需要 O6N 采集接口，连接后可查看真实指标。")}</AlertDescription></Alert> : error || envelope?.error ? <Alert variant="error" className="resource-state-alert"><WifiOff aria-hidden="true" /><AlertTitle>{t("暂时无法读取资源指标")}</AlertTitle><AlertDescription>{errorText(error || envelope?.error)}{t("尚未收到首个采样，请检查设备连接后重试。")}</AlertDescription><AlertAction><Button variant="outline" disabled={!monitor.canRefresh} onClick={monitor.refresh}><RotateCw />{t("重试")}</Button></AlertAction></Alert> : <div className="resource-loading" role="status" aria-busy="true"><p>{t("正在读取设备首个采样，请稍候…")}</p><div className="resource-stats">{[1, 2, 3, 4].map(key => <Skeleton className="resource-metric-placeholder" key={key} />)}</div><Skeleton className="resource-panel-placeholder" /></div>}
    </> : <div className={`resource-data ${status === 'stale' || status === 'paused' ? 'snapshot' : ''}`} aria-busy={monitor.fetching || undefined}>
      <div className="resource-data-heading"><span>{t("实时指标")}</span><span className="resource-update-status"><span>{t("最近采样")}</span><time dateTime={sample.timestamp}>{clock(sample.timestamp)}</time></span></div>
      <div className="resource-stats">
        <Metric title={t("CPU · 整机占用")} value={reading(sample.cpu, 1, '%')} note={t("{0} 核 · 负载 {1}", [sample.core_ids.length, sample.loadavg.join(' / ') || 'N/A'])} icon={Cpu}><ResourceMicroTrend points={history} metric="cpu" max={100} label={t("CPU 占用")} /></Metric>
        <Metric title={t("内存 · 可用")} value={gib(sample.ram_available)} note={t("已用 {0} / {1}", [gib(ramUsed), gib(sample.ram_total)])} icon={MemoryStick}><ResourceMicroTrend points={history} metric="ram_available" max={sample.ram_total || undefined} label={t("可用内存")} /></Metric>
        <Metric title={t("系统盘 / · 可用")} value={gib(sample.disk_available, 1)} note={t("已用 {0} / {1}", [gib(sample.disk_used), gib(sample.disk_total)])} icon={HardDrive}><Meter value={percent(sample.disk_used, sample.disk_total)} label={t("系统盘已用百分比")} /></Metric>
        <Metric title={t("系统温度 · 最高探头")} value={reading(maxTemp, 1, ' °C')} note={t("{0} 个温度探头", [temperatures.length])} icon={Thermometer}><ResourceMicroTrend points={history} metric="temperature" max={100} label={t("系统温度")} /></Metric>
      </div>
      <ResourceHistory points={history} />
      <div className="resource-grid">
        <Panel title={t("CPU 核心")} description={t("实时占用与当前频率")} action={<Badge variant="secondary">{sample.core_ids.length}{t("核")}</Badge>}><div className="resource-cores">{sample.core_ids.map((id, index) => <div className="resource-core" key={id}><div><span>C{id}</span><strong>{reading(sample.cores[index], 1, '%')}</strong></div><Meter value={sample.cores[index]} label={t("CPU 核心 {0} 占用", [id])} /><small>{finite(sample.frequencies[index]) ? reading(sample.frequencies[index]! / 1e6, 2, ' GHz') : 'N/A'}</small></div>)}</div></Panel>
        <Panel title={t("网络与磁盘")} description={t("物理网卡汇总与根分区每秒速率")}><dl className="resource-rates">{[{ label: t("网络接收"), value: sample.rx_bps, Icon: ArrowDown }, { label: t("网络发送"), value: sample.tx_bps, Icon: ArrowUp }, { label: t("磁盘读取"), value: sample.read_bps, Icon: ArrowDown }, { label: t("磁盘写入"), value: sample.write_bps, Icon: ArrowUp }].map(({ label, value, Icon }) => <div key={label}><dt><Icon aria-hidden="true" />{label}</dt><dd>{rate(value)}</dd></div>)}</dl><p className="resource-panel-note"><Network aria-hidden="true" />{sample.net_interfaces.join(' · ') || t("物理网卡指标未暴露")}</p></Panel>
      </div>
      {sample.accelerators.houmo.length ? sample.accelerators.houmo.map(card => <AcceleratorPanel key={card.bdf} card={card} age={monitor.age} connected={status === 'live'} onReadOnce={monitor.readCardOnce} />) : <Panel title={t("后摩加速卡")}><p className="resource-panel-note">{t("未检测到后摩设备，卡载指标 N/A。")}</p></Panel>}
      <div className="resource-grid resource-process-grid">
        <ResourceProcessPanel sample={sample} />
        <SystemResourcesPanel sample={sample} />
      </div>
      <details className="resource-method"><summary>{t("指标口径与采样说明")}</summary><p>{t("CPU 根据相邻采样差值计算，不含 iowait；内存可用量取 MemAvailable。磁盘可用量不含文件系统保留空间。网络只汇总物理网卡，排除回环和容器网桥。温度为系统探头最高值。主机 RAM 与后摩卡 DDR 分别统计；板卡功耗不代表整机功耗。")}</p><p>{t("最近 60 次主机采样保存在设备内存中。页面隐藏或暂停时停止请求，约 15 秒无访客后暂停主机采集；多访客共享同一采集器。推理卡没有后台遥测采样，仅点击“读取一次”时查询一次，保留带时间的手动快照；运行或休眠均不自动更新卡载数值。电源状态读取不会唤醒设备，采样不修改调频模式。")}</p></details>
      <footer className="page-footer resource-footer"><span><Activity aria-hidden="true" />{sample.host} · {sample.kernel}{t("· 已运行")}{uptime(sample.uptime)}</span><time dateTime={sample.timestamp}>{t("最近采样")}{clock(sample.timestamp)} · {reading(monitor.age, 0, t(" 秒前"))}</time></footer>
    </div>}
  </div>;
}
