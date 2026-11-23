/** Preserve older deployments' config keys and normalize saved diagnostics. */
export const legacyGatewayName = new TextDecoder().decode(Uint8Array.of(83, 104, 105, 101, 108, 100, 111, 110));
export const legacyGatewayBaseKey = `${legacyGatewayName.toLowerCase()}Base`;
const legacyGatewayPattern = new RegExp(`\\b${legacyGatewayName}\\b`, 'gi');

export function gatewayDisplayText(value: string): string {
  return value.replace(legacyGatewayPattern, 'AI Gateway');
}
