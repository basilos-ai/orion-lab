import { t } from '@/lib/i18n';
import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@orion/harness-ui/ui/card';
import { RadioGroup, RadioGroupItem } from '@orion/harness-ui/ui/radio-group';
import { Button } from './ui/button';
import type { Appearance } from '@/lib/appearance';
import { LanguagePicker } from './language-picker';

type Theme = 'light' | 'dark' | 'system';
export function AppearanceSettings({ theme, onThemeChange, appearance, onAppearanceChange }: {
  theme: Theme; onThemeChange: (theme: Theme) => void; appearance: Appearance; onAppearanceChange: (value: Appearance) => void;
}) {
  const id = useId();
  return <Card className="appearance-card" data-appearance-settings>
    <CardHeader><CardTitle>{t("界面设置")}</CardTitle><CardDescription>{t("选择界面语言、主题、强调色与信息密度，即时生效。")}</CardDescription></CardHeader>
    <CardContent className="appearance-options">
      <LanguagePicker />
      <fieldset><legend>{t("主题")}</legend><RadioGroup value={theme} onValueChange={value => onThemeChange(value as Theme)} aria-label={t("界面主题")} className="appearance-theme-grid">
        {([{ value: 'light', label: t("亮色"), Icon: Sun }, { value: 'dark', label: t("暗色"), Icon: Moon }, { value: 'system', label: t("系统"), Icon: Monitor }] as const).map(({ value, label, Icon }) => <label className="appearance-choice" htmlFor={id + value} key={value}>
          <span className={'theme-preview theme-preview-' + value} aria-hidden="true"><i /><span><b /><em /><em /></span></span>
          <span className="appearance-choice-label"><Icon aria-hidden="true" /><span>{label}</span><RadioGroupItem value={value} id={id + value} /></span>
        </label>)}
      </RadioGroup></fieldset>
      <fieldset><legend>{t("主题色")}</legend><RadioGroup value={appearance.accent} onValueChange={value => onAppearanceChange({ ...appearance, accent: value as Appearance['accent'] })} aria-label={t("主题色")} className="appearance-accent-grid">
        {([{ value: 'neutral', label: t("中性") }, { value: 'orange', label: t("品牌橙") }, { value: 'blue', label: t("蓝色") }] as const).map(({ value, label }) => <label className="appearance-choice appearance-choice-inline" key={value} htmlFor={id + value}><span className={'accent-swatch accent-' + value} aria-hidden="true" /><span>{label}</span><RadioGroupItem value={value} id={id + value} /></label>)}
      </RadioGroup></fieldset>
      <fieldset><legend>{t("信息密度")}</legend><RadioGroup value={appearance.density} onValueChange={value => onAppearanceChange({ ...appearance, density: value as Appearance['density'] })} aria-label={t("信息密度")} className="appearance-density-grid">
        {([{ value: 'comfortable', label: t("舒适") }, { value: 'compact', label: t("紧凑") }] as const).map(({ value, label }) => <label className="appearance-choice" key={value} htmlFor={id + value}><span className={'density-preview density-' + value} aria-hidden="true"><i /><i /><i /></span><span className="appearance-choice-label"><span>{label}</span><RadioGroupItem value={value} id={id + value} /></span></label>)}
      </RadioGroup></fieldset>
    </CardContent>
    <CardFooter className="appearance-footer"><p>{t("外观设置会保存在当前浏览器，主题色不改变成功、警告和错误的含义。")}</p><Button variant="outline" size="sm" disabled={appearance.accent === 'neutral' && appearance.density === 'comfortable'} onClick={() => onAppearanceChange({ accent: 'neutral', density: 'comfortable' })}>{t("重置外观")}</Button></CardFooter>
  </Card>;
}
