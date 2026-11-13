"""Export a reviewable source archive from explicit allowlists; never include user photos/runtimes."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
parent = root.parent
standalone_workflow = root / '.github/workflows/build-surveyapps.yml'
workflow = standalone_workflow if standalone_workflow.exists() else (parent / '.github/workflows/build-surveyapps.yml')
rel_base = root if standalone_workflow.exists() else parent
out = root/'dist'
out.mkdir(exist_ok=True)
version = json.loads((root/'package.json').read_text())['version']
archive = out/f'SurveyApps-{version}-source.zip'
files = []
for name in ('README.md', 'INSTALL.md', 'DELIVERY.md', '.gitignore', 'package.json', 'package-lock.json', 'requirements-build.txt'):
    p = root/name
    if p.exists():
        files.append(p)
for name in ('assets', 'backend', 'desktop', 'renderer', 'scripts', 'tests', 'docs', 'vendor'):
    for p in (root/name).rglob('*'):
        if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc' and p.name != '.DS_Store':
            assert 'samples' not in p.relative_to(root).parts
            files.append(p)
if workflow.exists():
    files.append(workflow)
for name in ('desktop-dmg-arm64-final.json', 'desktop-dmg-x64-rosetta.json',
             'lead-science-final.log', 'backend-lifecycle.log', 'original-grid.json', 'vendor-grid.json', 'architectures.txt', 'zip-integrity.json'):
    p = root/'test-results'/name
    if p.exists():
        files.append(p)
manifest = {}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(files):
        name = p.relative_to(rel_base).as_posix()
        data = p.read_bytes()
        manifest[name] = hashlib.sha256(data).hexdigest()
        info=zipfile.ZipInfo(name,date_time=(2026,11,13,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644 << 16
        z.writestr(info,data)
    z.writestr('SOURCE_MANIFEST.sha256.json',json.dumps(manifest,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert not any('/samples/' in n or '/.venv' in n or '/node_modules/' in n or '/.claude/' in n for n in z.namelist())
print(f'{archive.name}: {len(files)} source/evidence files, {archive.stat().st_size} bytes; archive integrity PASS')
