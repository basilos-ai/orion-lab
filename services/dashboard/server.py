"""Read-only LAN dashboard. Only the curated public directory is served."""
import argparse,http.server,json,pathlib,subprocess,threading,time,urllib.parse,os
from resource_probe import ResourceMonitor
ROOT=pathlib.Path(__file__).resolve().parent
PUBLIC_HOST=os.environ.get('O6N_PUBLIC_HOST','127.0.0.1')
SERVICES={
 'o6n-smart-chat':('Laya 智能选模聊天',17790),
 'qwen35-9b-houmo':('Qwen3.5-9B · 后摩',17777),
 'qwen35-9b-cpu':('Qwen3.5-9B · CPU',17772),
 'qwen38-27b-mtp':('Qwen3.8-27B-MTP · 后摩',17767),
 'qwen38-27b':('Qwen3.8-27B · CPU',17762),
 'k2-horizon-7b':('K2-Horizon-7B · CPU',17757),
 'minicpm5-2b':('MiniCPM5-2B · CPU',17752),
 'minicpm47':('MiniCPM-V 4.7 1B · CPU',17747),
 'laya-multilingual':('Laya Multilingual · CPU决策',17785)}
cache={'at':0,'data':None};lock=threading.Lock()
resources=ResourceMonitor()
def model_status():
    with lock:
        if cache['data'] is not None and time.monotonic()-cache['at']<5:return cache['data']
        services={}
        for key,(name,port) in SERVICES.items():
            try:p=subprocess.run(['systemctl','--user','is-active','--quiet',key+'.service'],capture_output=True,timeout=3);active=p.returncode==0
            except (OSError,subprocess.TimeoutExpired):active=False
            services[key]={'name':name,'url':f'http://{PUBLIC_HOST}:{port}/','active':active}
        data={'services':services};cache.update(at=time.monotonic(),data=data);return data
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'current'),**kwargs)
    def list_directory(self,path):self.send_error(404);return None
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        super().end_headers()
    def guess_type(self,path):
        kind=super().guess_type(path)
        return kind+'; charset=utf-8' if kind.startswith('text/') or kind in ('application/javascript','application/json') else kind
    def json_response(self, status, data):
        payload=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path!='/api/resources/card-sample':
            self.json_response(404,{'error':'接口不存在。'});return
        origin=self.headers.get('Origin')
        if origin:
            parsed=urllib.parse.urlsplit(origin)
            if parsed.scheme not in ('http','https') or parsed.netloc.lower()!=self.headers.get('Host','').lower():
                self.json_response(403,{'error':'仅支持从当前监控页面读取。'});return
        if self.headers.get('Sec-Fetch-Site')=='cross-site':
            self.json_response(403,{'error':'仅支持从当前监控页面读取。'});return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=1024 or self.headers.get('Content-Type','').split(';')[0].strip()!='application/json':
                raise ValueError('请求格式无效。')
            body=json.loads(self.rfile.read(length))
            if not isinstance(body,dict) or set(body)!={'bdf'}:raise ValueError('只接受设备地址。')
            result=resources.read_card_once(body['bdf'])
        except (ValueError,UnicodeError):self.json_response(400,{'error':'设备地址或请求格式无效。'})
        except LookupError:self.json_response(404,{'error':'未找到指定的后摩设备。'})
        except BlockingIOError as exc:self.json_response(409,{'error':str(exc)})
        except Exception:self.json_response(502,{'error':'单次读取失败，请稍后重试。'})
        else:self.json_response(200,result)
    def do_GET(self):
        path=urllib.parse.urlsplit(self.path).path
        if path in ('/api/status','/api/health','/api/resources'):
            payload=json.dumps(resources.get() if path=='/api/resources' else model_status() if path=='/api/status' else {'status':'ok'},ensure_ascii=False,allow_nan=False).encode()
            self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
        super().do_GET()
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=17780);args=ap.parse_args()
    http.server.ThreadingHTTPServer(('0.0.0.0',args.port),Handler).serve_forever()
