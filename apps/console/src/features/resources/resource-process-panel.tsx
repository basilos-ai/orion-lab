import { t, uiText } from '@/lib/i18n';
import { ArrowLeftRight, Cpu, Layers, MemoryStick } from 'lucide-react';
import { Badge } from '@orion/harness-ui/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@orion/harness-ui/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@orion/harness-ui/ui/empty';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@orion/harness-ui/ui/table';
import { ResourcePanel } from './resource-device-panels';
import { gib, reading, type ResourceSample } from './resource-state';

export function ResourceProcessPanel({ sample }: { sample: ResourceSample }) {
  return <ResourcePanel title={t("当前模型进程")} className="resource-process-panel" description={t("llama-server · 主机 RSS 不含卡载内存")} action={<Badge variant="secondary">{reading(sample.model_processes, 0, t(" 个进程"))}</Badge>}>
    <div className="resource-process-summary">
      <Card size="sm" className="resource-process-stat" role="group" aria-label={t("主机 RSS 合计")}><CardHeader><CardTitle><MemoryStick aria-hidden="true" /><h3>{t("主机 RSS 合计")}</h3></CardTitle></CardHeader><CardContent><strong>{gib(sample.model_rss)}</strong></CardContent></Card>
      <Card size="sm" className="resource-process-stat" role="group" aria-label={t("进程 CPU · 占整机")}><CardHeader><CardTitle><Cpu aria-hidden="true" /><h3>{t("进程 CPU · 占整机")}</h3></CardTitle></CardHeader><CardContent><strong>{reading(sample.model_cpu, 1, '%')}</strong></CardContent></Card>
    </div>
    {sample.models.length ? <>
      <Table className="resource-model-table" containerProps={{ className: 'resource-process-table-scroll', role: 'region', tabIndex: 0, 'aria-label': t("当前模型进程表，可横向滚动") }}>
        <TableCaption className="sr-only">{t("模型进程明细；RSS 为主机内存，上下文及连接信息沿用设备实际报告。")}</TableCaption>
        <TableHeader><TableRow><TableHead scope="col" className="resource-process-model-column">{t("模型 / PID")}</TableHead><TableHead scope="col" className="resource-process-backend-column">{t("后端")}</TableHead><TableHead scope="col" className="resource-process-number">{t("主机 RSS")}</TableHead><TableHead scope="col" className="resource-process-number">{t("上下文")}</TableHead></TableRow></TableHeader>
        <TableBody>{sample.models.map(model => <TableRow key={model.pid}>
          <TableCell><div className="resource-process-identity"><span className="resource-process-icon"><Layers aria-hidden="true" /></span><div className="resource-process-name-wrap"><div className="resource-process-name-line"><strong className="resource-process-name">{model.name || 'N/A'}</strong>{model.mtp && <Badge variant="outline">MTP</Badge>}</div><span className="resource-process-meta">PID {model.pid}</span></div></div></TableCell>
          <TableCell className="resource-process-backend"><Badge variant="secondary">{uiText(model.backend || 'N/A')}</Badge><span className="resource-process-meta">{t("端口")}{model.port || 'N/A'}</span></TableCell>
          <TableCell className="resource-process-number">{gib(model.rss)}</TableCell><TableCell className="resource-process-number">{model.context || 'N/A'}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      <p className="resource-process-scroll-hint"><ArrowLeftRight aria-hidden="true" />{t("左右滑动查看完整表格")}</p>
    </> : <Empty className="resource-process-empty"><EmptyHeader><EmptyMedia variant="icon"><Layers aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("暂无可读取的模型进程")}</EmptyTitle><EmptyDescription>{t("当前未检测到可读取的 llama-server 进程，后续采样会自动更新。")}</EmptyDescription></EmptyHeader></Empty>}
  </ResourcePanel>;
}
