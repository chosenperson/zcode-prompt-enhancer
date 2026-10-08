"""从新版备份提取发布资产，用真实 React/Lexical 和模拟模型验证界面。"""
import re
import sys
from pathlib import Path
from build import Archive
from inject import OUT, ROOT, SUPPORTED

version = sys.argv[1] if len(sys.argv)>1 else '3.11.2'
spec = SUPPORTED[version]
archive = Archive(OUT / version / spec['sha256'] / 'app.original.asar')
test = OUT / 'ui-test'
toast = 'toast-jrHAH957.js' if version=='3.12.1' else 'toast-q6BVfrvy.js'
if version in ('3.14.0','3.14.1','3.14.4'):
    toast = 'imeComposition-OIGqj3TL.js'
pending = [spec['asset'], 'out/renderer/assets/'+toast]
done = set()
entries = dict(archive.entries())
while pending:
    name = pending.pop()
    if name in done:
        continue
    done.add(name)
    data = archive.read(name)
    target = test / name.removeprefix('out/renderer/')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    if name.endswith('.js'):
        for ref in re.findall(r'["\x27`]\./([^"\x27`]+)["\x27`]', data.decode()):
            dependency = str(Path(name).parent / ref).replace('\\', '/')
            if dependency in entries:
                pending.append(dependency)
with (test / spec['asset'].removeprefix('out/renderer/')).open('a', encoding='utf-8') as stream:
    symbols = 'React:Q,jsx:$.jsx,Composer:BPe,Input:TFe,ContentEditable:kFe,History:IFe,useEditor:oj,getText:kN,undoCommand:dE,createPortal:mh.createPortal' if version=='3.12.1' else 'React:Q,jsx:$.jsx,Composer:$Ae,Input:Zje,ContentEditable:tMe,History:cMe,useEditor:Ix,getText:pO,undoCommand:QS,createPortal:Zp.createPortal'
    if version in ('3.14.0','3.14.1'):
        symbols = 'React:Q,jsx:$.jsx,Composer:h8e,Input:E5e,ContentEditable:M5e,History:B5e,useEditor:EL,getText:RR,undoCommand:hP,createPortal:iy.createPortal,modelProtocol:"selection"'
    if version=='3.14.1':
        symbols = 'React:Q,jsx:$.jsx,Composer:w5e,Input:l7e,ContentEditable:p7e,History:b7e,useEditor:hI,getText:RR,undoCommand:mj,createPortal:zv.createPortal,modelProtocol:"selection"'
    if version=='3.14.4':
        symbols = 'React:Q,jsx:$.jsx,Composer:B8e,Input:Z5e,ContentEditable:r7e,History:d7e,useEditor:EL,getText:RR,undoCommand:hP,createPortal:iy.createPortal,modelProtocol:"selection"'
    stream.write('\nexport const __wbUITest={'+symbols+'};\n')
for name in ['enhancer.mjs', 'templates.mjs']:
    (test / 'assets' / name).write_bytes((ROOT / name).read_bytes())
html=(ROOT / 'test-toolbar.html').read_text(encoding='utf-8')
if version=='3.12.1':
    html=html.replace('styles-DyAcaLKy.js','styles-qZK50qqU.js').replace('A as client','j as client').replace('toast-q6BVfrvy.js',toast)
if version in ('3.14.0','3.14.1','3.14.4'):
    html=html.replace('styles-DyAcaLKy.js','styles-0ZAopPCa.js').replace('A as client','b as client').replace('toast-q6BVfrvy.js',toast)
    html=html.replace('const services={zcodeSessionService:', "const services={modelSelectionService:{getView:async()=>({preferredSelection:{providerId:'mock',modelId:'mock-test',options:{reasoningLevel:'high'}}})},zcodeSessionService:")
    html=html.replace('generateWorkspaceText:async()=>{', "generateWorkspaceText:async request=>{if(!request.selection?.options||request.modelRef)throw Error('新版模型参数不匹配');")
if version=='3.14.1':
    html=html.replace('styles-0ZAopPCa.js','styles-CuFc3dtZ.js')
if version=='3.14.4':
    html=html.replace('styles-0ZAopPCa.js','styles-Qlp0Bew7.js')
(test / 'index.html').write_text(html,encoding='utf-8')
if version in ('3.14.0','3.14.1','3.14.4'):
    picker_html=(ROOT / 'test-model-picker.html').read_text(encoding='utf-8')
    picker_html=picker_html.replace('styles-DyAcaLKy.js',Path(spec['asset']).name)
    picker_html=picker_html.replace('A as client','b as client').replace('toast-q6BVfrvy.js',toast)
    (test / 'model-picker.html').write_text(picker_html,encoding='utf-8')
print(f'界面测试已准备：{test}，发布资产 {len(done)} 个')
