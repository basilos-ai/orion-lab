import { t } from '@/lib/i18n';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/common';
import type { Health, Mode, Scope } from '@/lib/types';
import { names } from './use-chat';

export function PrivacyNotice({ scope, mode, health, hasImages }: { scope: Scope; mode: Mode; health: Health | null; hasImages: boolean }) {
  const [open, setOpen] = useState(false);
  const cloudPossible = scope === 'hybrid' && (mode === 'auto' || mode === 'cloud') && !hasImages;
  const incompatible = mode === 'cloud' && scope === 'local' || hasImages && !['auto', 'standard', 'vision'].includes(mode);
  const destination = incompatible ? t("调整调用设置后再发送") : mode === 'cloud' ? t("DeepSeek → 浏览器") : cloudPossible ? t("本地回答模型 / 获准使用的 DeepSeek → 浏览器") : t("本地回答模型 → 浏览器");
  const reviewStatus = health ? health.guard_ready ? t("输入审核服务已连接") : t("输入审核服务未就绪，审核未完成时停止调用回答模型") : t("输入审核服务状态尚未确认");
  return <>
    <Button type="button" variant="ghost" size="sm" className="privacy-notice-button" aria-label={t("隐私与安全")} aria-haspopup="dialog" aria-expanded={open} title={t("查看保护规则与数据流向")} onClick={() => setOpen(true)}><ShieldCheck aria-hidden="true" /><span>{t("隐私与安全")}</span></Button>
    <Modal open={open} onOpenChange={setOpen} title={t("隐私与安全")} description={t("当前系统的保护规则与数据流向。查看说明不会发送对话或调用模型。")} className="privacy-notice-dialog" contentLabel={t("保护规则与数据流向")} footer={<Button variant="outline" onClick={() => setOpen(false)}>{t("知道了")}</Button>}>
      <section className="privacy-current" aria-label={t("当前调用设置")}>
        <h3>{t("当前调用设置")}</h3>
        <dl><div><dt>{t("调用范围")}</dt><dd>{scope === 'local' ? t("仅本地") : t("允许云端")}</dd></div><div><dt>{t("回答模型")}</dt><dd>{names[mode]}</dd></div></dl>
        <p>{incompatible ? t("当前回答模型与调用范围或图片上下文不兼容，发送已暂停。仅本地禁止云端回答，图片需使用 Auto、本地 9B 或 MiniCPM-V；请在模型菜单调整后再发送。") : scope === 'local' ? t("服务端禁止调用云端回答模型；问题仍会发送到运行 Orion Lab 的设备，并经过该设备的网关和安全检查。") : mode === 'cloud' ? t("当前指定 DeepSeek 云端回答。经审核的问题、必要历史和任务相关内容会发送至 DeepSeek，按量计费。") : cloudPossible ? t("当前设置允许使用 DeepSeek。Auto 可选择本地或云端回答；选择云端后，经审核的问题、必要历史和任务相关内容可能发往 DeepSeek，按量计费。") : t("调用范围允许云端；当前图片对话或指定的本地模型使用本地回答。后续切换 Auto 或 DeepSeek 的文本任务时，可能使用云端。")}</p>
        <p className="privacy-status">{reviewStatus}</p>
      </section>
      <section aria-labelledby="privacy-flow-title"><h3 id="privacy-flow-title">{t("内容会经过哪里")}</h3>
        <ol className="privacy-flow">
          <li><strong>{t("浏览器 → 当前设备")}</strong><p>{t("发送问题、必要对话历史及本轮提供的内容。这里的“本地”指运行 Orion Lab 的设备；Auto 的任务判断也在该设备上完成。")}</p></li>
          <li><strong>{t("设备上的 AI Gateway → 输入审核")}</strong><p>{t("规则检查常见 API Key、密码、私钥、部分个人信息与明确标记的机密内容，本地安全模型进一步判断有害内容。命中规则或审核无法完成时，停止调用回答模型。")}</p></li>
          <li><strong>{destination}</strong><p>{incompatible ? t("设置不兼容时不会调用回答模型；完成调整后才可发送。") : mode === 'cloud' ? t("输入审核通过后，使用指定的 DeepSeek 回答并将结果返回浏览器。") : cloudPossible ? t("仅在允许云端且选择了云端回答时，将审核通过的内容发送给 DeepSeek；其余任务使用本地回答模型。") : t("当前内容使用本地回答模型。仅本地范围下，服务端也会拒绝手动指定云端。")}</p></li>
        </ol>
      </section>
      <section><h3>{t("图片、文档与项目文件")}</h3><p>{t("PDF、DOCX 在设备上提取文字，由规则及本地审核模型检查。扫描页和文档图片不做文字识别；审核通过仅指提取到的文字。原文件提取后删除，待审核文字暂存设备内存，通过检查的文字可在设备私有区保留最多24小时。允许云端且实际使用云端回答时，必要的文档文字也可能发送给 DeepSeek。文档问答不执行项目工具。")}</p><p>{t("图片在设备上检查并由本地视觉模型处理，不发送至云端回答模型。项目任务可读取获授权项目内的文件；任务所需的文件片段和工具结果，在允许云端且选择云端回答时，也可能经审核后发送至 DeepSeek。")}</p><p>{t("项目工具默认只读。写入和运行检查需要逐项确认，确认绑定具体操作、参数和文件版本。工具执行前后均有检查；执行后的检查不能撤销已经完成的写入。")}</p></section>
      <section><h3>{t("内容保存在哪里")}</h3><p>{t("已保存的会话保留在浏览器存储，完成的对话和项目任务记录也会保存在设备服务端。运行与审核记录可能包含通过检查的内容、回答及工具结果，因此“仅本地”也不代表不留记录。")}</p><p>{t("回答模型和调用范围作为浏览器偏好保存，不包含问题正文。未发送草稿和用于重试的被阻断原文只暂存在当前页面内存；任一会话有未发送内容时，刷新或离开会提示，取消离开可继续编辑，确认离开后草稿无法恢复。本应用不把被阻断原文保存为后续对话上下文。网关请求日志的记录内容和保存期限由其配置决定。")}</p></section>
      <section><h3>{t("当前保护边界")}</h3><p>{t("规则和模型无法识别所有敏感信息，输入前仍需移除真实凭据及不必要的个人信息。项目任务的回答和工具结果会检查凭据等敏感模式；普通聊天未启用输出审核，项目任务也未启用完整的语义输出审核，模型回答不代表已经通过全面安全审查。发往 DeepSeek 的内容还受其服务规则约束，本页不承诺云端零留存。")}</p></section>
    </Modal>
  </>;
}
