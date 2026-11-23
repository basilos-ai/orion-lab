import { useId } from 'react';
import { t } from '@/lib/i18n';
import { setLocale, type Locale } from '@/lib/locale';
import { useLocale } from '@/lib/use-locale';
import { RadioGroup, RadioGroupItem } from '@orion/harness-ui/ui/radio-group';

export function LanguagePicker() {
  const locale = useLocale();
  const id = useId();
  return <fieldset data-language-settings><legend>{t("界面语言")}</legend><RadioGroup aria-label={t("界面语言")} className="appearance-language-grid" value={locale} onValueChange={value => setLocale(value as Locale)}>
    {([{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: 'English' }] as const).map(({ value, label }) => <label className="appearance-choice appearance-choice-inline" htmlFor={id + value} key={value}><span>{label}</span><RadioGroupItem value={value} id={id + value} /></label>)}
  </RadioGroup></fieldset>;
}
