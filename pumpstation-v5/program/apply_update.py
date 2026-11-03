"""Offline update applier. Runs before app startup from start.bat.
Never touches ../data. Applies the newest staged ZIP containing VERSION.json.
"""
import zipfile, json, shutil, sys
from pathlib import Path
PROGRAM=Path(__file__).resolve().parent
DATA=PROGRAM.parent/'data'
UPD=DATA/'updates'
DONE=DATA/'updates-applied'

def main():
    if not UPD.exists(): return
    packages=sorted(UPD.glob('*.zip'), key=lambda p:p.stat().st_mtime, reverse=True)
    for pkg in packages:
        try:
            with zipfile.ZipFile(pkg) as z:
                names=z.namelist()
                vfile=next((n for n in names if n.endswith('VERSION.json')), None)
                if not vfile: continue
                prefix=vfile[:-len('VERSION.json')]
                for info in z.infolist():
                    if info.is_dir(): continue
                    n=info.filename
                    if not n.startswith(prefix): continue
                    rel=n[len(prefix):]
                    if not rel or rel.startswith('/') or '..' in Path(rel).parts: continue
                    if rel.startswith('data/'): continue
                    target=PROGRAM/rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(info) as src, open(target,'wb') as dst: shutil.copyfileobj(src,dst)
            DONE.mkdir(exist_ok=True)
            shutil.move(str(pkg), str(DONE/pkg.name))
            print('بروزرسانی اعمال شد:', pkg.name)
        except Exception as e:
            print('خطا در اعمال بروزرسانی:', e, file=sys.stderr)
if __name__=='__main__': main()
