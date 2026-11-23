import { t } from '@/lib/i18n';
/** Direct use of the user-approved Harness PromptInput source package. */
import { ArrowUp } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import {
  PromptInput as HarnessPromptInput, PromptInputBody, PromptInputFooter,
  PromptInputHeader, PromptInputSubmit, PromptInputTextarea,
} from '@orion/harness-ui/ai/prompt-input';

export function PromptInput({ value, onChange, onSubmit, submitDisabled, disabledReason, loading, inputRef, placeholder, header, footer, onUnsupportedFiles, onImageFiles, onStop, cancelPending }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  submitDisabled: boolean; disabledReason?: string; loading: boolean; inputRef: Ref<HTMLTextAreaElement>;
  placeholder: string; header?: ReactNode; footer: (action: ReactNode) => ReactNode;
  onUnsupportedFiles: () => void; onImageFiles?: (files:FileList)=>void; onStop: () => void; cancelPending: boolean;
}) {
  return <HarnessPromptInput className="harness-composer" data-slot="prompt-input"
    clearOnSubmit={false} maxFiles={0} accept="application/x-orion-disabled" onError={onUnsupportedFiles}
    onSubmit={()=>{ if (!submitDisabled && !loading) onSubmit(); }}>
    {header&&<PromptInputHeader className="harness-context">{header}</PromptInputHeader>}
    <PromptInputBody>
      <label className="sr-only" htmlFor="prompt">{t("输入问题")}</label>
      <PromptInputTextarea id="prompt" ref={inputRef} value={value} onChange={event=>onChange(event.target.value)}
        className="harness-textarea" maxLength={16000} rows={2} placeholder={placeholder} aria-describedby={disabledReason?'composer-guidance':undefined}
        onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||loading&&!event.shiftKey))event.preventDefault();}}
        onPaste={event=>{if(event.clipboardData.files.length){event.preventDefault();event.stopPropagation();if(onImageFiles)onImageFiles(event.clipboardData.files);else onUnsupportedFiles();}}}/>
    </PromptInputBody>
    <PromptInputFooter className="harness-footer">{footer(
      <PromptInputSubmit status={loading?'streaming':'ready'} onStop={onStop}
        id={loading?'stop':'send'} aria-label={loading?t("停止回答"):t("发送消息")}
        title={loading?t("停止回答"):disabledReason||(!value.trim()?t("输入消息后发送"):t("发送消息 · Enter"))} disabled={loading?cancelPending:submitDisabled}
        className="harness-send">{loading?undefined:<ArrowUp/>}</PromptInputSubmit>
    )}</PromptInputFooter>
  </HarnessPromptInput>;
}
