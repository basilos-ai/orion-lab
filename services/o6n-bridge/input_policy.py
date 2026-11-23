"""Versioned deterministic input checks. No matched values are returned."""
import re
VERSION='input-policy-20261019.1'
PLACEHOLDERS={'example','password','your_password','your_api_key','changeme','redacted','你的密码','示例密码'}
def check(text):
 patterns=[('credential','api_key',r'\b(?:sk|ghp|github_pat|AKIA)[-_][A-Za-z0-9_-]{20,}\b'),('credential','private_key',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),('credential','bearer_token',r'(?i)\bbearer\s+[A-Za-z0-9._~-]{24,}'),('confidential','marked_confidential',r'(?i)(?:\bCONFIDENTIAL\b|公司机密|商业秘密|内部绝密)\s*[:：]'),('privacy','labelled_phone',r'(?:本人手机号|私人手机号|手机号码|手机号)\s*[:：=]\s*1[3-9]\d{9}'),('privacy','private_contact',r'(?:私人邮箱|家庭住址|医疗病历|个人病历)\s*[:：=]\s*\S{5,}')]
 for category,rule,pattern in patterns:
  if re.search(pattern,text):return {'blocked':True,'category':category,'rule':rule,'reason_code':rule}
 for m in re.finditer(r'(?i)(?:password|passwd|api[_ -]?key|access[_ -]?token|密码)\s*[=:：]\s*[\"\']?([^\s\"\'<>]{6,})',text):
  if m[1].lower() not in PLACEHOLDERS and not m[1].startswith(('示例','已脱敏')):return {'blocked':True,'category':'credential','rule':'labelled_secret','reason_code':'labelled_secret'}
 for m in re.finditer(r'(?<!\d)(\d{17}[\dXx])(?!\d)',text):
  v=m[1].upper();weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
  if '10X98765432'[sum(int(a)*b for a,b in zip(v[:17],weights))%11]==v[-1]:return {'blocked':True,'category':'privacy','rule':'identity_number','reason_code':'identity_number'}
 for m in re.finditer(r'(?:银行卡|银行账号|card_number)\s*[:：=]\s*([0-9 -]{13,30})',text):
  nums=re.sub(r'\D','',m[1])
  if 13<=len(nums)<=19:
   digits=list(map(int,nums[::-1]));total=sum(d if i%2==0 else d*2-9 if d*2>9 else d*2 for i,d in enumerate(digits))
   if total%10==0:return {'blocked':True,'category':'privacy','rule':'payment_card','reason_code':'payment_card'}
 return {'blocked':False,'category':None,'rule':None,'reason_code':'deterministic_passed'}

def redact(text):
 text=re.sub(r'\b(?:sk|ghp|github_pat|AKIA)[-_][A-Za-z0-9_-]{12,}\b','[凭据已隐藏]',str(text))
 text=re.sub(r'(?i)((?:password|passwd|api[_ -]?key|access[_ -]?token|密码)\s*[=:：]\s*)\S+',r'\1[已隐藏]',text)
 return text[:1600]
