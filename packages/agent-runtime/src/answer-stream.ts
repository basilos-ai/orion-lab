import { safeText } from '@orion/tool-runner';

/** Keep credential prefixes across token boundaries out of visible deltas. */
export class AnswerStream {
  private value = ''; private sent = 0;
  append(delta: string): string {
    this.value += delta; safeText(this.value);
    // Enough look-behind for the protected token / assignment patterns.
    let end = Math.max(this.sent, this.value.length - 32);
    if (end > 0 && /[\uD800-\uDBFF]/.test(this.value[end - 1])) end--;
    const text = this.value.slice(this.sent, end); this.sent = end; return text;
  }
  finish(text: string): string {
    safeText(text);
    if (!text.startsWith(this.value)) throw new Error('model_stream_invalid');
    const tail = text.slice(this.sent); this.value = text; this.sent = text.length; return tail;
  }
}

/** Fixed synthetic candidates exercise the production checker; no caller content or model. */
export function outputProtectionSelfTest() {
  const safe = '这是一段不含凭据的合成输出。';
  const normal = new AnswerStream();
  const safePassed = normal.append(safe) + normal.finish(safe) === safe;
  const guarded = new AnswerStream(); let visible = '', blocked = false;
  try {
    visible += guarded.append('api_');
    visible += guarded.append('key=ORION_DEMO_NOT_A_REAL_CREDENTIAL');
  } catch (error) { blocked = error instanceof Error && error.message === 'sensitive_tool_content'; }
  return { kind: 'synthetic_output_self_test' as const, checker: 'project_sensitive_patterns_v1', model_called: false as const, semantic_review: false as const, scope: 'project_output' as const, safe_passed: safePassed, blocked, sensitive_visible: visible.length > 0, passed: safePassed && blocked && !visible, tested_at: new Date().toISOString() };
}
