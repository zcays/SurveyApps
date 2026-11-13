import dash
from dash import dcc, html, Input, Output, State, callback_context
import plotly.graph_objects as go
from PIL import Image, ImageDraw, ImageFont, ImageOps
Image.MAX_IMAGE_PIXELS = None
import numpy as np
import requests
from io import BytesIO
import base64
import json
import string

app = dash.Dash(__name__, title="Microscopy Grid Aligner")

# ── Load sample image ──────────────────────────────────────────────────
try:
    url = "https://raw.githubusercontent.com/scikit-image/scikit-image/main/skimage/data/immunohistochemistry.png"
    response = requests.get(url, timeout=5)
    original_image = ImageOps.exif_transpose(Image.open(BytesIO(response.content))).convert('RGB')
except Exception:
    img_array = np.zeros((800, 800, 3), dtype=np.uint8)
    for i in range(0, 800, 80):
        img_array[i:i+40, :] = [50, 0, 100]
        img_array[:, i:i+40] = [0, 100, 50]
    original_image = Image.fromarray(img_array)

# ── Rotation cache ─────────────────────────────────────────────────────
_rotation_cache = {}
_uploaded_image = None


def _pil_to_b64(img, fmt='JPEG'):
    buf = BytesIO()
    if fmt == 'JPEG':
        img.save(buf, format='JPEG', quality=85)
        mime = 'image/jpeg'
    else:
        img.save(buf, format='PNG')
        mime = 'image/png'
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f"data:{mime};base64,{b64}"


def _get_rotated_data(img, rotation):
    cache_key = (id(img), rotation)
    if cache_key not in _rotation_cache:
        if rotation == 0:
            rotated = img
        else:
            rotated = img.rotate(-rotation, expand=True, resample=Image.BILINEAR)
        # Create a lightweight preview for the browser UI to avoid WebGL lag
        preview = rotated.copy()
        preview.thumbnail((2000, 2000), Image.BILINEAR)

        _rotation_cache[cache_key] = {
            'b64': _pil_to_b64(preview),
            'w': rotated.size[0],
            'h': rotated.size[1],
            'pw': preview.size[0],
            'ph': preview.size[1],
            'img': rotated
        }
        if len(_rotation_cache) > 20:
            oldest = next(iter(_rotation_cache))
            del _rotation_cache[oldest]
    return _rotation_cache[cache_key]


def _get_rotated_pil(img, rotation):
    """Return the cached PIL image to avoid re-rotation."""
    return _get_rotated_data(img, rotation)['img'].copy()


def _row_label(idx):
    """Convert row index to letter label: 0->A, 1->B, ..., 25->Z, 26->AA..."""
    label = ''
    i = idx
    while True:
        label = string.ascii_uppercase[i % 26] + label
        i = i // 26 - 1
        if i < 0:
            break
    return label


# ── Shared styles ──────────────────────────────────────────────────────
_btn_style = {
    'backgroundColor': '#333', 'color': '#ddd', 'border': '1px solid #555',
    'borderRadius': '4px', 'padding': '8px 12px', 'cursor': 'pointer',
    'fontFamily': 'sans-serif', 'fontSize': '0.85em', 'width': '100%',
    'marginBottom': '6px'
}
_label_style = {'color': '#bbbbbb', 'fontFamily': 'sans-serif', 'fontSize': '0.9em', 'marginBottom': '4px'}

# ── Layout ─────────────────────────────────────────────────────────────
app.layout = html.Div([
    dcc.Store(id='image-store'),
    dcc.Store(id='fluor-store'),
    dcc.Download(id='download-image'),
    dcc.Download(id='download-grid'),
    dcc.Download(id='download-merged'),
    dcc.Download(id='download-settings'),
    dcc.Download(id='download-crop'),
    dcc.Download(id='download-csv'),

    # Left Control Panel
    html.Div([
        html.H2("Microscopy Aligner", style={
            'color': '#ffffff', 'margin': '0 0 15px 0',
            'fontFamily': 'sans-serif', 'fontSize': '1.4em'
        }),

        # ── Upload ─────────────────────────────────────────────────
        html.Div([
            dcc.Upload(
                id='upload-image',
                children=html.Div([
                    'Drag & Drop or ',
                    html.A('Select Image', style={
                        'color': '#00aaff', 'textDecoration': 'underline'
                    })
                ]),
                style={
                    'width': '100%', 'height': '50px', 'lineHeight': '50px',
                    'borderWidth': '1px', 'borderStyle': 'dashed',
                    'borderRadius': '5px', 'textAlign': 'center',
                    'marginBottom': '15px', 'color': '#bbbbbb',
                    'borderColor': '#777', 'cursor': 'pointer', 'fontSize': '0.85em'
                },
                multiple=False,
                accept='image/*,.tif,.tiff,.jpg,.jpeg,.png'
            )
        ]),

        # ── Interactive Controls ───────────────────────────────────
        html.Div([
            dcc.Store(id='placement-mode', data=False),
            dcc.Store(id='center-point-store', data={'x': 0.0, 'y': 0.0}),
            dcc.Store(id='keypress-store'),
            html.Div(id='dummy-listener'),
            html.Button("🎯 Place Center Point (W)", id='btn-place-center', n_clicks=0, style=_btn_style),
            html.Div(id='center-point-display', children='Center Point: (0.0, 0.0)', style={'color': '#00ffff', 'fontFamily': 'monospace', 'fontSize': '0.9em', 'marginBottom': '5px', 'textAlign': 'center'}),
            html.Div(id='placement-status', style={'color': '#ffaa00', 'fontFamily': 'sans-serif', 'fontSize': '0.85em', 'marginBottom': '15px', 'textAlign': 'center', 'fontWeight': 'bold'})
        ]),

        # ── Sliders ────────────────────────────────────────────────
        html.Div([
            html.Label("Image Rotation (°)", style=_label_style),
            dcc.Slider(id='rotation-slider', min=-180, max=180, step=0.01, value=0,
                       updatemode='mouseup',
                       marks={i: {'label': str(i), 'style': {'color': '#777'}}
                              for i in range(-180, 181, 90)},
                       tooltip={"placement": "bottom", "always_visible": True})
        ], style={'marginBottom': '15px'}),

        html.Div([
            html.Label("Grid Spacing (px)", style=_label_style),
            dcc.Slider(id='grid-spacing-slider', min=10, max=2000, step=0.001, value=229,
                       updatemode='drag',
                       marks={i: {'label': str(i), 'style': {'color': '#777'}}
                              for i in range(500, 2001, 500)},
                       tooltip={"placement": "bottom", "always_visible": True})
        ], style={'marginBottom': '15px'}),

        html.Div([
            html.Label("Grid X Offset (px)", style=_label_style),
            dcc.Slider(id='grid-x-offset-slider', min=-2000, max=2000, step=0.01, value=0,
                       updatemode='drag',
                       marks={i: {'label': str(i), 'style': {'color': '#777'}}
                              for i in range(-2000, 2001, 1000)},
                       tooltip={"placement": "bottom", "always_visible": True})
        ], style={'marginBottom': '15px'}),

        html.Div([
            html.Label("Grid Y Offset (px)", style=_label_style),
            dcc.Slider(id='grid-y-offset-slider', min=-2000, max=2000, step=0.01, value=0,
                       updatemode='drag',
                       marks={i: {'label': str(i), 'style': {'color': '#777'}}
                              for i in range(-2000, 2001, 1000)},
                       tooltip={"placement": "bottom", "always_visible": True})
        ], style={'marginBottom': '15px'}),

        html.Div([
            html.Label("Grid Opacity", style=_label_style),
            dcc.Slider(id='grid-opacity-slider', min=0, max=1, step=0.1, value=0.7,
                       updatemode='drag',
                       marks={0: {'label': '0', 'style': {'color': '#777'}},
                              1: {'label': '1', 'style': {'color': '#777'}}},
                       tooltip={"placement": "bottom", "always_visible": False})
        ], style={'marginBottom': '15px'}),
        
        # ── Auto-Fit Grid ──────────────────────────────────────────
        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),
        html.Label("Auto-Fit Grid", style={
            'color': '#ffffff', 'fontFamily': 'sans-serif',
            'fontWeight': 'bold', 'marginBottom': '8px', 'display': 'block'
        }),
        html.Div("Automatically scale and position the grid to bound all glowing regions. Requires approximate Spacing value above.", style={'color': '#aaaaaa', 'fontSize': '0.8em', 'marginBottom': '10px'}),
        html.Button("🔍 Auto-Detect & Fit Grid", id='btn-autofit', n_clicks=0, style=_btn_style),


        html.Div([
            html.Label("Show Well Labels", style=_label_style),
            dcc.Checklist(
                id='show-labels-check',
                options=[{'label': ' Show A1, A2, B1... labels', 'value': 'show'}],
                value=['show'],
                labelStyle={'color': '#bbbbbb', 'display': 'inline-block', 'marginLeft': '5px'},
                style={'color': '#bbbbbb', 'fontFamily': 'sans-serif', 'marginTop': '3px'}
            )
        ], style={'marginBottom': '15px'}),

        # ── Fluorescence ───────────────────────────────────────────
        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),
        html.Label("Fluorescence Analysis", style={
            'color': '#ffffff', 'fontFamily': 'sans-serif',
            'fontWeight': 'bold', 'marginBottom': '8px', 'display': 'block'
        }),

        html.Div([
            html.Label("Channel", style=_label_style),
            dcc.Dropdown(
                id='fluor-channel',
                options=[
                    {'label': '── Raw Channels ──', 'value': '_sep1', 'disabled': True},
                    {'label': 'Grayscale (mean)', 'value': 'mean'},
                    {'label': 'Red (R)', 'value': 'r'},
                    {'label': 'Green (G)', 'value': 'g'},
                    {'label': 'Blue (B)', 'value': 'b'},
                    {'label': 'Cyan (G+B)', 'value': 'cyan'},
                    {'label': 'Magenta (R+B)', 'value': 'magenta'},
                    {'label': 'Yellow (R+G)', 'value': 'yellow'},
                    {'label': '── Fluorophores (Echo) ──', 'value': '_sep2', 'disabled': True},
                    {'label': 'DAPI (Blue)', 'value': 'dapi'},
                    {'label': 'FITC / GFP (Green)', 'value': 'fitc'},
                    {'label': 'TRITC / Texas Red (Red)', 'value': 'tritc'},
                    {'label': 'Cy5 (Far Red)', 'value': 'cy5'},
                    {'label': 'mCherry / RFP (Red)', 'value': 'mcherry'},
                    {'label': 'CFP (Cyan)', 'value': 'cfp'},
                    {'label': 'YFP (Yellow-Green)', 'value': 'yfp'},
                    {'label': '── Brightfield ──', 'value': '_sep3', 'disabled': True},
                    {'label': 'Brightfield (luminance)', 'value': 'brightfield'},
                ],
                value='mean',
                style={'backgroundColor': '#333', 'color': '#ddd', 'marginBottom': '8px'},
                className='dark-dropdown'
            ),
        ], style={'marginBottom': '8px'}),

        html.Button("🔬  Compute Fluorescence", id='btn-compute-fluor', n_clicks=0, style=_btn_style),

        html.Div([
            dcc.Checklist(
                id='show-fluor-check',
                options=[{'label': ' Show values on image', 'value': 'show'}],
                value=['show'],
                labelStyle={'color': '#bbbbbb', 'display': 'inline-block', 'marginLeft': '5px'},
                style={'color': '#bbbbbb', 'fontFamily': 'sans-serif', 'marginTop': '3px'}
            )
        ], style={'marginBottom': '8px'}),

        html.Button("📊  Export Matrix CSV", id='btn-save-csv', n_clicks=0, style=_btn_style),

        # ── Crop Well ──────────────────────────────────────────────
        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),
        html.Label("Crop Well", style={
            'color': '#ffffff', 'fontFamily': 'sans-serif',
            'fontWeight': 'bold', 'marginBottom': '8px', 'display': 'block'
        }),

        html.Div([
            html.Label("Select Well", style=_label_style),
            dcc.Dropdown(
                id='crop-well-dropdown',
                options=[],
                placeholder='Select a well (e.g. A1)',
                style={'backgroundColor': '#333', 'color': '#ddd', 'marginBottom': '8px'},
                className='dark-dropdown'
            ),
        ], style={'marginBottom': '8px'}),

        html.Button("✂️  Crop & Download Well", id='btn-crop-well', n_clicks=0, style=_btn_style),

        # ── Export & Settings ──────────────────────────────────────
        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),
        html.Label("Export & Settings", style={
            'color': '#ffffff', 'fontFamily': 'sans-serif',
            'fontWeight': 'bold', 'marginBottom': '8px', 'display': 'block'
        }),

        html.Button("💾  Save Image Only", id='btn-save-image', n_clicks=0, style=_btn_style),
        html.Button("🔲  Save Grid Only", id='btn-save-grid', n_clicks=0, style=_btn_style),
        html.Button("📸  Save Merged (Image + Grid)", id='btn-save-merged', n_clicks=0, style=_btn_style),

        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),

        html.Button("⬇️  Save Grid Settings", id='btn-save-settings', n_clicks=0, style=_btn_style),
        dcc.Upload(
            id='upload-settings',
            children=html.Button("⬆️  Load Grid Settings", style=_btn_style),
            style={'width': '100%'},
            multiple=False
        ),

        html.Div(id='status-text', style={
            'color': '#4CAF50', 'fontFamily': 'sans-serif',
            'fontSize': '0.85em', 'marginTop': '8px', 'minHeight': '20px'
        }),

        # ── Matrix Heatmap Container ────────────────────────────────
        html.Hr(style={'borderColor': '#444', 'margin': '12px 0'}),
        html.Label("Fluorescence Matrix Heatmap", style={
            'color': '#ffffff', 'fontFamily': 'sans-serif',
            'fontWeight': 'bold', 'marginBottom': '8px', 'display': 'block'
        }),
        dcc.Graph(
            id='matrix-graph',
            style={'height': '220px', 'width': '100%'},
            config={'displayModeBar': False}
        ),

    ], style={
        'width': '28%', 'height': '100vh', 'padding': '20px',
        'boxSizing': 'border-box', 'display': 'inline-block',
        'verticalAlign': 'top', 'backgroundColor': '#1e1e1e',
        'borderRight': '1px solid #333', 'overflowY': 'auto'
    }),

    # Right Main Display Panel
    html.Div([
        dcc.Graph(
            id='image-graph',
            style={'height': '100vh', 'width': '100%'},
            config={
                'scrollZoom': True,
                'displayModeBar': True,
                'modeBarButtonsToRemove': ['lasso2d', 'select2d'],
            }
        )
    ], style={
        'width': '72%', 'height': '100vh',
        'display': 'inline-block', 'verticalAlign': 'top',
        'backgroundColor': '#000000'
    })
], style={'margin': '0', 'padding': '0', 'display': 'flex'})


# ── Server callback: image rotation ───────────────────────────────────
@app.callback(
    Output('image-store', 'data'),
    [Input('upload-image', 'contents'),
     Input('rotation-slider', 'value')]
)
def update_image_store(upload_contents, rotation):
    global _uploaded_image
    ctx = dash.callback_context
    
    # On initial page load/refresh, Dash triggers without a specific property
    if not ctx.triggered or ctx.triggered[0]['prop_id'] == '.':
        _uploaded_image = None
        
    elif ctx.triggered and ctx.triggered[0]['prop_id'] == 'upload-image.contents':
        if upload_contents is not None:
            try:
                _, content_string = upload_contents.split(',')
                decoded = base64.b64decode(content_string)
                _uploaded_image = ImageOps.exif_transpose(Image.open(BytesIO(decoded))).convert('RGB')
            except Exception:
                pass
    current = _uploaded_image if _uploaded_image is not None else original_image
    data = _get_rotated_data(current, rotation)
    return {'b64': data['b64'], 'w': data['w'], 'h': data['h'], 'pw': data['pw'], 'ph': data['ph']}


# ── Clientside callback: figure with grid + well labels + fluorescence ──
app.clientside_callback(
    """
    function(imgData, centerPoint, gridSpacing, offsetX, offsetY, gridOpacity, showLabels, flourData, showFluor, relayoutData) {
        if (!imgData) {
            return window.dash_clientside.no_update;
        }

        var cx = centerPoint ? centerPoint.x : 0;
        var cy = centerPoint ? centerPoint.y : 0;
        
        var trueOffsetX = cx + offsetX;
        var trueOffsetY = cy + offsetY;

        var b64 = imgData.b64;
        var imgW = imgData.w;
        var imgH = imgData.h;
        var previewW = imgData.pw || imgW;
        var previewH = imgData.ph || imgH;
        var dx = imgW / previewW;
        var dy = imgH / previewH;
        
        var gridColor = 'rgba(0, 255, 255, ' + gridOpacity + ')';
        var spacing = Math.max(gridSpacing, 1);
        var doLabels = showLabels && showLabels.indexOf('show') !== -1;
        var doFluor = showFluor && showFluor.indexOf('show') !== -1 && flourData && flourData.values;

        // Build grid shapes
        var shapes = [];

        // Compute grid line positions
        var startX = ((trueOffsetX % spacing) + spacing) % spacing;
        var xPositions = [];
        for (var x = startX; x < imgW; x += spacing) {
            xPositions.push(x);
            shapes.push({
                type: 'line', x0: x, x1: x, y0: 0, y1: imgH,
                line: {color: gridColor, width: 1.5},
                editable: false
            });
        }

        var startY = ((trueOffsetY % spacing) + spacing) % spacing;
        var yPositions = [];
        for (var y = startY; y < imgH; y += spacing) {
            yPositions.push(y);
            shapes.push({
                type: 'line', x0: 0, x1: imgW, y0: y, y1: y,
                line: {color: gridColor, width: 1.5},
                editable: false
            });
        }

        // Add a visible center point shape
        shapes.push({
            type: 'circle',
            x0: trueOffsetX - 8, y0: trueOffsetY - 8,
            x1: trueOffsetX + 8, y1: trueOffsetY + 8,
            line: {color: 'rgba(255, 50, 50, 0.9)', width: 2},
            fillcolor: 'rgba(255, 255, 255, 0.5)',
            name: 'center-point'
        });

        // Build axis tick labels centered in each box
        var xTickVals = [];
        var xTickText = [];
        var yTickVals = [];
        var yTickText = [];

        function rowLabel(idx) {
            var label = '';
            var i = idx;
            do {
                label = String.fromCharCode(65 + (i % 26)) + label;
                i = Math.floor(i / 26) - 1;
            } while (i >= 0);
            return label;
        }

        if (doLabels) {
            for (var ci = 0; ci < xPositions.length - 1; ci++) {
                xTickVals.push((xPositions[ci] + xPositions[ci + 1]) / 2);
                xTickText.push(String(ci + 1));
            }
            for (var ri = 0; ri < yPositions.length - 1; ri++) {
                yTickVals.push((yPositions[ri] + yPositions[ri + 1]) / 2);
                yTickText.push(rowLabel(ri));
            }
        }

        // Fluorescence value annotations inside each well
        var annotations = [];
        if (doFluor) {
            var fVals = flourData.values;
            var fRows = flourData.n_rows;
            var fCols = flourData.n_cols;
            for (var frow = 0; frow < fRows; frow++) {
                for (var fcol = 0; fcol < fCols; fcol++) {
                    if (frow < yPositions.length - 1 && fcol < xPositions.length - 1) {
                        var fx = (xPositions[fcol] + xPositions[fcol + 1]) / 2;
                        var fy = (yPositions[frow] + yPositions[frow + 1]) / 2;
                        var val = fVals[frow][fcol];
                        var fontSize = Math.min(Math.max(spacing * 0.12, 8), 14);
                        annotations.push({
                            x: fx, y: fy,
                            text: val.toFixed(1),
                            showarrow: false,
                            font: {color: '#ffff00', size: fontSize, family: 'monospace'},
                            xref: 'x', yref: 'y',
                            opacity: 0.9,
                            bgcolor: 'rgba(0,0,0,0.5)',
                            borderpad: 2
                        });
                    }
                }
            }
        }

        // Determine axis ranges (preserve zoom/pan if present)
        var xRange = [0, imgW];
        var yRange = [imgH, 0];
        if (relayoutData) {
            if (relayoutData['xaxis.range[0]'] !== undefined) {
                xRange = [relayoutData['xaxis.range[0]'], relayoutData['xaxis.range[1]']];
                yRange = [relayoutData['yaxis.range[0]'], relayoutData['yaxis.range[1]']];
            }
        }

        var leftMargin = doLabels ? 35 : 0;
        var topMargin = doLabels ? 25 : 0;

        return {
            data: [{
                type: 'image',
                source: b64,
                x0: dx / 2,
                y0: dy / 2,
                dx: dx,
                dy: dy,
                hoverinfo: 'none'
            }],
            layout: {
                shapes: shapes,
                annotations: annotations,
                xaxis: {
                    range: xRange,
                    showgrid: false, zeroline: false,
                    title: '',
                    scaleanchor: 'y',
                    side: 'top',
                    showticklabels: doLabels,
                    tickvals: xTickVals,
                    ticktext: xTickText,
                    tickfont: {color: 'rgba(0,255,255,0.85)', size: 12, family: 'monospace'},
                    ticks: ''
                },
                yaxis: {
                    range: yRange,
                    showgrid: false, zeroline: false,
                    title: '',
                    side: 'left',
                    showticklabels: doLabels,
                    tickvals: yTickVals,
                    ticktext: yTickText,
                    tickfont: {color: 'rgba(0,255,255,0.85)', size: 12, family: 'monospace'},
                    ticks: ''
                },
                margin: {l: leftMargin, r: 0, t: topMargin, b: 0},
                plot_bgcolor: '#000000',
                paper_bgcolor: '#000000',
                uirevision: 'constant',
                dragmode: 'pan'
            }
        };
    }
    """,
    Output('image-graph', 'figure'),
    [Input('image-store', 'data'),
     Input('center-point-store', 'data'),
     Input('grid-spacing-slider', 'value'),
     Input('grid-x-offset-slider', 'value'),
     Input('grid-y-offset-slider', 'value'),
     Input('grid-opacity-slider', 'value'),
     Input('show-labels-check', 'value'),
     Input('fluor-store', 'data'),
     Input('show-fluor-check', 'value')],
    [State('image-graph', 'relayoutData')]
)

# ── Clientside callback: Global Keypress Listener ──────────────────────
app.clientside_callback(
    """
    function(id) {
        if (!window._keydown_listener_v2_added) {
            window._keydown_listener_v2_added = true;
            document.addEventListener('keydown', function(e) {
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
                var key = e.key;
                if (['w', 'W', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(key)) {
                    if (key.startsWith('Arrow') || key === '+' || key === '-' || key === '=') {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    
                    var activeId = null;
                    if (document.activeElement) {
                        var sliderParent = document.activeElement.closest('[id$="-slider"]');
                        if (sliderParent) {
                            activeId = sliderParent.id;
                        }
                    }
                    window.dash_clientside.set_props('keypress-store', {data: {key: key, ts: Date.now(), active_id: activeId}});
                }
            }, true);
        }
        return window.dash_clientside.no_update;
    }
    """,
    Output('dummy-listener', 'children'),
    Input('dummy-listener', 'id')
)

# ── Helper: compute grid positions ─────────────────────────────────────
def _grid_positions(spacing, offset_x, offset_y, w, h):
    """Return lists of x and y grid line positions."""
    x_pos = []
    sx = offset_x % spacing
    x = sx
    while x < w:
        x_pos.append(x)
        x += spacing
    y_pos = []
    sy = offset_y % spacing
    y = sy
    while y < h:
        y_pos.append(y)
        y += spacing
    return x_pos, y_pos


# ── Compute fluorescence per well ──────────────────────────────────────
@app.callback(
    Output('fluor-store', 'data'),
    Input('btn-compute-fluor', 'n_clicks'),
    [State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value'),
     State('center-point-store', 'data'),
     State('fluor-channel', 'value')],
    prevent_initial_call=True
)
def compute_fluorescence(n_clicks, rotation, spacing, offset_x, offset_y, center_point, channel):
    cx = center_point.get('x', 0) if center_point else 0
    cy = center_point.get('y', 0) if center_point else 0
    true_offset_x = cx + offset_x
    true_offset_y = cy + offset_y

    current = _uploaded_image if _uploaded_image is not None else original_image
    rotated = _get_rotated_pil(current, rotation)
    arr = np.array(rotated)
    w, h = rotated.size
    x_pos, y_pos = _grid_positions(spacing, true_offset_x, true_offset_y, w, h)

    n_rows = max(0, len(y_pos) - 1)
    n_cols = max(0, len(x_pos) - 1)

    # Channel mapping: map fluorophore names to RGB extraction logic
    channel_map = {
        'r': lambda c: c[:, :, 0].astype(float),
        'g': lambda c: c[:, :, 1].astype(float),
        'b': lambda c: c[:, :, 2].astype(float),
        'cyan': lambda c: (c[:, :, 1].astype(float) + c[:, :, 2].astype(float)) / 2,
        'magenta': lambda c: (c[:, :, 0].astype(float) + c[:, :, 2].astype(float)) / 2,
        'yellow': lambda c: (c[:, :, 0].astype(float) + c[:, :, 1].astype(float)) / 2,
        'dapi': lambda c: c[:, :, 2].astype(float),
        'fitc': lambda c: c[:, :, 1].astype(float),
        'tritc': lambda c: c[:, :, 0].astype(float),
        'cy5': lambda c: (c[:, :, 0].astype(float) * 0.8 + c[:, :, 2].astype(float) * 0.2),
        'mcherry': lambda c: c[:, :, 0].astype(float),
        'cfp': lambda c: (c[:, :, 1].astype(float) + c[:, :, 2].astype(float)) / 2,
        'yfp': lambda c: (c[:, :, 0].astype(float) * 0.3 + c[:, :, 1].astype(float) * 0.7),
        'brightfield': lambda c: (0.2126 * c[:, :, 0].astype(float) +
                                   0.7152 * c[:, :, 1].astype(float) +
                                   0.0722 * c[:, :, 2].astype(float)),
        'mean': lambda c: c.astype(float).mean(axis=2),
    }
    extract = channel_map.get(channel, channel_map['mean'])
    extracted_arr = extract(arr)

    values = []
    for r in range(n_rows):
        row_vals = []
        for c in range(n_cols):
            y0 = int(round(y_pos[r]))
            y1 = int(round(y_pos[r + 1]))
            x0 = int(round(x_pos[c]))
            x1 = int(round(x_pos[c + 1]))
            cell = extracted_arr[y0:y1, x0:x1]
            if cell.size == 0:
                row_vals.append(0.0)
            else:
                row_vals.append(float(cell.mean()))
        values.append(row_vals)

    return {'values': values, 'n_rows': n_rows, 'n_cols': n_cols, 'channel': channel}


# ── Render Matrix Heatmap ──────────────────────────────────────────────
@app.callback(
    Output('matrix-graph', 'figure'),
    Input('fluor-store', 'data')
)
def update_matrix_graph(fluor_data):
    if not fluor_data or not fluor_data.get('values'):
        # Empty placeholder figure
        fig = go.Figure()
        fig.update_layout(
            paper_bgcolor='#1e1e1e', plot_bgcolor='#1e1e1e',
            xaxis={'visible': False}, yaxis={'visible': False},
            annotations=[{
                'text': 'Click "Compute Fluorescence" to generate matrix',
                'xref': 'paper', 'yref': 'paper', 'x': 0.5, 'y': 0.5,
                'showarrow': False, 'font': {'color': '#777', 'size': 11}
            }],
            margin={'l': 10, 'r': 10, 't': 10, 'b': 10}
        )
        return fig

    values = np.array(fluor_data['values'])
    n_rows = fluor_data['n_rows']
    n_cols = fluor_data['n_cols']

    y_labels = [_row_label(r) for r in range(n_rows)]
    x_labels = [str(c + 1) for c in range(n_cols)]

    # Dynamic colorscale based on channel type
    ch = fluor_data.get('channel', 'mean')
    colorscale_map = {
        'r': 'Reds', 'tritc': 'Reds', 'mcherry': 'Reds',
        'g': 'Greens', 'fitc': 'Greens', 'yfp': 'YlGn',
        'b': 'Blues', 'dapi': 'Blues',
        'cyan': 'Ice', 'cfp': 'Ice',
        'magenta': 'Purples', 'cy5': 'Plasma'
    }
    cs = colorscale_map.get(ch, 'Viridis')

    text_vals = [[f"{v:.1f}" for v in row] for row in values]

    fig = go.Figure(data=go.Heatmap(
        z=values,
        x=x_labels,
        y=y_labels,
        colorscale=cs,
        text=text_vals,
        texttemplate="%{text}",
        textfont={"size": 9, "color": "white"},
        hoverinfo="x+y+z",
        showscale=False
    ))

    fig.update_layout(
        paper_bgcolor='#1e1e1e',
        plot_bgcolor='#1e1e1e',
        xaxis={'title': 'Column', 'side': 'top', 'tickfont': {'color': '#ccc', 'size': 9}, 'titlefont': {'color': '#aaa', 'size': 10}},
        yaxis={'title': 'Row', 'autorange': 'reversed', 'tickfont': {'color': '#ccc', 'size': 9}, 'titlefont': {'color': '#aaa', 'size': 10}},
        margin={'l': 30, 'r': 10, 't': 35, 'b': 20}
    )
    return fig


# ── Update well dropdown options ───────────────────────────────────────
@app.callback(
    Output('crop-well-dropdown', 'options'),
    [Input('image-store', 'data'),
     Input('grid-spacing-slider', 'value'),
     Input('grid-x-offset-slider', 'value'),
     Input('grid-y-offset-slider', 'value')]
)
def update_well_options(img_data, spacing, offset_x, offset_y):
    if not img_data:
        return []
    w, h = img_data['w'], img_data['h']
    x_pos, y_pos = _grid_positions(spacing, offset_x, offset_y, w, h)
    n_rows = max(0, len(y_pos) - 1)
    n_cols = max(0, len(x_pos) - 1)
    
    # Prevent OOM crashes by limiting the maximum number of generated options
    max_options = 1000
    options = []
    
    for r in range(n_rows):
        for c in range(n_cols):
            if len(options) >= max_options:
                return options
            label = _row_label(r) + str(c + 1)
            options.append({'label': label, 'value': f'{r},{c}'})
            
    return options


# ── Crop & download a single well ──────────────────────────────────────
@app.callback(
    Output('download-crop', 'data'),
    Input('btn-crop-well', 'n_clicks'),
    [State('crop-well-dropdown', 'value'),
     State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value')],
    prevent_initial_call=True
)
def crop_well(n_clicks, well_value, rotation, spacing, offset_x, offset_y):
    if not well_value:
        raise dash.exceptions.PreventUpdate
    r, c = [int(v) for v in well_value.split(',')]
    current = _uploaded_image if _uploaded_image is not None else original_image
    rotated = _get_rotated_pil(current, rotation)
    w, h = rotated.size
    x_pos, y_pos = _grid_positions(spacing, offset_x, offset_y, w, h)

    x0 = int(round(x_pos[c]))
    x1 = int(round(x_pos[c + 1]))
    y0 = int(round(y_pos[r]))
    y1 = int(round(y_pos[r + 1]))
    cropped = rotated.crop((x0, y0, x1, y1))

    well_name = _row_label(r) + str(c + 1)
    buf = BytesIO()
    cropped.save(buf, format='PNG')
    buf.seek(0)
    return dcc.send_bytes(buf.getvalue(), f'well_{well_name}.png')


# ── Save image only ───────────────────────────────────────────────────
@app.callback(
    Output('download-image', 'data'),
    Input('btn-save-image', 'n_clicks'),
    [State('rotation-slider', 'value')],
    prevent_initial_call=True
)
def save_image(n_clicks, rotation):
    current = _uploaded_image if _uploaded_image is not None else original_image
    rotated = _get_rotated_pil(current, rotation)
    buf = BytesIO()
    rotated.save(buf, format='PNG')
    buf.seek(0)
    return dcc.send_bytes(buf.getvalue(), 'microscopy_image.png')


# ── Save grid only (transparent background) ───────────────────────────
@app.callback(
    Output('download-grid', 'data'),
    Input('btn-save-grid', 'n_clicks'),
    [State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value'),
     State('grid-opacity-slider', 'value'),
     State('show-labels-check', 'value')],
    prevent_initial_call=True
)
def save_grid(n_clicks, rotation, spacing, offset_x, offset_y, opacity, show_labels):
    current = _uploaded_image if _uploaded_image is not None else original_image
    rotated = _get_rotated_pil(current, rotation)
    w, h = rotated.size
    grid_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(grid_img)
    alpha = int(opacity * 255)
    color = (0, 255, 255, alpha)

    col_positions, row_positions = _grid_positions(spacing, offset_x, offset_y, w, h)
    for x in col_positions:
        draw.line([(x, 0), (x, h)], fill=color, width=2)
    for y in row_positions:
        draw.line([(0, y), (w, y)], fill=color, width=2)

    if show_labels and 'show' in show_labels:
        font_size = min(max(int(spacing * 0.15), 8), 16)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", font_size)
        except Exception:
            try:
                font = ImageFont.truetype("Arial.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()
        for r in range(len(row_positions) - 1):
            for c in range(len(col_positions) - 1):
                cx = (col_positions[c] + col_positions[c + 1]) / 2
                cy = (row_positions[r] + row_positions[r + 1]) / 2
                label = _row_label(r) + str(c + 1)
                draw.text((cx, cy), label, fill=color, font=font, anchor='mm')

    buf = BytesIO()
    grid_img.save(buf, format='PNG')
    buf.seek(0)
    return dcc.send_bytes(buf.getvalue(), 'microscopy_grid.png')


# ── Save merged (image + grid overlay + fluorescence) ─────────────────
@app.callback(
    Output('download-merged', 'data'),
    Input('btn-save-merged', 'n_clicks'),
    [State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value'),
     State('grid-opacity-slider', 'value'),
     State('show-labels-check', 'value'),
     State('fluor-store', 'data'),
     State('show-fluor-check', 'value')],
    prevent_initial_call=True
)
def save_merged(n_clicks, rotation, spacing, offset_x, offset_y, opacity, show_labels, fluor_data, show_fluor):
    current = _uploaded_image if _uploaded_image is not None else original_image
    rotated = _get_rotated_pil(current, rotation)
    w, h = rotated.size

    # Draw grid on RGBA overlay
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    alpha = int(opacity * 255)
    color = (0, 255, 255, alpha)

    col_positions, row_positions = _grid_positions(spacing, offset_x, offset_y, w, h)
    for x in col_positions:
        draw.line([(x, 0), (x, h)], fill=color, width=2)
    for y in row_positions:
        draw.line([(0, y), (w, y)], fill=color, width=2)

    if show_labels and 'show' in show_labels:
        font_size = min(max(int(spacing * 0.15), 8), 16)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", font_size)
        except Exception:
            try:
                font = ImageFont.truetype("Arial.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()
        for r in range(len(row_positions) - 1):
            for c in range(len(col_positions) - 1):
                cx = (col_positions[c] + col_positions[c + 1]) / 2
                cy = (row_positions[r] + row_positions[r + 1]) / 2
                label = _row_label(r) + str(c + 1)
                draw.text((cx, cy), label, fill=color, font=font, anchor='mm')

    # Draw fluorescence values if computed and checked
    if show_fluor and 'show' in show_fluor and fluor_data and fluor_data.get('values'):
        vals = fluor_data['values']
        font_size = min(max(int(spacing * 0.14), 8), 14)
        try:
            f_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", font_size)
        except Exception:
            try:
                f_font = ImageFont.truetype("Arial.ttf", font_size)
            except Exception:
                f_font = ImageFont.load_default()

        yellow_color = (255, 255, 0, 230)
        for r in range(min(len(vals), len(row_positions) - 1)):
            for c in range(min(len(vals[r]), len(col_positions) - 1)):
                cx = (col_positions[c] + col_positions[c + 1]) / 2
                cy = (row_positions[r] + row_positions[r + 1]) / 2 + (spacing * 0.15 if show_labels and 'show' in show_labels else 0)
                txt = f"{vals[r][c]:.1f}"
                draw.text((cx, cy), txt, fill=yellow_color, font=f_font, anchor='mm')

    # Composite
    merged = rotated.convert('RGBA')
    merged = Image.alpha_composite(merged, overlay)
    merged = merged.convert('RGB')

    buf = BytesIO()
    merged.save(buf, format='PNG')
    buf.seek(0)
    return dcc.send_bytes(buf.getvalue(), 'microscopy_merged.png')


# ── Save Fluorescence Matrix CSV ───────────────────────────────────────
@app.callback(
    Output('download-csv', 'data'),
    Input('btn-save-csv', 'n_clicks'),
    State('fluor-store', 'data'),
    prevent_initial_call=True
)
def save_csv(n_clicks, fluor_data):
    if not fluor_data or not fluor_data.get('values'):
        raise dash.exceptions.PreventUpdate

    values = fluor_data['values']
    n_rows = fluor_data['n_rows']
    n_cols = fluor_data['n_cols']
    channel = fluor_data.get('channel', 'mean')

    header = ['Row/Col'] + [str(c + 1) for c in range(n_cols)]
    rows = [header]
    for r in range(n_rows):
        row_str = [_row_label(r)] + [f"{values[r][c]:.3f}" for c in range(n_cols)]
        rows.append(row_str)

    content = '\n'.join([','.join(row) for row in rows])
    return dcc.send_string(content, f'fluorescence_matrix_{channel}.csv')


# ── Save grid settings ────────────────────────────────────────────────
@app.callback(
    Output('download-settings', 'data'),
    Input('btn-save-settings', 'n_clicks'),
    [State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value'),
     State('center-point-store', 'data'),
     State('grid-opacity-slider', 'value'),
     State('show-labels-check', 'value')],
    prevent_initial_call=True
)
def save_settings(n_clicks, rotation, spacing, offset_x, offset_y, center_point, opacity, show_labels):
    settings = {
        'rotation': rotation,
        'grid_spacing': spacing,
        'grid_x_offset': offset_x,
        'grid_y_offset': offset_y,
        'center_point': center_point or {'x': 0, 'y': 0},
        'grid_opacity': opacity,
        'show_labels': show_labels
    }
    return dcc.send_string(json.dumps(settings, indent=2), 'grid_settings.json')


# ── Load grid settings ────────────────────────────────────────────────
@app.callback(
    [Output('rotation-slider', 'value'),
     Output('grid-spacing-slider', 'value'),
     Output('grid-x-offset-slider', 'value'),
     Output('grid-y-offset-slider', 'value'),
     Output('center-point-store', 'data'),
     Output('center-point-display', 'children'),
     Output('grid-opacity-slider', 'value'),
     Output('show-labels-check', 'value'),
     Output('status-text', 'children')],
    Input('upload-settings', 'contents'),
    prevent_initial_call=True
)
def load_settings(contents):
    if contents is None:
        raise dash.exceptions.PreventUpdate
    try:
        _, content_string = contents.split(',')
        decoded = base64.b64decode(content_string).decode('utf-8')
        s = json.loads(decoded)
        cp = s.get('center_point', {'x': 0.0, 'y': 0.0})
        # Backward compatibility for old spacing
        old_spacing = s.get('grid_spacing_x', s.get('grid_spacing', 229))
        return (
            s.get('rotation', 0),
            old_spacing,
            s.get('grid_x_offset', 0),
            s.get('grid_y_offset', 0),
            cp,
            f"Center Point: ({cp.get('x', 0)}, {cp.get('y', 0)})",
            s.get('grid_opacity', 0.7),
            s.get('show_labels', ['show']),
            '✅ Settings loaded successfully'
        )
    except Exception as e:
        return dash.no_update, dash.no_update, dash.no_update, \
               dash.no_update, dash.no_update, dash.no_update, \
               dash.no_update, dash.no_update, \
               f'❌ Error loading settings: {str(e)}'

# ── Server callback: Place Center Point ─────────────────────────────────
@app.callback(
    [Output('center-point-store', 'data', allow_duplicate=True),
     Output('center-point-display', 'children', allow_duplicate=True),
     Output('grid-x-offset-slider', 'value', allow_duplicate=True),
     Output('grid-y-offset-slider', 'value', allow_duplicate=True),
     Output('placement-mode', 'data', allow_duplicate=True),
     Output('placement-status', 'children')],
    [Input('image-graph', 'clickData'),
     Input('btn-place-center', 'n_clicks')],
    State('placement-mode', 'data'),
    prevent_initial_call=True
)
def update_offsets_from_click(clickData, btn_clicks, placement_mode):
    ctx = dash.callback_context
    if not ctx.triggered:
        raise dash.exceptions.PreventUpdate
        
    trigger_id = ctx.triggered[0]['prop_id']
    
    # If the user clicked the "Place Center Point" button
    if 'btn-place-center' in trigger_id:
        if placement_mode:
            return dash.no_update, dash.no_update, dash.no_update, dash.no_update, False, ''
        else:
            return dash.no_update, dash.no_update, dash.no_update, dash.no_update, True, 'Select a point on the image...'
    
    # If the user clicked somewhere on the image trace
    if 'clickData' in trigger_id and clickData:
        if placement_mode:
            try:
                pt = clickData['points'][0]
                cx, cy = round(pt['x'], 1), round(pt['y'], 1)
                return {'x': cx, 'y': cy}, f'Center Point: ({cx}, {cy})', 0, 0, False, ''
            except (KeyError, IndexError):
                pass

    raise dash.exceptions.PreventUpdate


# ── Server callback: Handle Keyboard Shortcuts ──────────────────────────
@app.callback(
    [Output('grid-x-offset-slider', 'value', allow_duplicate=True),
     Output('grid-y-offset-slider', 'value', allow_duplicate=True),
     Output('rotation-slider', 'value', allow_duplicate=True),
     Output('grid-spacing-slider', 'value', allow_duplicate=True),
     Output('grid-opacity-slider', 'value', allow_duplicate=True),
     Output('placement-mode', 'data', allow_duplicate=True),
     Output('placement-status', 'children', allow_duplicate=True)],
    Input('keypress-store', 'data'),
    [State('grid-x-offset-slider', 'value'),
     State('grid-y-offset-slider', 'value'),
     State('rotation-slider', 'value'),
     State('grid-spacing-slider', 'value'),
     State('grid-opacity-slider', 'value'),
     State('placement-mode', 'data')],
    prevent_initial_call=True
)
def handle_keypress(key_data, x_val, y_val, rot_val, space_val, op_val, placement_mode):
    if not key_data:
        raise dash.exceptions.PreventUpdate
        
    key = key_data.get('key')
    active_id = key_data.get('active_id')
    
    if key in ['w', 'W']:
        if placement_mode:
            return dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, False, ''
        else:
            return dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, True, 'Select a point on the image...'
            
    step = 1.0
    if key == 'ArrowLeft':
        return x_val - step, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
    elif key == 'ArrowRight':
        return x_val + step, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
    elif key == 'ArrowUp':
        return dash.no_update, y_val - step, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
    elif key == 'ArrowDown':
        return dash.no_update, y_val + step, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
        
    if key in ['+', '=', '-']:
        if not active_id:
            raise dash.exceptions.PreventUpdate
            
        direction = 1 if key in ['+', '='] else -1
        # Determine step size based on slider
        slider_step = 0.1 if active_id in ['grid-opacity-slider', 'rotation-slider'] else 1.0
        increment = slider_step * direction
        
        if active_id == 'grid-x-offset-slider':
            return x_val + increment, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
        elif active_id == 'grid-y-offset-slider':
            return dash.no_update, y_val + increment, dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update
        elif active_id == 'rotation-slider':
            return dash.no_update, dash.no_update, rot_val + increment, dash.no_update, dash.no_update, dash.no_update, dash.no_update
        elif active_id == 'grid-spacing-slider':
            return dash.no_update, dash.no_update, dash.no_update, space_val + increment, dash.no_update, dash.no_update, dash.no_update
        elif active_id == 'grid-opacity-slider':
            val = max(0.0, min(1.0, op_val + increment))
            return dash.no_update, dash.no_update, dash.no_update, dash.no_update, val, dash.no_update, dash.no_update
            
    raise dash.exceptions.PreventUpdate
# ── Server callback: Auto-Fit Grid ────────────────────────────────────────
@app.callback(
    [Output('rotation-slider', 'value', allow_duplicate=True),
     Output('grid-spacing-slider', 'value', allow_duplicate=True),
     Output('grid-x-offset-slider', 'value', allow_duplicate=True),
     Output('grid-y-offset-slider', 'value', allow_duplicate=True),
     Output('center-point-store', 'data', allow_duplicate=True),
     Output('center-point-display', 'children', allow_duplicate=True),
     Output('status-text', 'children', allow_duplicate=True)],
    Input('btn-autofit', 'n_clicks'),
    [State('grid-spacing-slider', 'value'),
     State('rotation-slider', 'value')],
    prevent_initial_call=True
)
def auto_fit_grid(n_clicks, hint_spacing, rotation):
    if not hint_spacing:
        return dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, "❌ Invalid spacing hint"
        
    current = _uploaded_image if _uploaded_image is not None else original_image
    
    # --- 1. Find Best Rotation ---
    # We sweep from rotation - 3.0 to rotation + 3.0 degrees
    # The optimal rotation will have maximum variance in the 1D projections (sharpest valleys)
    def evaluate_rotation(angle):
        rot_img = current.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=0)
        arr = np.array(rot_img.convert('L'))
        h, w = arr.shape
        # Dynamic crop for rotation: ~20 cells to avoid dense grid blurring
        target_cells = 20
        inner_size = min(h, w, max(200, int(hint_spacing * target_cells)))
        c_y, c_x = h // 2, w // 2
        inner = arr[c_y - inner_size//2 : c_y + inner_size//2, 
                    c_x - inner_size//2 : c_x + inner_size//2]
        
        px = np.sum(inner, axis=0)
        py = np.sum(inner, axis=1)
        
        # High-pass filter to ignore massive dark spots
        w_size = max(10, int(hint_spacing * 3))
        w_size = min(w_size, len(px))
        px = px - np.convolve(px, np.ones(w_size)/w_size, mode='same')
        py = py - np.convolve(py, np.ones(w_size)/w_size, mode='same')
        
        return np.var(px) + np.var(py)

    best_rotation = rotation
    best_var = -1
    # Coarse sweep (-3.0 to +3.0)
    for angle in np.arange(rotation - 3.0, rotation + 3.1, 0.1):
        v = evaluate_rotation(angle)
        if v > best_var:
            best_var = v
            best_rotation = angle
            
    # Fine sweep (+/- 0.1 around best coarse angle)
    best_fine_rotation = best_rotation
    best_fine_var = -1
    for angle in np.arange(best_rotation - 0.10, best_rotation + 0.11, 0.01):
        v = evaluate_rotation(angle)
        if v > best_fine_var:
            best_fine_var = v
            best_fine_rotation = round(angle, 2)

    # --- 2. Process with Best Rotation ---
    rotated = _get_rotated_pil(current, best_fine_rotation)
    
    # Convert to grayscale numpy array
    gray = np.array(rotated.convert('L'))
    h, w = gray.shape
    
    # To avoid edge distortion on dense grids, scale crop size to ~30 grid cells
    target_cells = 30
    crop_size = min(h, w, max(200, int(hint_spacing * target_cells)))
    center_y, center_x = h // 2, w // 2
    crop = gray[center_y - crop_size//2 : center_y + crop_size//2, 
                center_x - crop_size//2 : center_x + crop_size//2]
                
    proj_x = np.sum(crop, axis=0)
    proj_y = np.sum(crop, axis=1)
    
    def get_micro_spacing(profile, expected_range=(10, 50)):
        # High-pass filter to remove massive dark spots
        w_size = max(10, int(hint_spacing * 3))
        w_size = min(w_size, len(profile))
        profile = profile - np.convolve(profile, np.ones(w_size)/w_size, mode='same')
        # Autocorrelation
        autocorr = np.correlate(profile, profile, mode='full')
        autocorr = autocorr[len(autocorr)//2:]
        # Restrict to expected range around the hint, but don't be scared to search wide
        search_min = max(2, int(hint_spacing * 0.3))
        search_max = min(len(autocorr)-1, int(hint_spacing * 3.0))
        if search_min >= search_max:
            return None
            
        search = autocorr[search_min:search_max]
        if len(search) == 0:
            return None
        def get_subpixel_peak(arr):
            x = np.argmax(arr)
            if x == 0 or x == len(arr) - 1:
                return float(x)
            y1, y2, y3 = arr[x-1], arr[x], arr[x+1]
            denom = 2 * (y1 - 2*y2 + y3)
            if denom == 0:
                return float(x)
            dx = (y1 - y3) / denom
            return float(x + dx)
            
        return get_subpixel_peak(search) + search_min
        
    spacing_x = get_micro_spacing(proj_x)
    spacing_y = get_micro_spacing(proj_y)
    
    if spacing_x is None or spacing_y is None:
        return dash.no_update, dash.no_update, dash.no_update, dash.no_update, dash.no_update, "❌ Failed to detect micro-grid"
        
    # User specified "perfect square", so we average them
    spacing = (spacing_x + spacing_y) / 2.0
    
    # Find the dark spaces (valleys) using robust continuous Fourier Phase extraction
    def get_grid_offset(profile, sp):
        t = np.arange(len(profile))
        omega = 2 * np.pi / sp
        
        # Correlate with 1st Fourier component
        cos_val = np.sum(profile * np.cos(omega * t))
        sin_val = np.sum(profile * np.sin(omega * t))
        
        # Extract phase
        phi = np.arctan2(sin_val, cos_val)
        
        # The phase 'phi' gives the offset of the peaks (bright spots).
        # We want the valleys (dark spots), so we shift by half a period (pi).
        t_valley = (phi + np.pi) / omega
        return t_valley % sp
        
    offset_x_crop = get_grid_offset(proj_x, spacing)
    offset_y_crop = get_grid_offset(proj_y, spacing)
    
    # Map crop offset back to full image
    full_offset_x = (center_x - crop_size//2 + offset_x_crop) % spacing
    full_offset_y = (center_y - crop_size//2 + offset_y_crop) % spacing
    
    # We will clear the center point to (0,0) and just use the offsets
    cp = {'x': 0.0, 'y': 0.0}
    cp_text = f"Center Point: (0.0, 0.0)"
    
    return best_fine_rotation, spacing, full_offset_x, full_offset_y, cp, cp_text, f"✅ Auto-Fit: Perfect Square {spacing:.3f}px, Rot {best_fine_rotation}°"


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8051
    app.run(debug=True, port=port, dev_tools_hot_reload=False)
