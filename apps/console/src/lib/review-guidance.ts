import { t } from './i18n.ts';
import type { RequestError } from './types';

// Display only our own copy: neither model explanations nor matched sensitive values.
const risks = {
  credential: ['密码或密钥', '文档文字中检测到疑似密码、密钥、令牌或私钥。', '删除相关值或替换为脱敏占位符后重新上传。'],
  privacy: ['个人隐私', '文档文字中检测到疑似非公开个人资料，例如病历、身份证、银行卡或私人联系方式。', '删除或脱敏个人资料，并确认具有使用权限后重试。'],
  confidential: ['商业机密', '文档文字中检测到疑似非公开商业资料或保密标记。', '移除保密内容，或改用已公开、已授权的资料。'],
  sexual: ['成人色情内容', '文档文字中检测到疑似露骨色情内容或色情招揽推广。', '移除相关内容后重新上传。'],
  violence: ['暴力或威胁', '文档文字中检测到疑似暴力煽动、威胁恐吓或暴力动员。', '移除威胁、煽动和行动指令后重试。'],
  illicit: ['违法或危险行为指导', '文档文字中检测到疑似可执行的违法或危险行为指导。', '移除具体操作步骤，保留必要的客观背景后重试。'],
  injection: ['审核指令注入', '文档文字中检测到要求忽略审核规则或伪造放行结果的指令。', '删除对审核器的指令，改为客观描述需要分析的内容。'],
  sensitive: ['风险类别未明确', '文档未通过输入审核，当前回执未提供具体风险类别。', '检查文档内容后重试，或联系管理员核实。'],
} as const;
type Risk = keyof typeof risks;
const reasons: Record<string, Risk> = {
  document_credentials: 'credential', api_key: 'credential', private_key: 'credential', bearer_token: 'credential', labelled_secret: 'credential',
  document_privacy: 'privacy', identity_number: 'privacy', payment_card: 'privacy', labelled_phone: 'privacy', private_contact: 'privacy',
  document_confidential: 'confidential', marked_confidential: 'confidential', document_sexual: 'sexual', document_violence: 'violence',
  document_illicit: 'illicit', document_injection: 'injection', document_sensitive: 'sensitive',
};
// The closed risk catalog is checked separately for translation completeness.
function copy(risk: Risk) {
  const [label, reason, advice] = risks[risk];
  return { title: t('文档未通过审核：{0}', [t(label)]), reason: t(reason), advice: t(advice), stopped: t('本轮已停止，未调用回答模型。') };
}
export function documentReviewGuidance(error: RequestError) {
  if (!['input_blocked', 'review_unavailable'].includes(error.code)) return null;
  if (error.review_source !== 'document' && !error.reason_code?.startsWith('document_')) return null;
  if (error.code === 'review_unavailable') {
    const uncertain = error.reason_code === 'document_uncertain';
    const timeout = error.reason_code === 'document_review_timeout';
    return { title: t('文档审核未完成'),
      reason: uncertain ? t('本地审核暂时无法确定文档文字的风险，本轮已停止。') : timeout ? t('文档审核超时，本轮已停止。') : t('本地文档审核暂不可用，本轮已停止。'),
      advice: uncertain ? t('检查并简化文字内容后重试；系统不会自动放行。') : timeout ? t('减少单次文档数量或长度后重试。') : t('请稍后重试；若持续失败，请检查本地审核服务。'),
      stopped: t('本轮已停止，未调用回答模型。') };
  }
  const reason = error.reason_code || '', category = error.category || '';
  const risk = Object.hasOwn(reasons, reason) ? reasons[reason] : Object.hasOwn(risks, category) ? category as Risk : 'sensitive';
  return copy(risk);
}
export const documentRiskMessages = Object.values(risks).flat();
