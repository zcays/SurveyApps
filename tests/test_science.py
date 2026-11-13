"""Scientific & Frozen Backend Unit Test Suite for SurveyApps! (Fluorescence Lab).
Verifies:
1. Known pixel & channel extraction outputs (mean, R, G, B, cyan, magenta, yellow,
   DAPI, FITC, TRITC, Cy5, mCherry, CFP, YFP, brightfield)
2. Rectangular X/Y spacing and placed-center origin consistency across preview,
   fluorescence calculation, well options, well cropping, grid export, and merged export
3. Settings validation, bounds checking, and JSON save/reload round trips
4. Invalid image handling via function and Flask Dash HTTP callback endpoint
5. Frozen PyInstaller backend authentication, dynamic loopback port, health check,
   and clean EOF / normal quit termination.
"""
import base64
import csv
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

SURVEYAPPS_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = SURVEYAPPS_DIR / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import dash  # noqa: E402
import microscopy_app  # noqa: E402


def _make_synthetic_rgb_image(w=240, h=180):
    """Create a deterministic synthetic 3x2 well image (80x90 px cells) with known RGB values."""
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    # Row 0 (A): y in [0, 90)
    # A1: x in [0, 80) -> pure Red (200, 20, 40)
    arr[0:90, 0:80] = [200, 20, 40]
    # A2: x in [80, 160) -> pure Green (30, 180, 60)
    arr[0:90, 80:160] = [30, 180, 60]
    # A3: x in [160, 240) -> pure Blue (10, 50, 210)
    arr[0:90, 160:240] = [10, 50, 210]

    # Row 1 (B): y in [90, 180)
    # B1: x in [0, 80) -> Yellow-ish (240, 240, 0)
    arr[90:180, 0:80] = [240, 240, 0]
    # B2: x in [80, 160) -> Cyan-ish (0, 160, 200)
    arr[90:180, 80:160] = [0, 160, 200]
    # B3: x in [160, 240) -> Grayscale uniform (128, 128, 128)
    arr[90:180, 160:240] = [128, 128, 128]
    return Image.fromarray(arr, mode='RGB'), arr


def _pil_to_upload_contents(img, fmt='PNG'):
    buf = BytesIO()
    img.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    mime = f'image/{fmt.lower()}'
    return f'data:{mime};base64,{b64}'


def _decode_dcc_send_bytes(download_payload):
    """Decode Dash dcc.send_bytes / dcc.send_string return dictionary."""
    assert isinstance(download_payload, dict), f'Expected dict, got {type(download_payload)}'
    content = download_payload['content']
    if download_payload.get('base64'):
        return base64.b64decode(content)
    return content.encode('utf-8') if isinstance(content, str) else content


class TestMicroscopyScience(unittest.TestCase):
    def setUp(self):
        microscopy_app._rotation_cache.clear()
        microscopy_app._raw_uploaded_image = None
        microscopy_app._uploaded_image = None

    def tearDown(self):
        microscopy_app._rotation_cache.clear()
        microscopy_app._raw_uploaded_image = None
        microscopy_app._uploaded_image = None

    def test_row_labels(self):
        self.assertEqual(microscopy_app._row_label(0), 'A')
        self.assertEqual(microscopy_app._row_label(1), 'B')
        self.assertEqual(microscopy_app._row_label(25), 'Z')
        self.assertEqual(microscopy_app._row_label(26), 'AA')
        self.assertEqual(microscopy_app._row_label(27), 'AB')

    def test_known_pixel_and_channel_outputs(self):
        img, _ = _make_synthetic_rgb_image(240, 180)
        microscopy_app._uploaded_image = img.copy()
        microscopy_app._raw_uploaded_image = img.copy()

        # Use unlinked rectangular spacing: X=80, Y=90 -> exact 2 rows x 3 cols
        # Wait: _grid_positions goes while x < w, so x_pos = [0, 80, 160], which gives n_cols = 2
        # To cover 3 columns [0, 80, 160, 240] within w, let's use a 241x181 image with same cells!
        img_padded = Image.new('RGB', (241, 181), (0, 0, 0))
        img_padded.paste(img, (0, 0))
        microscopy_app._uploaded_image = img_padded
        microscopy_app._raw_uploaded_image = img_padded

        expected_a1 = {
            'mean': (200 + 20 + 40) / 3.0,
            'r': 200.0,
            'g': 20.0,
            'b': 40.0,
            'cyan': (20 + 40) / 2.0,
            'magenta': (200 + 40) / 2.0,
            'yellow': (200 + 20) / 2.0,
            'dapi': 40.0,
            'fitc': 20.0,
            'tritc': 200.0,
            'cy5': 200.0 * 0.8 + 40.0 * 0.2,
            'mcherry': 200.0,
            'cfp': (20 + 40) / 2.0,
            'yfp': 200.0 * 0.3 + 20.0 * 0.7,
            'brightfield': 0.2126 * 200.0 + 0.7152 * 20.0 + 0.0722 * 40.0,
        }

        for ch, expected_val in expected_a1.items():
            res = microscopy_app.compute_fluorescence(
                1, rotation=0, spacing=80, offset_x=0, offset_y=0,
                center_point={'x': 0.0, 'y': 0.0}, channel=ch,
                spacing_y=90, link_spacing=[]
            )
            self.assertEqual(res['n_rows'], 2, f'Channel {ch} row count mismatch')
            self.assertEqual(res['n_cols'], 3, f'Channel {ch} col count mismatch')
            self.assertEqual(res['channel'], ch)
            self.assertAlmostEqual(res['values'][0][0], expected_val, places=4, msg=f'Mismatch on channel {ch} A1')

        # Also check B2 (0, 160, 200) and B3 (128, 128, 128) on 'mean' and 'g'
        res_mean = microscopy_app.compute_fluorescence(
            1, 0, 80, 0, 0, {'x': 0, 'y': 0}, 'mean', spacing_y=90, link_spacing=[]
        )
        self.assertAlmostEqual(res_mean['values'][1][1], (0 + 160 + 200) / 3.0, places=4)
        self.assertAlmostEqual(res_mean['values'][1][2], 128.0, places=4)

        # Verify CSV export matches computed values
        csv_payload = microscopy_app.save_csv(1, res_mean)
        csv_text = _decode_dcc_send_bytes(csv_payload).decode('utf-8')
        reader = list(csv.reader(csv_text.strip().splitlines()))
        self.assertEqual(reader[0], ['Row/Col', '1', '2', '3'])
        self.assertEqual(reader[1][0], 'A')
        self.assertAlmostEqual(float(reader[1][1]), (200 + 20 + 40) / 3.0, places=3)
        self.assertEqual(reader[2][0], 'B')
        self.assertAlmostEqual(float(reader[2][3]), 128.0, places=3)

    def test_rectangular_spacing_and_origin_consistency(self):
        """Verify separate X/Y spacing and placed center point + offset produce identical
        grid geometry across _grid_positions, compute_fluorescence, update_well_options,
        crop_well, save_grid, and save_merged.
        """
        # Create an image with a shifted 2x2 array starting at x=15, y=25 with dx=70, dy=50
        w, h = 200, 160
        arr = np.zeros((h, w, 3), dtype=np.uint8)
        # Well A1 at x in [15, 85), y in [25, 75) -> (180, 40, 20)
        arr[25:75, 15:85] = [180, 40, 20]
        # Well A2 at x in [85, 155), y in [25, 75) -> (20, 190, 50)
        arr[25:75, 85:155] = [20, 190, 50]
        # Well B1 at x in [15, 85), y in [75, 125) -> (30, 60, 210)
        arr[75:125, 15:85] = [30, 60, 210]
        # Well B2 at x in [85, 155), y in [75, 125) -> (220, 200, 10)
        arr[75:125, 85:155] = [220, 200, 10]

        img = Image.fromarray(arr, mode='RGB')
        microscopy_app._uploaded_image = img
        microscopy_app._raw_uploaded_image = img

        # Split origin across center_point (10, 15) and offset (5, 10) -> total (15, 25)
        center = {'x': 10.0, 'y': 15.0}
        off_x, off_y = 5.0, 10.0
        spacing_x, spacing_y = 70.0, 50.0

        x_pos, y_pos = microscopy_app._grid_positions(
            spacing_x, center['x'] + off_x, center['y'] + off_y, w, h, spacing_y
        )
        self.assertEqual(x_pos, [15.0, 85.0, 155.0])
        self.assertEqual(y_pos, [25.0, 75.0, 125.0])

        # 1. Well options
        options = microscopy_app.update_well_options(
            {'w': w, 'h': h}, spacing_x, off_x, off_y, spacing_y, [], center
        )
        labels = [o['label'] for o in options]
        self.assertEqual(labels, ['A1', 'A2', 'B1', 'B2'])

        # 2. Compute fluorescence on Red channel
        fluor = microscopy_app.compute_fluorescence(
            1, 0, spacing_x, off_x, off_y, center, 'r', spacing_y=spacing_y, link_spacing=[]
        )
        self.assertEqual(fluor['n_rows'], 2)
        self.assertEqual(fluor['n_cols'], 2)
        self.assertAlmostEqual(fluor['values'][0][0], 180.0, places=4)
        self.assertAlmostEqual(fluor['values'][0][1], 20.0, places=4)
        self.assertAlmostEqual(fluor['values'][1][0], 30.0, places=4)
        self.assertAlmostEqual(fluor['values'][1][1], 220.0, places=4)

        # 3. Crop well B2 ('1,1') and check dimensions and pixel value
        well_dl = microscopy_app.crop_well(
            1, '1,1', 0, spacing_x, off_x, off_y, spacing_y, [], center
        )
        self.assertEqual(well_dl['filename'], 'well_B2.png')
        well_img = Image.open(BytesIO(_decode_dcc_send_bytes(well_dl)))
        self.assertEqual(well_img.size, (70, 50))
        well_arr = np.array(well_img)
        self.assertTrue(np.all(well_arr == [220, 200, 10]))

        # 4. Save grid PNG and verify grid lines are drawn at x=15, 85, 155 and y=25, 75, 125
        grid_dl = microscopy_app.save_grid(
            1, 0, spacing_x, off_x, off_y, 1.0, [], spacing_y, [], center
        )
        grid_img = Image.open(BytesIO(_decode_dcc_send_bytes(grid_dl)))
        self.assertEqual(grid_img.size, (w, h))
        grid_arr = np.array(grid_img)
        # Pixel on vertical grid line x=15, y=5 should have cyan alpha > 0
        self.assertGreater(grid_arr[5, 15, 3], 200)
        # Pixel on horizontal grid line x=5, y=75 should have cyan alpha > 0
        self.assertGreater(grid_arr[75, 5, 3], 200)
        # Interior pixel away from lines and labels (x=40, y=40) should be transparent
        self.assertEqual(grid_arr[40, 40, 3], 0)

        # 5. Save merged PNG and verify size and non-empty RGB output
        merged_dl = microscopy_app.save_merged(
            1, 0, spacing_x, off_x, off_y, 0.8, ['show'], fluor, ['show'], spacing_y, [], center
        )
        merged_img = Image.open(BytesIO(_decode_dcc_send_bytes(merged_dl)))
        self.assertEqual(merged_img.size, (w, h))
        self.assertEqual(merged_img.mode, 'RGB')

    def test_settings_validation_and_round_trip(self):
        # Save settings
        saved = microscopy_app.save_settings(
            1, rotation=12.5, spacing_x=140.0, spacing_y=95.0, link_spacing=[],
            offset_x=-15.0, offset_y=22.5, center_point={'x': 42.0, 'y': 18.0},
            opacity=0.6, show_labels=['show'], c_top=5.0, c_bot=10.0, c_left=2.5, c_right=7.5,
            filename='custom_config'
        )
        self.assertEqual(saved['filename'], 'custom_config.json')
        raw_json = _decode_dcc_send_bytes(saved).decode('utf-8')
        b64_contents = 'data:application/json;base64,' + base64.b64encode(raw_json.encode('utf-8')).decode('ascii')

        loaded = microscopy_app.load_settings(b64_contents)
        self.assertEqual(loaded[0], 12.5)
        self.assertEqual(loaded[1], 140.0)
        self.assertEqual(loaded[2], 95.0)
        self.assertEqual(loaded[3], [])
        self.assertEqual(loaded[4], -15.0)
        self.assertEqual(loaded[5], 22.5)
        self.assertEqual(loaded[6], {'x': 42.0, 'y': 18.0})
        self.assertEqual(loaded[8], 0.6)
        self.assertEqual(loaded[9], ['show'])
        self.assertEqual(loaded[10], 5.0)
        self.assertEqual(loaded[11], 10.0)
        self.assertEqual(loaded[12], 2.5)
        self.assertEqual(loaded[13], 7.5)
        self.assertIn('Settings loaded successfully', loaded[14])

        # Reject invalid settings (out-of-bounds spacing, bad rotation, non-dict JSON, bad center_point)
        invalid_payloads = [
            json.dumps({'grid_spacing': 0}),
            json.dumps({'rotation': 999}),
            json.dumps({'grid_opacity': 1.5}),
            json.dumps({'link_spacing': ['invalid_flag']}),
            json.dumps({'center_point': {'x': 'bad', 'y': 0}}),
            json.dumps([1, 2, 3]),
            'not-valid-json{{{',
        ]
        for bad_raw in invalid_payloads:
            bad_b64 = 'data:application/json;base64,' + base64.b64encode(bad_raw.encode('utf-8')).decode('ascii')
            res = microscopy_app.load_settings(bad_b64)
            self.assertIs(res[0], dash.no_update)
            self.assertIn('Error loading settings', res[14])

        # Also verify _grid_positions rejects < 1 or non-finite spacing
        with self.assertRaises(ValueError):
            microscopy_app._grid_positions(0, 0, 0, 100, 100)
        with self.assertRaises(ValueError):
            microscopy_app._grid_positions(float('nan'), 0, 0, 100, 100)

    def test_upload_formats_and_invalid_image_via_flask_callback(self):
        img, _ = _make_synthetic_rgb_image(120, 90)
        client = microscopy_app.app.server.test_client()
        upload_cb_key = next(
            k for k in microscopy_app.app.callback_map
            if k.startswith('..image-store.data...crop-top-slider.value')
        )
        cb_outputs = microscopy_app.app.callback_map[upload_cb_key]['output']
        outputs_list = [
            {'id': o.component_id, 'property': o.component_property}
            for o in (cb_outputs if isinstance(cb_outputs, (list, tuple)) else [cb_outputs])
        ]

        # Test PNG, JPEG, and TIFF uploads via Flask Dash HTTP callback endpoint
        for fmt in ('PNG', 'JPEG', 'TIFF'):
            contents = _pil_to_upload_contents(img, fmt=fmt)
            payload = {
                'output': upload_cb_key,
                'outputs': outputs_list,
                'inputs': [
                    {'id': 'upload-image', 'property': 'contents', 'value': contents},
                    {'id': 'rotation-slider', 'property': 'value', 'value': 0},
                    {'id': 'btn-apply-crop', 'property': 'n_clicks', 'value': 0},
                    {'id': 'btn-reset-crop', 'property': 'n_clicks', 'value': 0},
                ],
                'changedPropIds': ['upload-image.contents'],
                'state': [
                    {'id': 'crop-top-slider', 'property': 'value', 'value': 0},
                    {'id': 'crop-bottom-slider', 'property': 'value', 'value': 0},
                    {'id': 'crop-left-slider', 'property': 'value', 'value': 0},
                    {'id': 'crop-right-slider', 'property': 'value', 'value': 0},
                ],
            }
            resp = client.post('/_dash-update-component', json=payload)
            self.assertEqual(resp.status_code, 200, f'{fmt} upload HTTP status failed')
            body = resp.get_json()
            store_data = body['response']['image-store']['data']
            self.assertEqual(store_data['w'], 120)
            self.assertEqual(store_data['h'], 90)
            self.assertTrue(store_data['b64'].startswith('data:image/jpeg;base64,'))

        # Test invalid / corrupt image via Flask Dash HTTP callback endpoint
        corrupt_contents = 'data:image/png;base64,' + base64.b64encode(b'not-an-image-at-all').decode('ascii')
        payload['inputs'][0]['value'] = corrupt_contents
        resp_bad = client.post('/_dash-update-component', json=payload)
        self.assertEqual(resp_bad.status_code, 200)
        body_bad = resp_bad.get_json()
        self.assertIn('Could not read this image', body_bad['response']['status-text']['children'])
        self.assertNotIn('image-store', body_bad['response'])

    def test_heatmap_figure_uses_valid_plotly_title_schema(self):
        fluor = {
            'values': [[10.0, 20.0], [30.0, 40.0]],
            'n_rows': 2,
            'n_cols': 2,
            'channel': 'fitc'
        }
        fig = microscopy_app.update_matrix_graph(fluor)
        layout_json = json.loads(fig.to_json())['layout']
        self.assertEqual(layout_json['xaxis']['title']['text'], 'Column')
        self.assertEqual(layout_json['yaxis']['title']['text'], 'Row')
        self.assertEqual(microscopy_app.invalidate_fluorescence(), None)


class TestFrozenBackendProcess(unittest.TestCase):
    """Spawns the PyInstaller-frozen surveyapps-backend binary (or server.py fallback if missing)
    and verifies dynamic loopback port binding, header authentication, and EOF / shutdown cleanup.
    """

    def _get_backend_cmd(self):
        exe_name = 'surveyapps-backend.exe' if os.name == 'nt' else 'surveyapps-backend'
        frozen = SURVEYAPPS_DIR / 'build' / 'backend' / 'surveyapps-backend' / exe_name
        if frozen.exists():
            return [str(frozen)], True
        return [sys.executable, str(BACKEND_DIR / 'server.py')], False

    def _start_backend(self, token):
        cmd, is_frozen = self._get_backend_cmd()
        env = os.environ.copy()
        env['PYTHONUNBUFFERED'] = '1'
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )
        proc.stdin.write(json.dumps({'token': token}) + '\n')
        proc.stdin.flush()

        deadline = time.time() + 30
        ready_info = None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            try:
                parsed = json.loads(line)
                if parsed.get('event') == 'ready':
                    ready_info = parsed
                    break
            except json.JSONDecodeError:
                continue
        return proc, ready_info, is_frozen

    def test_auth_dynamic_port_and_shutdown_cleanup(self):
        token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
        proc, ready_info, _ = self._start_backend(token)
        try:
            self.assertIsNotNone(ready_info, 'Backend did not emit ready JSON event')
            port = ready_info['port']
            self.assertIsInstance(port, int)
            self.assertGreater(port, 0)
            self.assertLess(port, 65536)

            base_url = f'http://127.0.0.1:{port}'

            # 1. Request without X-SurveyApps-Key -> 403 Forbidden
            req_unauth = urllib.request.Request(f'{base_url}/health')
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req_unauth, timeout=5)
            self.assertEqual(ctx.exception.code, 403)

            # 2. Request with wrong token -> 403 Forbidden
            req_wrong = urllib.request.Request(
                f'{base_url}/health', headers={'X-SurveyApps-Key': 'wrong-token'}
            )
            with self.assertRaises(urllib.error.HTTPError) as ctx2:
                urllib.request.urlopen(req_wrong, timeout=5)
            self.assertEqual(ctx2.exception.code, 403)

            # 3. Request with valid token but untrusted Origin -> 403 Forbidden
            req_bad_origin = urllib.request.Request(
                f'{base_url}/health',
                headers={'X-SurveyApps-Key': token, 'Origin': 'https://evil.example.com'}
            )
            with self.assertRaises(urllib.error.HTTPError) as ctx3:
                urllib.request.urlopen(req_bad_origin, timeout=5)
            self.assertEqual(ctx3.exception.code, 403)

            # 4. Request with valid token and surveyapps://app Origin -> 200 OK
            req_ok = urllib.request.Request(
                f'{base_url}/health',
                headers={'X-SurveyApps-Key': token, 'Origin': 'surveyapps://app'}
            )
            with urllib.request.urlopen(req_ok, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                data = json.loads(resp.read().decode('utf-8'))
                self.assertEqual(data['status'], 'ready')
                self.assertEqual(resp.headers.get('X-Content-Type-Options'), 'nosniff')
                self.assertIn("frame-ancestors surveyapps://app", resp.headers.get('Content-Security-Policy', ''))

            # 5. Normal 'shutdown\n' command on stdin terminates process cleanly
            proc.stdin.write('shutdown\n')
            proc.stdin.flush()
            exit_code = proc.wait(timeout=10)
            self.assertEqual(exit_code, 0)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdin.close()
            proc.stdout.close()
            proc.stderr.close()

    def test_eof_terminates_backend(self):
        token = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f'
        proc, ready_info, _ = self._start_backend(token)
        try:
            self.assertIsNotNone(ready_info)
            # Close stdin without writing 'shutdown' -> simulates parent crash/EOF
            proc.stdin.close()
            exit_code = proc.wait(timeout=10)
            self.assertEqual(exit_code, 0)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.stdout.close()
            proc.stderr.close()


if __name__ == '__main__':
    unittest.main()
