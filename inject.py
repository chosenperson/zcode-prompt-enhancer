"""按当前安装包重建补丁；保留各版本原包，未知版本安全停止。"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

from build import Archive, rewrite, sha

ROOT = Path(__file__).resolve().parent
OUT = Path(os.environ['LOCALAPPDATA']) / 'ZCodePromptEnhancer' / 'packages' if os.environ.get('LOCALAPPDATA') else ROOT / 'out'
META = 'wb-enhance-install.json'
SUPPORTED = {
    '3.14.4': {
        'sha256': '172d6f333e61642ce3882250949fafe8180f75b5b8e5552244ca2c59ca05d14e',
        'asset': 'out/renderer/assets/styles-Qlp0Bew7.js',
        'marker': '(0,$.jsx)(ttt,{onChange:s,taskId:f})',
        'props': 'workspacePath:u,workspaceIdentity:d,taskId:f,disabled:t',
        'api': 'React:Q,jsx:$.jsx,useEditor:EL,useServices:({workspacePath,workspaceIdentity})=>B_(workspacePath,void 0,workspaceIdentity),getText:RR,undoCommand:hP,createPortal:iy.createPortal,modelProtocol:"selection"',
        'privacy_marker': 'u?(0,$.jsx)($en,{state:j}):null',
    },
    '3.14.1': {
        'sha256': 'c827c81c68211d9984688915b566ca180d36dc7c844b713a5f4d1725d1c66cd5',
        'asset': 'out/renderer/assets/styles-CuFc3dtZ.js',
        'marker': '(0,$.jsx)(Aet,{onChange:s,taskId:f})',
        'props': 'workspacePath:u,workspaceIdentity:d,taskId:f,disabled:t',
        'api': 'React:Q,jsx:$.jsx,useEditor:hI,useServices:({workspacePath,workspaceIdentity})=>p_(workspacePath,void 0,workspaceIdentity),getText:RR,undoCommand:mj,createPortal:zv.createPortal,modelProtocol:"selection"',
        'privacy_marker': 'u?(0,$.jsx)(hen,{state:j}):null',
    },
    '3.14.0': {
        'sha256': '8604b5f47b0f4bf9e900901d8c60a0dcf6406b89879da872640ae27026b628cb',
        'asset': 'out/renderer/assets/styles-0ZAopPCa.js',
        'marker': '(0,$.jsx)(ket,{onChange:s,taskId:f})',
        'props': 'workspacePath:u,workspaceIdentity:d,taskId:f,disabled:t',
        'api': 'React:Q,jsx:$.jsx,useEditor:EL,useServices:({workspacePath,workspaceIdentity})=>B_(workspacePath,void 0,workspaceIdentity),getText:RR,undoCommand:hP,createPortal:iy.createPortal,modelProtocol:"selection"',
        'privacy_marker': 'u?(0,$.jsx)(fen,{state:j}):null',
    },
    '3.12.1': {
        'sha256': '5116f9ae5dfeca84d4e272ed0f793fc37a8170fb3ba7bf42706d8c6b8161d6c8',
        'asset': 'out/renderer/assets/styles-qZK50qqU.js',
        'marker': '(0,$.jsx)(VLe,{onChange:s,taskId:f})',
        'props': 'workspacePath:u,workspaceIdentity:d,taskId:f,disabled:t',
        'api': 'React:Q,jsx:$.jsx,useEditor:oj,useServices:$n,getText:kN,undoCommand:dE,createPortal:mh.createPortal',
        'privacy_marker': 'u?(0,$.jsx)(Uwt,{state:E}):null',
    },
    '3.11.2': {
        'sha256': '14aa5db53b67a9f1b3cf9ecbd7fb314588ff928e5ed753b1f5249f4826fbc731',
        'asset': 'out/renderer/assets/styles-DyAcaLKy.js',
        'marker': '(0,$.jsx)(BPe,{onChange:s,taskId:f})',
        'props': 'workspacePath:u,workspaceIdentity:d,taskId:f,disabled:t',
        'api': 'React:Q,jsx:$.jsx,useEditor:Ix,useServices:Yr,getText:pO,undoCommand:QS,createPortal:Zp.createPortal',
        'privacy_marker': 'd?(0,$.jsx)(Fxt,{state:T}):null',
    }
}


def installation():
    # 新版用户安装优先；不再按 PATH 误选历史安装。
    exe = Path(os.environ['LOCALAPPDATA']) / 'Programs/ZCode/ZCode.exe'
    if not exe.is_file():
        raise RuntimeError('未找到用户安装的 ZCode；请用 --target 明确指定当前 resources/app.asar。')
    return exe.parent / 'resources/app.asar'


def check_closed():
    if os.name != 'nt':
        raise RuntimeError('自动安装和回滚目前仅支持 Windows。')
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                             "if(Get-Process -Name ZCode -ErrorAction SilentlyContinue){exit 9}"],
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('请先保存草稿并完全退出所有 ZCode，再运行注入启动器。不会强制结束任务。')


def inspect_source(target):
    archive = Archive(target)
    version = json.loads(archive.read('package.json'))['version']
    spec = SUPPORTED.get(version)
    if not spec:
        raise RuntimeError(f'ZCode {version} 尚未适配，保持原包不变。不能使用旧版程序包覆盖。')
    current = sha(target.read_bytes())
    entries = dict(archive.entries())
    metadata = json.loads(archive.read(META)) if META in entries else None
    source = target
    if metadata is not None:
        if (not isinstance(metadata, dict) or metadata.get('version') != version
                or metadata.get('sourceSha256') != spec['sha256']
                or not re.fullmatch(r'[0-9a-f]{64}', metadata.get('revision', ''))):
            raise RuntimeError('补丁元数据不匹配，保持当前程序包不变。')
        # 原包路径由版本和已知哈希确定，不信任包内给出的文件路径。
        source = OUT / version / spec['sha256'] / 'app.original.asar'
        if not source.is_file():
            raise RuntimeError('找不到本版本原包备份；请保留备份，并通过 --data-dir 指向原来的备份目录。')
        known_patch = source.with_name('app.wb-' + metadata['revision'][:12] + '.asar')
        if not known_patch.is_file() or sha(known_patch.read_bytes()) != current:
            raise RuntimeError('当前补丁包与本地已校验候选不一致，拒绝覆盖其他修改。请保留原包和候选备份。')
    if sha(source.read_bytes()) != spec['sha256']:
        raise RuntimeError('原包哈希不匹配：该构建尚未适配，未修改任何程序文件。')
    return version, spec, source, current, metadata


def candidate(source, spec, folder, version):
    archive = Archive(source)
    asset = archive.read(spec['asset']).decode('utf-8')
    if asset.count(spec['marker']) != 1 or 'data-composer-leading-content' not in asset:
        raise RuntimeError('输入框或底部工具栏挂载点不匹配。')
    privacy_marker = spec['privacy_marker']
    if asset.count(privacy_marker) != 1:
        raise RuntimeError('账号订阅徽标挂载点不唯一，未修改程序包。')
    # 只去掉账号名旁的徽标渲染，不改订阅数据、权限或设置页。
    asset = asset.replace(privacy_marker, 'null')
    enhancer = (ROOT / 'enhancer.mjs').read_bytes()
    templates = (ROOT / 'templates.mjs').read_bytes()
    revision = sha(enhancer + templates + json.dumps(spec, sort_keys=True).encode())
    destination = folder / ('app.wb-' + revision[:12] + '.asar')
    manifest_path = folder / 'manifest.json'
    if destination.is_file() and manifest_path.is_file():
        previous = json.loads(manifest_path.read_text(encoding='utf-8'))
        if (previous.get('candidate') == str(destination) and previous.get('verifiedAllEntries') is True
                and sha(destination.read_bytes()) == previous.get('candidateSha256')):
            return destination, json.loads(Archive(destination).read(META))
    module = 'wb-enhancer-' + revision[:12] + '.mjs'
    asset = asset.replace(spec['marker'], spec['marker'] + ',(0,$.jsx)(__WBEnhance,{' + spec['props'] + '})')
    asset += '\nimport {createEnhanceComponent as __wbFactory} from "./' + module + '";\n'
    asset += 'const __WBEnhance=__wbFactory({' + spec['api'] + '});\n'
    metadata = {'version': version, 'sourceSha256': spec['sha256'], 'revision': revision}
    replacements = {spec['asset']: asset.encode(), 'out/renderer/assets/' + module: enhancer,
                    'out/renderer/assets/templates.mjs': templates,
                    META: json.dumps(metadata).encode()}
    if not destination.exists():
        rewrite(archive, destination, replacements)
    patched = Archive(destination)
    for name, entry in archive.entries():
        if entry.get('unpacked') or 'link' in entry:
            continue
        expected = replacements.get(name)
        if expected is None:
            expected = archive.read(name)
        if patched.read(name) != expected:
            raise RuntimeError(f'原包条目校验失败：{name}')
    for name, data in replacements.items():
        if patched.read(name) != data:
            raise RuntimeError(f'补丁条目校验失败：{name}')
    return destination, metadata


def replace(target, replacement, expected_current):
    check_closed()
    if sha(target.read_bytes()) != expected_current:
        raise RuntimeError('构建期间安装包发生变化，请重新运行。')
    staged = target.with_name('app.wb-stage-' + uuid.uuid4().hex + '.asar')
    data = replacement.read_bytes()
    with staged.open('xb') as stream:
        stream.write(data)
    if sha(staged.read_bytes()) != sha(data):
        raise RuntimeError('暂存文件校验失败。')
    try:
        # 同目录原子替换，Windows 文件占用时失败，不主动结束进程。
        os.replace(staged, target)
    finally:
        if staged.exists():
            staged.unlink()
    if sha(target.read_bytes()) != sha(data):
        raise RuntimeError('安装后校验失败。')


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path)
    parser.add_argument('--data-dir', type=Path, help='备份和候选包目录；默认位于当前用户 LOCALAPPDATA。')
    parser.add_argument('--list-supported', action='store_true')
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--apply', action='store_true')
    actions.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    if args.list_supported:
        print(json.dumps({version:spec['sha256'] for version,spec in SUPPORTED.items()},indent=2))
        return
    if args.data_dir:
        OUT = args.data_dir.expanduser().resolve()
    target = (args.target or installation()).resolve(strict=True)
    version, spec, source, current, installed = inspect_source(target)
    folder = OUT / version / spec['sha256']
    folder.mkdir(parents=True, exist_ok=True)
    backup = folder / 'app.original.asar'
    if not backup.exists():
        with backup.open('xb') as stream:
            stream.write(source.read_bytes())
    if sha(backup.read_bytes()) != spec['sha256']:
        raise RuntimeError('备份校验失败。')
    if args.rollback:
        if installed is not None:
            replace(target, backup, current)
        print('原版已恢复。' if installed is not None else '当前已经是原版。')
        return
    result, metadata = candidate(backup, spec, folder, version)
    result_hash = sha(result.read_bytes())
    manifest = {'target': str(target), 'version': version, 'backup': str(backup),
                'candidate': str(result), 'candidateSha256': result_hash, 'verifiedAllEntries': True}
    (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    if current == result_hash:
        print(f'ZCode {version} 已安装当前补丁，无需重复注入。')
    elif args.apply:
        replace(target, result, current)
        print(f'ZCode {version} 底部工具栏补丁已安装，哈希校验通过。')
    else:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('停止：' + str(error))
        raise SystemExit(1)
