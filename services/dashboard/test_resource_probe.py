"""Linux telemetry contract tests; run on O6N without starting model requests."""
import unittest
import pathlib
import tempfile
import threading
import json
import urllib.request
import urllib.error
import http.server
from types import SimpleNamespace
from unittest.mock import patch
import resource_probe as probe
import server as dashboard


class ResourceContracts(unittest.TestCase):
    def test_manual_snapshot_changes_only_on_another_explicit_read(self):
        sampler = probe.CardSnapshotReader()
        device = pathlib.Path('/synthetic/0000:91:00.0')
        with patch.object(probe.time, 'monotonic', return_value=100) as clock, patch.object(probe, 'runtime_state', return_value='active') as power, patch.object(probe, 'houmo_devices', return_value=[device]), patch.object(probe, 'query_smi', return_value={'core_temp':42,'ipu_load':0}) as query, patch.object(probe,'SMI_STATE',sampler.samples), patch.object(pathlib.Path,'glob',return_value=[]):
            sampler.read_once(device)
            query.assert_called_once_with(device)
            self.assertTrue(sampler.samples[device.name]['manual'])
            original_at=sampler.samples[device.name]['at']
            clock.return_value=108
            with self.assertRaises(BlockingIOError):sampler.read_once(device)
            for instant,state in [(110,'suspended'),(120,'active'),(1000,'active'),(1100,'suspended')]:
                clock.return_value=instant;power.return_value=state
                card=probe.accelerators()['houmo'][0]
                self.assertEqual(card['smi_sample_at'],original_at)
                self.assertEqual(card['core_temp'],42)
            query.assert_called_once()
            clock.return_value=1200;sampler.read_once(device)
            self.assertEqual(query.call_count,2)

    def test_manual_failure_has_no_retry_and_keeps_old_reading_historical(self):
        sampler=probe.CardSnapshotReader();device=pathlib.Path('/synthetic/0000:91:00.0')
        sampler.samples[device.name]={'values':{'core_temp':42},'at':'old','monotonic':80}
        with patch.object(probe.time,'monotonic',return_value=100),patch.object(probe,'runtime_state',return_value='active'),patch.object(probe,'query_smi',side_effect=RuntimeError('private details')) as query:
            with self.assertRaisesRegex(RuntimeError,'单次读取失败'):sampler.read_once(device)
            self.assertEqual(query.call_count,1)
            self.assertEqual(sampler.samples[device.name]['at'],'old')
            self.assertNotIn('private',sampler.samples[device.name]['error'])

    def test_manual_read_validates_detected_device_and_serializes_requests(self):
        monitor=probe.ResourceMonitor();device=pathlib.Path('/synthetic/0000:91:00.0')
        with patch.object(probe,'houmo_devices',return_value=[device]),patch.object(probe,'query_smi') as query:
            with self.assertRaises(ValueError):monitor.read_card_once('../../arbitrary')
            with self.assertRaises(LookupError):monitor.read_card_once('0000:92:00.0')
            monitor.smi_lock.acquire()
            try:
                with self.assertRaises(BlockingIOError):monitor.read_card_once(device.name)
            finally:monitor.smi_lock.release()
            query.assert_not_called()

    def test_host_card_status_never_queries_telemetry_in_any_power_state(self):
        device = pathlib.Path('/synthetic/0000:91:00.0')
        with patch.object(probe, 'houmo_devices', return_value=[device]), patch.object(probe, 'runtime_state') as power, patch.object(probe, 'query_smi') as query, patch.object(probe,'SMI_STATE',{}),patch.object(pathlib.Path,'glob',return_value=[]):
            for state in ['active', 'suspended', 'suspending', 'resuming', 'unknown']:
                power.return_value = state
                card=probe.accelerators()['houmo'][0]
                self.assertEqual(card['smi_mode'],'manual')
                self.assertEqual(card['smi_interval'],0)
                self.assertNotIn('core_temp',card)
            query.assert_not_called()

    def test_get_starts_only_one_host_thread_and_no_card_worker(self):
        monitor=probe.ResourceMonitor()
        with patch.object(probe.threading,'Thread') as thread,patch.object(probe,'query_smi') as query:
            monitor.get();monitor.get()
            thread.assert_called_once()
            self.assertEqual(thread.call_args.kwargs['target'],monitor._run)
            query.assert_not_called()

    def test_manual_query_updates_only_the_requested_card(self):
        monitor=probe.ResourceMonitor();monitor.started=True;monitor.sample={'timestamp':'synthetic'}
        active,sleeping=pathlib.Path('/synthetic/0000:91:00.0'),pathlib.Path('/synthetic/0000:92:00.0')
        with patch.object(probe,'houmo_devices',return_value=[active,sleeping]),patch.object(probe,'runtime_state',return_value='suspended'),patch.object(pathlib.Path,'glob',return_value=[]),patch.object(probe,'SMI_STATE',{}),patch.object(probe,'query_smi',return_value={'core_temp':42}) as query:
            result=monitor.read_card_once(active.name)
            query.assert_called_once_with(active)
            cards=result['sample']['accelerators']['houmo']
            self.assertEqual(cards[0]['core_temp'],42)
            self.assertNotIn('core_temp',cards[1])

    def test_manual_query_targets_device_and_never_changes_governor(self):
        with tempfile.TemporaryDirectory() as directory:
            device = pathlib.Path(directory) / '0000:91:00.0'
            identity = device / 'xh2a_ipu/xh2a_ipu0/device_id'
            identity.parent.mkdir(parents=True)
            identity.write_text('0')
            with patch.object(probe.shutil, 'which', side_effect=lambda name: '/bin/hm_smi' if name == 'hm_smi' else None), patch.object(probe, 'runtime_state', return_value='suspended') as power, patch.object(probe.subprocess, 'run') as run:
                run.return_value = SimpleNamespace(returncode=0, stdout='device0 detail infos\nBDF: 0000:91:00.0\nCore0: 42 C\n')
                self.assertEqual(probe.query_smi(device)['core_temp'], 42)
                self.assertEqual(run.call_args.args[0], ['/bin/hm_smi', '-a', '-d', '0'])
                run.assert_called_once()

    def test_sleeping_card_keeps_timestamped_history_without_live_claim(self):
        device = pathlib.Path('/synthetic/0000:91:00.0')
        cache = {device.name: {'values': {'core_temp': 90.3}, 'monotonic': 100, 'at': 'synthetic-time', 'interval': 15, 'error': ''}}
        with patch.object(probe, 'SMI_STATE', cache), patch.object(probe, 'houmo_devices', return_value=[device]), patch.object(probe, 'runtime_state', return_value='suspended'), patch.object(probe.time, 'monotonic', return_value=1000), patch.object(pathlib.Path, 'glob', return_value=[]):
            card = probe.accelerators()['houmo'][0]
            self.assertFalse(card['smi_ok'])
            self.assertEqual(card['power_state'], 'suspended')
            self.assertEqual(card['smi_age'], 900)
            self.assertEqual(card['smi_sample_at'], 'synthetic-time')
            self.assertEqual(card['core_temp'], 90.3)

    def test_cpu_delta_unknown_and_zero(self):
        self.assertIsNone(probe.cpu_percent({}, {}, 'cpu'))
        self.assertIsNone(probe.cpu_percent({'cpu': [0]*8}, {'cpu': [0]*8}, 'cpu'))
        self.assertEqual(probe.cpu_percent({'cpu': [0]*8}, {'cpu': [0,0,0,100,0,0,0,0]}, 'cpu'), 0)
        self.assertEqual(probe.cpu_percent({'cpu': [0]*8}, {'cpu': [20,0,0,70,10,0,0,0]}, 'cpu'), 20)

    def test_smi_binary_units_and_whitelist(self):
        raw = '''device0 detail infos
BDF: 0000:91:00.0
Model: LQ50-24GB
Cur_BandWidth: 16.0 GT/s x 4lane
DDR_Memory_Total: 24448 MB
DDR_Memory_Free: 14000 MB
Board_Power: 6.11 W
IPU_Load: 0.0 %
Core0: 40.5 C
Core1: 39.0 C
DDR0: 42.0 C
Core0_Util: 0.0 %
Serial_Number: DO-NOT-EXPOSE
'''
        card = probe.parse_smi(raw)['0000:91:00.0']
        self.assertEqual(card['memory_total'], 24448 * 1048576)
        self.assertEqual(card['link'],'16.0 GT/s')
        self.assertEqual(card['width'],'4')
        self.assertEqual(card['memory_used'], 10448 * 1048576)
        self.assertEqual(card['ipu_load'], 0)
        self.assertEqual(card['core_temp'], 40.5)
        self.assertEqual(card['ddr_temp'], 42)
        self.assertNotIn('Serial_Number', card)
        with self.assertRaises(ValueError): probe.parse_smi('driver unavailable')

    def test_server_retains_old_sample_but_marks_it_stale(self):
        monitor = probe.ResourceMonitor()
        monitor.started = True
        monitor.sample = {'timestamp': 'synthetic-old-sample'}
        monitor.last_valid = 100
        with patch.object(probe.time, 'monotonic', return_value=106):
            result = monitor.get()
            self.assertEqual(result['status'], 'stale')
            self.assertEqual(result['age_seconds'], 6)
            self.assertEqual(result['sample']['timestamp'], 'synthetic-old-sample')
        monitor.stop.set()

    def test_idle_interest_and_bounded_history(self):
        monitor = probe.ResourceMonitor(idle_seconds=15)
        monitor.last_interest = 100
        with patch.object(probe.time, 'monotonic', return_value=116):
            self.assertFalse(monitor.interested())
        for i in range(80): monitor.history.append({'seq': i})
        self.assertEqual(len(monitor.history), 60)
        self.assertEqual(monitor.history[0]['seq'], 20)


class ManualReadHttpContracts(unittest.TestCase):
    def setUp(self):
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),dashboard.Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:%d'%self.server.server_port

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def request(self,body,origin=None):
        request=urllib.request.Request(self.base+'/api/resources/card-sample',data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Origin':origin} if origin else {})})
        try:
            with urllib.request.urlopen(request,timeout=3) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)

    def test_valid_post_runs_one_manual_read_and_get_does_not(self):
        from unittest.mock import Mock
        monitor=Mock();monitor.read_card_once.return_value={'status':'live','sample':{'test':True}};monitor.get.return_value={'status':'live'}
        with patch.object(dashboard,'resources',monitor):
            self.assertEqual(self.request({'bdf':'0000:91:00.0'},self.base)[0],200)
            monitor.read_card_once.assert_called_once_with('0000:91:00.0')
            with urllib.request.urlopen(self.base+'/api/resources') as response:self.assertEqual(response.status,200)
            self.assertEqual(monitor.read_card_once.call_count,1)

    def test_invalid_body_and_foreign_origin_never_query_hardware(self):
        from unittest.mock import Mock
        monitor=Mock()
        with patch.object(dashboard,'resources',monitor):
            self.assertEqual(self.request({'bdf':'0000:91:00.0','command':'ignored'})[0],400)
            self.assertEqual(self.request({'bdf':'0000:91:00.0'},'https://foreign.invalid')[0],403)
            self.assertEqual(self.request(['0000:91:00.0'])[0],400)
            monitor.read_card_once.assert_not_called()

    def test_busy_and_failed_reads_return_errors_without_retry(self):
        from unittest.mock import Mock
        monitor=Mock()
        with patch.object(dashboard,'resources',monitor):
            monitor.read_card_once.side_effect=BlockingIOError('正在采样')
            self.assertEqual(self.request({'bdf':'0000:91:00.0'})[0],409)
            monitor.read_card_once.side_effect=RuntimeError('internal details')
            status,body=self.request({'bdf':'0000:91:00.0'})
            self.assertEqual(status,502);self.assertNotIn('internal',body['error'])
            self.assertEqual(monitor.read_card_once.call_count,2)

if __name__ == '__main__': unittest.main()
