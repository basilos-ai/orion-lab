import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@orion/harness-ui/ui/chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@orion/harness-ui/ui/card';
import { Badge } from '@orion/harness-ui/ui/badge';
import { finite, gib, reading, resourceAxis, resourceHistoryWindow, resourceSampleGapMs, resourceTrend, type ResourcePoint } from './resource-state';

type Metric = 'cpu' | 'ram_available' | 'temperature';
const clock = (time: number) => new Date(time).toLocaleTimeString(getLocale(), { hour12: false, timeZone: 'Asia/Shanghai' });
/** Values are real samples. Null separators break sampling gaps without inventing observations. */
function chartPoints(points: ResourcePoint[], metric: Metric, scale = 1) {
  const data: { time: number; value: number | null }[] = [];
  let previous = -Infinity;
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!finite(time) || time <= previous) { if (finite(previous)) data.push({ time: previous, value: null }); continue; }
    if (finite(previous) && time - previous > resourceSampleGapMs) data.push({ time, value: null });
    data.push({ time, value: finite(point[metric]) ? point[metric]! / scale : null });
    previous = time;
  }
  return data;
}
function formatted(value: number, metric: Metric) {
  return metric === 'ram_available' ? gib(value) : reading(value, 1, metric === 'temperature' ? ' °C' : '%');
}
export function ResourceMicroTrend({ points, metric, max, label }: { points: ResourcePoint[]; metric: Metric; max?: number; label: string }) {
  const recent = resourceHistoryWindow(points).points.slice(-20);
  const trend = resourceTrend(recent, metric, max);
  if (!trend.ready) return <span className="resource-history-empty">{trend.count ? t("等待连续采样") : t("暂无历史采样")}</span>;
  const data = chartPoints(recent, metric), axis = resourceAxis(data.map(point => point.value), max);
  return <figure className="resource-trend-figure"><ChartContainer config={{ value: { label, color: 'var(--foreground)' } }} initialDimension={{ width: 88, height: 40 }} className="resource-trend" role="img" aria-label={label + t("趋势，最近 ") + trend.count + t(" 个真实采样")}>
    <AreaChart data={data} margin={{ top: 3, right: 1, bottom: 2, left: 1 }} accessibilityLayer={false}>
      <YAxis hide domain={[0, axis.upper]} ticks={axis.ticks} />
      <ChartTooltip content={<ChartTooltipContent hideLabel hideIndicator formatter={value => formatted(Number(value), metric)} />} />
      <Area dataKey="value" type="linear" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.04} strokeWidth={1.5} connectNulls={false} dot={false} isAnimationActive={false} />
    </AreaChart>
  </ChartContainer><figcaption className="sr-only">{t("最近")}{trend.count}{t("个真实采样，纵轴随采样峰值缩放，缺失或间断处不连线")}</figcaption></figure>;
}
function HistoryChart({ points, metric, title, description, unit, max, scale = 1 }: { points: ResourcePoint[]; metric: Metric; title: string; description: string; unit: string; max?: number; scale?: number }) {
  const window = resourceHistoryWindow(points), recent = window.points;
  const trend = resourceTrend(recent, metric);
  const data = chartPoints(recent, metric, scale), axis = resourceAxis(data.map(point => point.value), max);
  return <Card className="resource-history-card" role="region" aria-label={title}>
    <CardHeader className="resource-history-heading"><div><CardTitle><h2>{title}</h2></CardTitle><CardDescription>{description}{t("· 纵轴自适应（")}{unit}{t("）")}</CardDescription></div><Badge variant="outline">{trend.count}{t("个采样")}</Badge></CardHeader>
    <CardContent>{trend.ready ? <ChartContainer config={{ value: { label: title, color: 'var(--foreground)' } }} className="resource-history-chart" initialDimension={{ width: 480, height: 240 }}>
      <AreaChart data={data} margin={{ top: 16, right: 10, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis type="number" dataKey="time" domain={['dataMin', 'dataMax']} tickFormatter={clock} minTickGap={48} axisLine={false} tickLine={false} tickMargin={8} />
        <YAxis domain={[0, axis.upper]} ticks={axis.ticks} width={42} axisLine={false} tickLine={false} tickFormatter={value => String(Number(Number(value).toFixed(2)))} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={value => clock(Number(value))} formatter={value => reading(Number(value), metric === 'ram_available' ? 2 : 1, ' ' + unit)} />} />
        <Area type="linear" dataKey="value" stroke="var(--color-value)" strokeWidth={2} fill="var(--color-value)" fillOpacity={0.06} connectNulls={false} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer> : <div className="resource-history-placeholder"><span>{t("等待连续的真实采样")}</span><p>{t("收到有效历史后显示趋势，当前数值仍可在上方查看。")}</p></div>}{window.interrupted && <p className="resource-history-note">{t("采样时间曾中断，当前仅显示最近连续采样；中断前的历史仍保留在快照中。")}</p>}</CardContent>
  </Card>;
}
export function ResourceHistory({ points }: { points: ResourcePoint[] }) {
  return <section className="resource-history-grid" aria-label={t("资源历史趋势")}><HistoryChart points={points} metric="cpu" title={t("CPU 使用趋势")} description={t("整机占用 · 最近真实采样")} unit="%" max={100} /><HistoryChart points={points} metric="ram_available" title={t("可用内存趋势")} description={t("主机内存 · 与卡载内存分别统计")} unit="GiB" scale={1024 ** 3} /></section>;
}
