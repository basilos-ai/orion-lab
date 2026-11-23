import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { resolveLocale, getLocale, setLocale, subscribeLocale } from '../apps/console/src/lib/locale.ts';
import { t, uiText, errorText, diagnosticText, localizedLabels } from '../apps/console/src/lib/i18n.ts';
import { englishMessages } from '../apps/console/src/lib/messages.ts';
import { sessionTitle } from '../apps/console/src/lib/session-title.ts';

test('Locale preference accepts only supported values and gives explicit links precedence', () => {
  assert.equal(resolveLocale('en-US', 'zh-CN', 'zh-CN'), 'en-US');
  assert.equal(resolveLocale('invalid', 'zh-CN', 'en-GB'), 'zh-CN');
  assert.equal(resolveLocale(null, null, 'zh-TW'), 'zh-CN');
  assert.equal(resolveLocale(null, null, 'en-GB'), 'en-US');
  assert.equal(resolveLocale('<script>', {}, null), 'en-US');
});

test('Switching languages updates lazy labels and stored UI notices without changing interpolated filenames', () => {
  const labels = localizedLabels({ scope: '仅本地', model: 'Qwen3.5-2B · 后摩' });
  const filename = '中文合同{0}.docx';
  let updates = 0; const unsubscribe = subscribeLocale(() => updates++);
  try {
    setLocale('en-US');
    assert.equal(labels.scope, 'Local only'); assert.equal(labels.model, 'Qwen3.5-2B · Houmo');
    assert.equal(t('移除文件 {0}', [filename]), 'Remove file '+filename);
    const notice = t('正在加载 {0}，请等待就绪。', ['Qwen3.5-9B']);
    setLocale('zh-CN'); assert.equal(uiText(notice), '正在加载 Qwen3.5-9B，请等待就绪。');
    assert.equal(labels.scope, '仅本地'); assert.equal(updates, 2);
    setLocale('unsupported'); assert.equal(getLocale(), 'zh-CN');
  } finally { unsubscribe(); setLocale('zh-CN'); }
});

test('Transport errors and backend diagnostics are localized while retaining machine codes', () => {
  try {
    setLocale('en-US');
    assert.equal(errorText('设备会话未授权，请刷新。'), 'The device session is not authorized. Refresh the page.');
    assert.match(errorText('session_required'), /session has expired/);
    assert.match(errorText('未收录的后台错误', 'new_error_code'), /\(new_error_code\)$/);
    assert.match(errorText('Unrecognized service response', 'constructor'), /\(constructor\)$/);
    assert.equal(t('__proto__'), '__proto__');
    assert(!/[\p{Script=Han}]/u.test(errorText('未收录的后台错误', 'new_error_code')));
    assert.match(diagnosticText('hm_smi 查询失败（退出码 7）'), /exit code 7/);
    assert(!/[\p{Script=Han}]/u.test(diagnosticText('Qwen3.5-2B · 后摩判断为明确简单任务，使用轻量回答模型')));
    assert.equal(errorText('Failed to fetch'), 'Connection failed. Check your connection and retry.');
    assert.equal(errorText('backend warming up','model_unavailable'),'The selected model is not ready. Try again later.');
    assert.equal(errorText('请求失败 503','agent_unavailable'),'The conversation service is temporarily unavailable. Retry later.');
    assert.equal(errorText('Unexpected token','stream_protocol_error'),'The answer service returned an invalid response. Retry the request.');
    setLocale('zh-CN'); assert.equal(errorText('Failed to fetch'), '网络连接失败，请检查连接后重试。');
  } finally { setLocale('zh-CN'); }
});

test('Only generated conversation placeholders are localized; named and user-authored titles remain exact', () => {
  try {
    setLocale('en-US');
    assert.equal(sessionTitle({title:'新对话',messages:[]}), 'New chat');
    assert.equal(sessionTitle({title:'新对话',messages:[{role:'user',content:'My title'}]}), '新对话');
    assert.equal(sessionTitle({title:'我的项目讨论',messages:[]}), '我的项目讨论');
    assert.equal(sessionTitle({title:'受控请求',messages:[{excluded:true}]}), 'Protected request');
  } finally { setLocale('zh-CN'); }
});

test('Every translated message preserves its interpolation slots and English copy has no Chinese prose', () => {
  const slots = text => [...text.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
  for(const [source, english] of Object.entries(englishMessages)) {
    assert(english.trim(), source);
    assert.deepEqual(slots(english), slots(source), source);
    assert(!/[\p{Script=Han}]/u.test(english), source);
  }
});

test('Every literal translation call used by the console has an English catalog entry', () => {
  const root = path.resolve('apps/console/src'), missing = [];
  function walk(dir) { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name); if(entry.isDirectory())walk(file);else if(/\.tsx?$/.test(file)) {
      const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
      function visit(node) {
        if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&!Object.hasOwn(englishMessages,node.arguments[0].text)) missing.push(path.relative(root,file)+': '+node.arguments[0].text);
        ts.forEachChild(node,visit);
      }
      visit(source);
    }
  }}
  walk(root); assert.deepEqual(missing, []);
});
