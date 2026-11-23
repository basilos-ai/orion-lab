"""Shared read-only O6N telemetry. Adapted from O6N监控/RemoteProbe.py v1.1; no credentials or model control."""
import datetime
from collections import deque
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

INTERVAL = 1
ROOT = pathlib.Path('/proc')
HZ = os.sysconf('SC_CLK_TCK')
PAGE = os.sysconf('SC_PAGE_SIZE')
SMI_PERIOD = 0  # Card telemetry is manual-only; zero means no background interval.
SMI_MANUAL_COOLDOWN = 10
SMI_STATE = {}


def text(path, fallback=''):
    try:
        return pathlib.Path(path).read_text().strip()
    except (OSError, ValueError):
        return fallback


def number(path, fallback=None):
    try:
        return float(text(path))
    except ValueError:
        return fallback


def cpus():
    result = {}
    for line in text('/proc/stat').splitlines():
        a = line.split()
        if a and (a[0] == 'cpu' or a[0].startswith('cpu') and a[0][3:].isdigit()):
            result[a[0]] = [int(v) for v in a[1:9]]
    return result


def cpu_percent(old, new, key):
    if key not in old or key not in new:
        return None
    d = [b - a for a, b in zip(old[key], new[key])]
    total = sum(d)
    return round(max(0, min(100, (total - d[3] - d[4]) / total * 100)), 2) if total > 0 else None


def memory():
    return {line.split(':', 1)[0]: int(line.split(':', 1)[1].split()[0]) * 1024
            for line in text('/proc/meminfo').splitlines()}


def network():
    result = {}
    for line in text('/proc/net/dev').splitlines()[2:]:
        name, body = line.split(':', 1)
        name = name.strip()
        # Physical interfaces only: exclude loopback, Docker bridges and veth.
        if (pathlib.Path('/sys/class/net') / name / 'device').exists():
            a = body.split()
            result[name] = (int(a[0]), int(a[8]))
    return result


def diskio():
    device = os.stat('/').st_dev
    a = text('/sys/dev/block/%d:%d/stat' % (os.major(device), os.minor(device))).split()
    return (int(a[2]) * 512, int(a[6]) * 512) if len(a) >= 7 else None


def service():
    result = {}
    for p in ROOT.iterdir():
        if not p.name.isdigit() or text(p / 'comm') != 'llama-server':
            continue
        try:
            a = text(p / 'stat').rsplit(')', 1)[1].split()
            args = (p / 'cmdline').read_bytes().decode(errors='replace').split('\0')
            def option(*names):
                for i, arg in enumerate(args):
                    if arg in names and i + 1 < len(args):
                        return args[i + 1]
                    for name in names:
                        if arg.startswith(name + '='):
                            return arg.split('=', 1)[1]
                return ''
            model = option('-m', '--model')
            executable = str((p / 'exe').resolve())
            backend = '后摩 HLIE' if any(v in executable.lower() for v in ('houmo', 'hlie')) else 'CPU' if option('-ngl', '--gpu-layers', '--n-gpu-layers') == '0' else 'llama.cpp'
            result[p.name] = {'ticks': int(a[11]) + int(a[12]),
                              'rss': int(a[21]) * PAGE, 'start': a[19],
                              'pid': int(p.name), 'name': option('--alias', '-a') or pathlib.Path(model).name or 'llama-server',
                              'model_file': pathlib.Path(model).name, 'backend': backend,
                              'port': option('--port') or '8080', 'context': option('-c', '--ctx-size'),
                              'mtp': option('--spec-type') == 'draft-mtp'}
        except (OSError, IndexError, ValueError):
            pass
    return result


def scalar(value):
    match = re.search(r'[-+]?\d+(?:\.\d+)?', value or '')
    return float(match.group()) if match else None


def parse_smi(raw):
    """Whitelist telemetry only; omit card serial numbers and unrelated tool output."""
    starts = list(re.finditer(r'device\d+\s+detail infos', raw))
    cards = {}
    for i, start in enumerate(starts):
        block = raw[start.end(): starts[i + 1].start() if i + 1 < len(starts) else len(raw)]
        fields = dict(re.findall(r'^[ \t]*(\w+)[ \t]*:[ \t]*(.*?)[ \t]*$', block, re.MULTILINE))
        bdf = fields.get('BDF', '')
        if not bdf:
            continue
        total, free = scalar(fields.get('DDR_Memory_Total')), scalar(fields.get('DDR_Memory_Free'))
        core_temps = [scalar(v) for k, v in fields.items() if re.fullmatch(r'Core\d+', k)]
        ddr_temps = [scalar(v) for k, v in fields.items() if re.fullmatch(r'DDR\d+', k)]
        cores = sorted((k for k in fields if re.fullmatch(r'Core\d+_Util', k)), key=lambda k: int(re.search(r'\d+', k).group()))
        bandwidth = re.search(r'([\d.]+\s+GT/s)\s+x\s*(\d+)', fields.get('Cur_BandWidth', ''))
        cards[bdf] = {'model': fields.get('Model', ''),
                      'link': bandwidth.group(1) if bandwidth else '',
                      'width': bandwidth.group(2) if bandwidth else '',
                      'driver_version': fields.get('Driver_Version', ''),
                      'firmware_version': fields.get('Firmware_Version', ''),
                      'ipu_load': scalar(fields.get('IPU_Load')),
                      'core_util': [scalar(fields[k]) for k in cores],
                      'average_util': scalar(fields.get('Average_Util')),
                      'frequency_mhz': scalar(fields.get('Cur_Ipu_Freq')),
                      'power_w': scalar(fields.get('Board_Power')),
                      # This SDK labels the binary MiB values as MB; runtime capacity confirms the unit.
                      'memory_total': total * 1048576 if total is not None else None,
                      'memory_free': free * 1048576 if free is not None else None,
                      'memory_used': (total - free) * 1048576 if total is not None and free is not None else None,
                      'core_temp': max((v for v in core_temps if v is not None), default=None),
                      'ddr_temp': max((v for v in ddr_temps if v is not None), default=None)}
    if not cards:
        raise ValueError('hm_smi 返回内容缺少设备指标')
    return cards


def houmo_devices():
    return [p for p in pathlib.Path('/sys/bus/pci/devices').glob('*')
            if text(p / 'vendor') == '0x1f6b' and text(p / 'device') == '0x0c00']


def runtime_state(device):
    # Reading this sysfs attribute does not resume the PCIe device.
    value = text(device / 'power/runtime_status')
    return 'suspended' if value in ('suspend', 'suspended') else value if value in ('active', 'resuming', 'suspending') else 'unknown'


def query_smi(device):
    ids = [text(p) for p in device.glob('xh2a_ipu/*/device_id')]
    if len(ids) != 1 or not re.fullmatch(r'(?:0x[0-9a-fA-F]+|\d+)', ids[0]):
        raise RuntimeError('无法识别后摩设备编号，已跳过遥测查询')
    device_id = str(int(ids[0], 16 if ids[0].startswith('0x') else 10))
    tool = shutil.which('hm_smi')
    if not tool:
        raise RuntimeError('未找到 hm_smi')
    # Only the explicit manual-read path calls this targeted query.
    command = [tool, '-a', '-d', device_id]
    if shutil.which('taskset'):
        little = sorted({2, 3, 4, 5} & os.sched_getaffinity(0))
        if little:
            command = ['taskset', '-c', ','.join(map(str, little))] + command
    query = subprocess.run(command, capture_output=True, text=True, timeout=4)
    if query.returncode:
        raise RuntimeError('hm_smi 查询失败（退出码 %d）' % query.returncode)
    cards = parse_smi(query.stdout)
    if device.name not in cards:
        raise RuntimeError('hm_smi 返回设备与 PCIe 地址不匹配')
    return cards[device.name]


class CardSnapshotReader:
    """Only an explicit manual request can create or update a card snapshot."""
    def __init__(self):
        self.samples = {}
        self.manual_reads = {}

    def read_once(self, device):
        now = time.monotonic()
        if now - self.manual_reads.get(device.name, -float('inf')) < SMI_MANUAL_COOLDOWN:
            raise BlockingIOError('刚完成一次读取，请稍后再试。')
        self.manual_reads[device.name] = now
        previous = self.samples.get(device.name, {})
        try:
            values = query_smi(device)
            if values is None:
                raise RuntimeError('未取得卡载读数')
            self.samples[device.name] = {'values': values, 'error': '',
                'manual': True, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'monotonic': time.monotonic()}
        except Exception:
            self.samples[device.name] = {**previous, 'error': '单次读取失败，请稍后重试。'}
            raise RuntimeError('单次读取失败，请稍后重试。') from None


def accelerators():
    gpu = []
    for p in sorted(pathlib.Path('/sys/class/drm').glob('card[0-9]*')):
        if '-' in p.name:
            continue
        d = p / 'device'
        driver = (d / 'driver').resolve().name if (d / 'driver').exists() else ''
        gpu.append({'name': p.name, 'driver': driver,
                    'busy': number(d / 'gpu_busy_percent'),
                    'vram_used': number(d / 'mem_info_vram_used'),
                    'vram_total': number(d / 'mem_info_vram_total')})
    hm = []
    smi = SMI_STATE
    for p in houmo_devices():
        cached = smi.get(p.name, {})
        age = max(0, time.monotonic() - cached['monotonic']) if cached.get('monotonic') is not None else None
        power = runtime_state(p)
        valid_for = 6
        card = {'bdf': p.name, 'driver': (p / 'driver').resolve().name if (p / 'driver').exists() else '',
                'power_state': power, 'smi_mode': 'manual', 'smi_interval': SMI_PERIOD, 'smi_valid_for': valid_for,
                'smi_manual': bool(cached.get('manual')),
                'smi_ok': power == 'active' and bool(cached.get('values')) and not cached.get('error') and age is not None and age < valid_for,
                'smi_age': age, 'smi_sample_at': cached.get('at'), 'smi_error': cached.get('error', '')}
        # Last readings are explicitly historical when suspended, never an invented zero.
        if cached.get('values'):
            card.update(cached['values'])
        hm.append(card)
    npu = []
    for p in pathlib.Path('/sys/class/devfreq').glob('*'):
        uevent = text(p / 'device/uevent')
        if 'armchina' in uevent or 'aipu' in uevent:
            npu.append({'name': p.name, 'frequency': number(p / 'cur_freq')})
    return {'gpu': gpu, 'houmo': hm, 'npu': npu, 'smi_mode': 'manual', 'smi_interval': SMI_PERIOD,
            'aipu_loaded': pathlib.Path('/sys/module/aipu').exists()}


def baseline():
    return cpus(), network(), diskio(), service(), time.monotonic()


def collect(before):
    old_cpu, old_net, old_io, old_service, previous = before
    now = time.monotonic()
    dt = max(0.001, now - previous)
    new_cpu, new_net, new_io, new_service = cpus(), network(), diskio(), service()
    m, disk = memory(), os.statvfs('/')
    core_ids = sorted((k for k in new_cpu if k != 'cpu'), key=lambda k: int(k[3:]))
    temperatures = []
    for p in sorted(pathlib.Path('/sys/class/thermal').glob('thermal_zone*')):
        value = number(p / 'temp')
        if value is not None:
            temperatures.append({'name': p.name, 'type': text(p / 'type'), 'value': value / 1000})
    model_cpu = 0.0
    for pid, value in new_service.items():
        prior = old_service.get(pid)
        if prior and value['start'] == prior['start']:
            model_cpu += max(0, value['ticks'] - prior['ticks']) / HZ / dt * 100 / max(1, len(core_ids))
    docker = [value for p in pathlib.Path('/sys/fs/cgroup/system.slice').glob('docker-*.scope')
              if (value := number(p / 'memory.current')) is not None]
    data = {
        'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'host': socket.gethostname(), 'kernel': os.uname().release, 'interval': dt,
        'cpu': cpu_percent(old_cpu, new_cpu, 'cpu'),
        'cores': [cpu_percent(old_cpu, new_cpu, key) for key in core_ids],
        'core_ids': [int(key[3:]) for key in core_ids],
        'frequencies': [number('/sys/devices/system/cpu/%s/cpufreq/scaling_cur_freq' % key) for key in core_ids],
        'ram_total': m.get('MemTotal'), 'ram_available': m.get('MemAvailable'),
        'swap_total': m.get('SwapTotal'), 'swap_free': m.get('SwapFree'),
        'disk_total': disk.f_blocks * disk.f_frsize,
        'disk_used': (disk.f_blocks - disk.f_bfree) * disk.f_frsize,
        'disk_available': disk.f_bavail * disk.f_frsize,
        'read_bps': max(0, new_io[0] - old_io[0]) / dt if new_io and old_io else None,
        'write_bps': max(0, new_io[1] - old_io[1]) / dt if new_io and old_io else None,
        'rx_bps': sum(max(0, v[0] - old_net[n][0]) for n, v in new_net.items() if n in old_net) / dt,
        'tx_bps': sum(max(0, v[1] - old_net[n][1]) for n, v in new_net.items() if n in old_net) / dt,
        'net_interfaces': sorted(new_net), 'temperatures': temperatures,
        'loadavg': text('/proc/loadavg').split()[:3],
        'uptime': float(text('/proc/uptime', '0 0').split()[0]),
        'model_processes': len(new_service), 'model_rss': sum(v['rss'] for v in new_service.values()),
        'models': [{k: v for k, v in info.items() if k not in ('ticks', 'start')} for info in new_service.values()],
        'model_cpu': round(model_cpu, 2), 'docker_count': len(docker), 'docker_memory': sum(docker),
        'accelerators': accelerators(),
    }
    return data, (new_cpu, new_net, new_io, new_service, now)


class ResourceMonitor:
    """One shared sampler per server; no new sampler for each visitor or request."""
    def __init__(self, idle_seconds=15):
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.idle_seconds = idle_seconds
        self.last_interest = 0
        self.last_valid = None
        self.sample = None
        self.history = deque(maxlen=60)
        self.error = ''
        self.started = False
        self.card_reader = CardSnapshotReader()
        self.smi_lock = threading.Lock()

    def read_card_once(self, bdf):
        global SMI_STATE
        if not isinstance(bdf, str) or not re.fullmatch(r'[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]', bdf):
            raise ValueError('设备地址格式无效。')
        device = next((p for p in houmo_devices() if p.name == bdf), None)
        if device is None:
            raise LookupError('未找到指定的后摩设备。')
        if not self.smi_lock.acquire(blocking=False):
            raise BlockingIOError('卡载指标正在采样，请稍后再试。')
        try:
            self.card_reader.read_once(device)
        finally:
            SMI_STATE = dict(self.card_reader.samples)
            self.smi_lock.release()
        with self.lock:
            if self.sample:
                self.sample = {**self.sample, 'accelerators': accelerators()}
        return self.get()

    def interested(self):
        return time.monotonic() - self.last_interest < self.idle_seconds

    def get(self):
        with self.lock:
            self.last_interest = time.monotonic()
            if not self.started:
                self.started = True
                threading.Thread(target=self._run, daemon=True, name='O6N resource sampler').start()
            age = None if self.last_valid is None else max(0, time.monotonic() - self.last_valid)
            status = 'warming' if self.sample is None and not self.error else 'stale' if self.error or age is None or age > 4 else 'live'
            return {'status': status, 'sample': self.sample, 'history': list(self.history),
                    'age_seconds': age, 'error': self.error, 'sample_interval': INTERVAL,
                    'smi_interval': SMI_PERIOD, 'smi_mode': 'manual', 'idle_seconds': self.idle_seconds}

    def _run(self):
        previous = None
        while not self.stop.is_set():
            if not self.interested():
                previous = None
                self.stop.wait(0.5)
                continue
            try:
                if previous is None:
                    previous = baseline()
                else:
                    data, previous = collect(previous)
                    with self.lock:
                        # A manual read may finish while host collection is in flight.
                        data['accelerators'] = accelerators()
                        self.sample = data
                        self.last_valid = time.monotonic()
                        self.error = ''
                        self.history.append({'timestamp': data['timestamp'], 'cpu': data['cpu'],
                                             'ram_available': data['ram_available'],
                                             'temperature': max((item['value'] for item in data['temperatures']), default=None)})
            except Exception:
                previous = None
                with self.lock:
                    self.error = '系统指标采集失败，请稍后重试。'
            self.stop.wait(INTERVAL)


