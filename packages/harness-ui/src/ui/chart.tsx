'use client';

import * as React from 'react';
import type { TooltipValueType } from 'recharts';
import * as RechartsPrimitive from 'recharts';

import { cn } from '../lib/utils';

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: '', dark: '.dark' } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
type TooltipNameType = number | string;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> })
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        id={id}
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          'min-w-0 max-w-full [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-ring [&_.recharts-surface:focus-visible]:outline-offset-2',
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/** Static series CSS variables preserve host CSP without injecting style tags. */
const ChartStyle = (_props: { id: string; config: ChartConfig }) => null;

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  ...props
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: 'line' | 'dot' | 'dashed';
    nameKey?: string;
    labelKey?: string;
  } & Omit<RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>, 'accessibilityLayer'>) {
  const { config } = useChart();
  const visiblePayload = React.useMemo(() => payload?.filter((item) => item.type !== 'none'), [payload]);

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !visiblePayload?.length) {
      return null;
    }

    const [item] = visiblePayload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && (typeof label === 'string' || typeof label === 'number') ? (config[String(label)]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return <div className={cn('font-normal', labelClassName)}>{labelFormatter(value, visiblePayload)}</div>;
    }

    if (value === undefined || value === null || value === '') {
      return null;
    }

    return <div className={cn('font-normal', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, visiblePayload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !visiblePayload?.length) {
    return null;
  }

  const nestLabel = visiblePayload.length === 1 && indicator !== 'dot';

  return (
    <div
      data-slot="chart-tooltip"
      className={cn('border-border/50 bg-background grid min-w-32 max-w-[min(20rem,calc(100vw-2rem))] items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-xs shadow-xl', className)}
      {...getChartContentDomProps(props)}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {visiblePayload
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            return (
              <div
                key={index}
                className={cn(
                  '[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {formatter && item?.value !== undefined && item.name != null ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon aria-hidden="true" />
                    ) : (
                      !hideIndicator && (
                        <div
                          aria-hidden="true"
                          className={cn('shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)', {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          })}
                          style={
                            {
                              '--color-bg': indicatorColor,
                              '--color-border': indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div className={cn('flex min-w-0 flex-1 justify-between gap-3 leading-none', nestLabel ? 'items-end' : 'items-center')}>
                      <div className="grid min-w-0 gap-1.5 break-words">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value != null && (
                        <span className="text-foreground shrink-0 font-mono font-normal tabular-nums">
                          {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
  ...props
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean;
  nameKey?: string;
} & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();
  const visiblePayload = payload?.filter((item) => item.type !== 'none');

  if (!visiblePayload?.length) {
    return null;
  }

  return (
    <div data-slot="chart-legend" className={cn('flex min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-2', verticalAlign === 'top' ? 'pb-3' : 'pt-3', className)} {...getChartContentDomProps(props)}>
      {visiblePayload
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div key={index} className={cn('[&>svg]:text-muted-foreground flex min-w-0 items-center gap-1.5 break-words [&>svg]:h-3 [&>svg]:w-3')}>
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon aria-hidden="true" />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              <span className="min-w-0 break-words">{itemConfig?.label ?? item.value ?? (typeof item.dataKey === 'string' || typeof item.dataKey === 'number' ? item.dataKey : '')}</span>
            </div>
          );
        })}
    </div>
  );
}

function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const payloadPayload = 'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null ? payload.payload : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key as keyof typeof payloadPayload] === 'string') {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

// Recharts injects its own configuration props into custom content. Forward
// actual div attributes and handlers without leaking chart options into the DOM.
function getChartContentDomProps(props: Record<string, unknown>) {
  const globalAttributes = new Set(['id', 'ref', 'role', 'style', 'title', 'tabIndex', 'dir', 'lang', 'hidden', 'accessKey', 'draggable']);
  return Object.fromEntries(Object.entries(props).filter(([key]) => globalAttributes.has(key) || /^(aria-|data-|on[A-Z])/.test(key)));
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartStyle, ChartTooltip, ChartTooltipContent };
