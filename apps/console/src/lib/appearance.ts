export type Accent = 'neutral' | 'orange' | 'blue';
export type Density = 'comfortable' | 'compact';
export type Appearance = { accent: Accent; density: Density };
export const appearanceKey = 'basilos-ui:v2:appearance';
export const defaultAppearance: Appearance = { accent: 'neutral', density: 'comfortable' };
export function readAppearance(value: unknown): Appearance {
  const candidate = value && typeof value === 'object' ? value as Partial<Appearance> : {};
  return {
    accent: candidate.accent === 'orange' || candidate.accent === 'blue' ? candidate.accent : 'neutral',
    density: candidate.density === 'compact' ? 'compact' : 'comfortable',
  };
}
