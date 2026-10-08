"""Export only allowlisted public files; never export workspace history or application assets."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import zipfile

ROOT=Path(__file__).resolve().parent


def public_files():
    names=ROOT.joinpath('public-files.txt').read_text(encoding='utf-8').splitlines()
    result=[]
    for name in names:
        if not name or name.startswith('#'):continue
        path=PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name:
            raise RuntimeError('Invalid public path: '+name)
        source=ROOT.joinpath(*path.parts)
        if not source.is_file():raise RuntimeError('Missing public file: '+name)
        data=source.read_bytes()
        text=data.decode('utf-8-sig')
        checks={
            'personal Windows path':r'(?i)[a-z]:[\\/]+Users[\\/]+(?!Public[\\/])[^\\/\s]+',
            'access token':r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,})',
            'private key':r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----',
        }
        for label,pattern in checks.items():
            if re.search(pattern,text):raise RuntimeError(label+' detected in '+name)
        result.append((name,data))
    if len(result)!=len({name for name,_ in result}):raise RuntimeError('Duplicate public filename')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--zip',type=Path,required=True)
    args=parser.parse_args()
    files=public_files()
    if args.output.exists() or args.zip.exists():raise RuntimeError('Choose new output paths; existing output is preserved.')
    version=re.search(r"VERSION = '([^']+)'",ROOT.joinpath('enhancer.mjs').read_text(encoding='utf-8')).group(1)
    args.output.mkdir(parents=True)
    args.zip.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.zip,'x',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,data in files:
            target=args.output/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(data)
            archive.writestr('zcode-prompt-enhancer-'+version+'/'+name,data)
    digest=hashlib.sha256(args.zip.read_bytes()).hexdigest()
    checksum=args.zip.with_name(args.zip.name+'.sha256')
    checksum.write_text(digest+'  '+args.zip.name+'\n',encoding='utf-8')
    print(f'Exported {len(files)} public text files: {args.output}')
    print(f'ZIP: {args.zip}\nSHA256: {digest}')


if __name__=='__main__':main()
