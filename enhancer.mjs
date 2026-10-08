// ZCode Prompt Enhancer. Only rewrites the current draft; never sends a chat message.
import { templates } from './templates.mjs';

export const VERSION = '0.5.0';
const MODE_KEY = 'wb-enhance-zcode.mode.v1';
const MODEL_EVENT = 'wb-enhance-zcode-model-change';
let recentResult = '';

export function documentKey(state) {
  return JSON.stringify(state.toJSON());
}

export function plainDocument(text) {
  const paragraph = value => ({type:'paragraph',version:1,format:'',indent:0,direction:null,
    children:value ? [{type:'text',version:1,text:value,format:0,detail:0,mode:'normal',style:''}] : []});
  return {root:{type:'root',version:1,format:'',indent:0,direction:null,
    children:text.split('\n\n').map(paragraph)}};
}

export function isPlainDraft(state) {
  function visit(node) {
    if (!['root','paragraph','text','linebreak','tab'].includes(node.type)) return false;
    if (node.type === 'text' && (node.format || node.mode && node.mode !== 'normal')) return false;
    return (node.children || []).every(visit);
  }
  return visit(state.toJSON().root);
}

export function enhancementPrompt(text, mode) {
  const system = mode === 'creative' ? templates.creativeSystem : templates.standardSystem;
  const user = mode === 'creative'
    ? templates.creativeUser.replace('{input}', () => JSON.stringify({instruction:text}))
    : templates.standardUser.replace('{input}', () => text);
  return `${system}\n\n${templates.layout}\n\n${user}`;
}

export function canApply({cancelled,originalKey,currentKey,originalContext,currentContext,connected,composing}) {
  return !cancelled && connected && !composing && originalKey === currentKey && originalContext === currentContext;
}

export function committedAction(editor, action, accept=()=>true) {
  return new Promise((resolve,reject)=>{
    let remove=()=>{};
    const timer=setTimeout(()=>{remove();reject(new Error('编辑器回填提交超时，请检查输入框。'));},2000);
    remove=editor.registerUpdateListener(({editorState})=>{if(!accept(editorState))return;remove();clearTimeout(timer);resolve(editorState);});
    try{action();}catch(error){remove();clearTimeout(timer);reject(error);}
  });
}

export function modelChoiceKey(selection) {
  return selection ? JSON.stringify([selection.providerId,selection.modelId]) : '';
}

export function modelPreferenceKey({workspacePath,workspaceIdentity}) {
  return 'wb-enhance-zcode.model.v1:'+JSON.stringify([workspaceIdentity || '',workspacePath || '']);
}

export function parseModelPreference(raw) {
  try {
    const value=JSON.parse(raw);
    if(!value || typeof value.providerId!=='string' || !value.providerId.trim() ||
      typeof value.modelId!=='string' || !value.modelId.trim())return null;
    const level=value.options?.reasoningLevel;
    return {providerId:value.providerId,modelId:value.modelId,
      ...(typeof level==='string' && level?{options:{reasoningLevel:level}}:{})};
  } catch { return null; }
}

export function listEnhancementModels(view) {
  const models=[],seen=new Set();
  for(const provider of view?.providers || []) {
    if(!provider.providerId || provider.config?.enabled===false || provider.config?.visibility==='hidden')continue;
    for(const model of provider.models || []) {
      if(!model.modelId || model.config?.enabled===false)continue;
      const reasoningLevels=[...new Set((model.config?.optionSpecs?.reasoningLevel?.values || [])
        .filter(value=>typeof value==='string' && value))];
      // 新版原生接口要求一个有效的 reasoningLevel；不展示无法构造合法请求的模型。
      if(!reasoningLevels.length)continue;
      const choice={providerId:provider.providerId,providerName:provider.providerName || provider.providerId,
        modelId:model.modelId,reasoningLevels};
      const key=modelChoiceKey(choice);
      if(!seen.has(key)){seen.add(key);models.push({...choice,key});}
    }
  }
  return models;
}

export function initialEnhancementSelection(model) {
  const level=['none','disabled','off','minimal','low','medium','high','xhigh','max']
    .find(value=>model.reasoningLevels.includes(value)) ?? model.reasoningLevels[0];
  return {providerId:model.providerId,modelId:model.modelId,options:{reasoningLevel:level}};
}

export function resolveEnhancementSelection(view, selected) {
  if(!selected)return view?.preferredSelection;
  const model=listEnhancementModels(view).find(model=>model.key===modelChoiceKey(selected));
  if(!model)throw new Error('增强模型已不可用，请在增强设置中重新选择，或改为跟随工作区默认模型。');
  if(!model.reasoningLevels.includes(selected.options?.reasoningLevel))
    throw new Error('增强模型的思考强度已变化，请在增强设置中重新选择。');
  return {providerId:model.providerId,modelId:model.modelId,options:{reasoningLevel:selected.options.reasoningLevel}};
}

export async function readEnhancementModel(services, scope, protocol, selected=null) {
  if (protocol === 'selection') {
    const view = await services.modelSelectionService.getView();
    return {model: resolveEnhancementSelection(view,selected), field: 'selection'};
  }
  const state = await services.zcodeSessionService.readWorkspaceState({...scope,preferWorkspaceDefaults:true});
  return {model: state?.settings?.model?.current, field: 'modelRef'};
}

export function createEnhanceComponent(api) {
  const {React:R,jsx:h,useEditor,useServices,getText,undoCommand,createPortal} = api;
  const buttonStyle = {fontSize:12,border:'1px solid #8885',borderRadius:6,padding:'3px 8px',background:'transparent',color:'inherit',cursor:'pointer'};
  const readMode = () => {try{return localStorage.getItem(MODE_KEY)==='creative'?'creative':'workbuddy';}catch{return 'workbuddy';}};
  const readChoice = key => {try{return parseModelPreference(localStorage.getItem(key));}catch{return null;}};
  const reasoningLabel = level => ({none:'不思考',disabled:'关闭思考',off:'关闭思考',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高'}[level] || level);
  return function WBEnhance({workspacePath,workspaceIdentity,taskId,disabled}) {
    const [editor] = useEditor();
    const services = useServices({workspacePath,workspaceIdentity});
    const context = JSON.stringify([workspacePath,workspaceIdentity || '',taskId || null]);
    const latest = R.useRef({});
    latest.current = {context,editor,services,disabled};
    const request = R.useRef(null);
    const undo = R.useRef(null);
    const alive = R.useRef(true);
    const [mode,setMode] = R.useState(readMode);
    const [busy,setBusy] = R.useState(false);
    const [message,setMessage] = R.useState('');
    const [panel,setPanel] = R.useState(false);
    const supportsModelChoice=api.modelProtocol==='selection';
    const preferenceKey=modelPreferenceKey({workspacePath,workspaceIdentity});
    const [preference,setPreference]=R.useState(()=>({key:preferenceKey,selection:readChoice(preferenceKey)}));
    const selectedModel=preference.key===preferenceKey?preference.selection:readChoice(preferenceKey);
    const modelService=services.modelSelectionService;
    const [catalogState,setCatalog]=R.useState({status:'idle',models:[]});
    const [catalogRevision,refreshCatalog]=R.useReducer(value=>value+1,0);
    const catalog=catalogState.key===preferenceKey && catalogState.service===modelService
      ?catalogState:{status:'loading',models:[]};
    const selectedChoice=catalog.models.find(model=>model.key===modelChoiceKey(selectedModel));
    const [mount,setMount] = R.useState(null);
    const [position,setPosition] = R.useState({left:12,bottom:60});
    const anchor = R.useRef(null);
    const popup = R.useRef(null);
    const [,redraw] = R.useReducer(x=>x+1,0);
    const announce = text => {if(alive.current)setMessage(text);};
    const invalidate = () => {if(request.current)request.current.cancelled=true;undo.current=null;};

    R.useEffect(()=>{
      alive.current=true;
      return ()=>{alive.current=false;invalidate();};
    },[]);
    R.useEffect(()=>{
      invalidate();
      redraw();
    },[context,editor]);
    R.useEffect(()=>{
      const reload=()=>setPreference({key:preferenceKey,selection:readChoice(preferenceKey)});
      const storageChanged=event=>{if(event.key===preferenceKey || event.key===null)reload();};
      const localChanged=event=>{if(event.detail?.key===preferenceKey)reload();};
      reload();
      window.addEventListener('storage',storageChanged);
      window.addEventListener(MODEL_EVENT,localChanged);
      return()=>{window.removeEventListener('storage',storageChanged);window.removeEventListener(MODEL_EVENT,localChanged);};
    },[preferenceKey]);
    R.useEffect(()=>{
      if(!panel || !supportsModelChoice || !workspacePath)return;
      let active=true,revision=0;
      const load=async()=>{
        const current=++revision;
        setCatalog({key:preferenceKey,service:modelService,status:'loading',models:[]});
        try {
          const view=await modelService.getView();
          if(active && current===revision)setCatalog({key:preferenceKey,service:modelService,status:'ready',
            models:listEnhancementModels(view),preferred:view?.preferredSelection});
        } catch {
          if(active && current===revision)setCatalog({key:preferenceKey,service:modelService,status:'error',models:[]});
        }
      };
      load();
      let subscription;
      try {subscription=modelService?.onDidChange?.(()=>{if(active)load();});} catch {}
      return()=>{active=false;subscription?.dispose?.();};
    },[panel,supportsModelChoice,workspacePath,preferenceKey,modelService,catalogRevision]);
    R.useEffect(()=>editor.registerUpdateListener(({editorState,tags})=>{
      const record=undo.current;
      if(record && (documentKey(editorState)!==record.afterKey || tags.has('historic'))) undo.current=null;
      redraw();
    }),[editor]);
    R.useEffect(()=>{
      let host=null;
      const attach=()=>{
        const form=editor.getRootElement()?.closest('form');
        const target=form?.querySelector('[data-composer-leading-content]');
        if(!target)return;
        if(host?.parentNode===target)return;
        host?.remove();
        host=document.createElement('span');
        host.style.cssText='display:inline-flex;align-items:center;flex-shrink:0;margin-left:4px';
        host.dataset.wbToolbar='true';
        target.appendChild(host);
        setMount(host);
      };
      const removeRoot=editor.registerRootListener(attach);
      const form=editor.getRootElement()?.closest('form');
      const observer=new MutationObserver(attach);
      if(form)observer.observe(form,{childList:true,subtree:true});
      attach();
      return()=>{observer.disconnect();removeRoot();host?.remove();};
    },[editor]);
    R.useEffect(()=>{
      if(!panel)return;
      const place=()=>{
        const box=anchor.current?.getBoundingClientRect();
        if(box){
          const left=Math.max(12,Math.min(box.left,window.innerWidth-352));
          const above=box.top-20,below=window.innerHeight-box.bottom-20;
          setPosition(above>=below?{left,bottom:window.innerHeight-box.top+8,maxHeight:Math.max(80,above)}:
            {left,top:box.bottom+8,maxHeight:Math.max(80,below)});
        }
      };
      const outside=e=>{if(!anchor.current?.contains(e.target)&&!popup.current?.contains(e.target))setPanel(false);};
      const key=e=>{if(e.key==='Escape'){e.stopPropagation();setPanel(false);anchor.current?.querySelector('button')?.focus();}};
      place();
      window.addEventListener('resize',place);
      document.addEventListener('scroll',place,true);
      document.addEventListener('pointerdown',outside);
      document.addEventListener('keydown',key,true);
      return()=>{window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};
    },[panel]);

    function eligible(record) {
      return record && record.context===context && !disabled && !busy && !editor.isComposing() &&
        documentKey(editor.getEditorState())===record.afterKey && editor.getRootElement()?.isConnected;
    }

    function chooseModel(selection) {
      setPreference({key:preferenceKey,selection});
      try {
        if(selection)localStorage.setItem(preferenceKey,JSON.stringify(selection));
        else localStorage.removeItem(preferenceKey);
        window.dispatchEvent(new CustomEvent(MODEL_EVENT,{detail:{key:preferenceKey}}));
      } catch {announce('增强模型已临时选择，但无法保存；重新打开后请再次选择。');}
    }

    async function enhance(event) {
      if(event?.detail>1)return;
      if(request.current){
        request.current.cancelled=true;
        announce('已停止等待并禁止回填；底层请求可能继续计费，结束前不会重复请求。');
        return;
      }
      if(disabled || editor.isComposing())return announce('请先结束输入法编辑，并等待输入框可编辑。');
      if(!workspacePath)return announce('请先打开工作区。');
      const original=editor.getEditorState();
      const draft=getText(original);
      if(!draft.trim())return announce('请先输入需要增强的草稿。');
      if(!isPlainDraft(original))return announce('草稿包含文件或技能引用、特殊格式；为避免损坏引用，请先改为纯文本再增强。');
      const job={cancelled:false,context,originalKey:documentKey(original),started:Date.now(),pending:true,done:false};
      request.current=job;
      undo.current=null;
      setBusy(true);
      announce(selectedModel && supportsModelChoice?'检查已选增强模型…':'读取工作区默认模型…');
      let deadline;
      try {
        const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>{job.cancelled=true;reject(new Error('增强超时，已禁止回填；底层请求可能仍在完成。'));},90000);});
        const work=(async()=>{
          const scope={workspacePath,...workspaceIdentity?{workspaceIdentity}:{}};
          const {model:modelRef,field}=await readEnhancementModel(services,scope,api.modelProtocol,selectedModel);
          if(!modelRef?.providerId || !modelRef?.modelId)throw new Error('未取得工作区默认模型，请先在 ZCode 中配置模型。');
          if(job.cancelled || latest.current.context!==context)throw new Error('任务已切换或操作已取消。');
          announce(`正在增强 · ${modelRef.modelId}`);
          const result=await services.zcodeAgentService.generateWorkspaceText({...scope,[field]:modelRef,
            prompt:enhancementPrompt(draft,mode),querySource:'prompt_enhance',
            maxOutputTokens:mode==='creative'?8192:4096,temperature:0.3});
          if(typeof result?.text!=='string' || !result.text.trim())throw new Error('模型没有返回完整的非空文本。');
          if(result.text.length>100000)throw new Error('结果过长，已禁止回填。');
          return result.text.trim();
        })();
        // 超时后仍锁住这轮底层调用，避免连续点击制造并发请求。
        work.finally(()=>{job.pending=false;if(job.done && request.current===job){request.current=null;if(alive.current)setBusy(false);}}).catch(()=>{});
        const text=await Promise.race([work,timeout]);
        recentResult=text;
        if(!alive.current)return;
        if(text===draft){announce('模型返回与原稿相同，已保留原稿。');return;}
        if(!canApply({cancelled:job.cancelled,originalKey:job.originalKey,currentKey:documentKey(editor.getEditorState()),
          originalContext:context,currentContext:latest.current.context,connected:!!editor.getRootElement()?.isConnected,
          composing:editor.isComposing()}) || latest.current.disabled){
          announce('增强完成，草稿或任务状态已变化；结果保留在“结果/设置”中，未覆盖输入框。');
          return;
        }
        const parsed=editor.parseEditorState(plainDocument(text));
        // 预填草稿可能早于 History 插件挂载，先为当前完整文档建立历史基线。
        // 清除克隆状态的选区，避免异步回填把焦点从别处抢回。
        await committedAction(editor,()=>editor.setEditorState(original.clone(null),{tag:'history-merge'}));
        if(job.cancelled || !alive.current || latest.current.context!==context || latest.current.disabled || editor.isComposing() ||
          documentKey(editor.getEditorState())!==job.originalKey || !editor.getRootElement()?.isConnected){
          announce('草稿状态已变化，未覆盖内容；请从“结果/设置”复制结果。');
          return;
        }
        const written=await committedAction(editor,()=>editor.setEditorState(parsed,{tag:'history-push'}),state=>getText(state)===text);
        if(getText(written)!==text)throw new Error('编辑器回填校验失败，请从“结果/设置”复制结果。');
        undo.current={context,beforeKey:job.originalKey,afterKey:documentKey(written)};
        announce(`已增强，用时 ${Math.round((Date.now()-job.started)/1000)} 秒；请检查后自行发送。`);
      } catch(error) {
        // 服务错误可能带请求体，避免直接呈现模型服务的原始报错。
        const safe=/^(增强超时|增强模型|未取得工作区|任务已切换|模型没有|结果过长|编辑器回填)/.test(error?.message || '');
        announce(safe?error.message:'增强失败，未自动提交聊天；请检查输入框、ZCode 模型连接或模型运行记录。');
      } finally {
        job.done=true;
        if(!job.pending && request.current===job){request.current=null;if(alive.current)setBusy(false);}
        clearTimeout(deadline);
        if(alive.current)redraw();
      }
    }

    async function restore() {
      const record=undo.current;
      if(!eligible(record))return announce('内容、任务或输入状态已变化，无法安全撤销。');
      undo.current=null;
      try {
      const restored=await committedAction(editor,()=>editor.dispatchCommand(undoCommand,undefined),state=>documentKey(state)===record.beforeKey);
      if(documentKey(restored)!==record.beforeKey){
        undo.current=null;
        announce('原生撤销记录与预期不同，请检查输入框；未执行额外覆盖。');
      } else {
        undo.current=null;
        announce('已恢复增强前的草稿；可用原生重做恢复增强结果。');
      }
      } catch { announce('原生撤销未提交，请检查输入框；未执行额外覆盖。'); }
      redraw();
    }

    const record=undo.current;
    if(!mount || !createPortal)return null;
    const modelGroups=new Map();
    for(const model of catalog.models){
      if(!modelGroups.has(model.providerId))modelGroups.set(model.providerId,{name:model.providerName,models:[]});
      modelGroups.get(model.providerId).models.push(model);
    }
    const selectStyle={...buttonStyle,background:'var(--color-popover, #252525)',width:'100%',minWidth:0,height:30};
    const toolStyle={...buttonStyle,border:0,padding:'4px 6px',height:28,display:'inline-flex',alignItems:'center',gap:4,opacity:disabled?0.45:0.85};
    const controls=h('span',{ref:anchor,'data-wb-enhance-zcode':VERSION,style:{display:'inline-flex',alignItems:'center',fontSize:12},children:[
      h('style',{children:'@keyframes wb-enhance-spin{to{transform:rotate(360deg)}} .wb-enhance-spinner{display:inline-block;box-sizing:border-box;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wb-enhance-spin .8s linear infinite}'}),
      h('button',{type:'button',style:toolStyle,disabled:busy?!!request.current?.cancelled:(disabled||!workspacePath),'aria-busy':busy&&!request.current?.cancelled,onMouseDown:e=>e.preventDefault(),onClick:enhance,
        onContextMenu:e=>{e.preventDefault();setPanel(true);},title:busy&&!request.current?.cancelled?'正在增强，点击停止等待':message||`增强草稿 · ${mode==='creative'?'创意增强':'标准增强'} · ${supportsModelChoice && selectedModel?selectedModel.modelId:'工作区默认模型'}`,
        children:busy?(request.current?.cancelled?'已停止':[h('span',{className:'wb-enhance-spinner','aria-hidden':true}),h('span',{children:'增强中'})]):'✧ 增强'}),
      h('button',{type:'button',style:{...toolStyle,padding:'4px 2px'},'aria-label':'增强设置和结果','aria-expanded':panel,onClick:()=>setPanel(!panel),children:'⌄'}),
      h('span',{role:'status',style:{position:'absolute',width:1,height:1,overflow:'hidden',clipPath:'inset(50%)'},children:message})
    ]});
    const dialog=panel?h('div',{ref:popup,role:'dialog','aria-label':'提示词增强',style:{position:'fixed',maxHeight:'60vh',...position,zIndex:10000,width:340,maxWidth:'calc(100vw - 24px)',overflow:'auto',boxSizing:'border-box',fontFamily:'inherit',fontSize:12,color:'var(--color-foreground, #d5d5d5)',background:'var(--color-popover, #252525)',border:'1px solid #8884',borderRadius:12,padding:14,boxShadow:'0 10px 32px #0005'},children:[
      h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12},children:[h('strong',{children:'提示词增强'}),h('button',{type:'button',style:buttonStyle,'aria-label':'关闭增强面板',onClick:()=>setPanel(false),children:'×'})]}),
      h('label',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'},children:['增强模式',h('select',{'aria-label':'提示词增强模式',style:{...buttonStyle,background:'var(--color-popover, #252525)'},value:mode,disabled:busy,onChange:e=>{setMode(e.target.value);try{localStorage.setItem(MODE_KEY,e.target.value);}catch{}},children:[h('option',{value:'workbuddy',children:'标准增强'}),h('option',{value:'creative',children:'创意增强'})]})]}),
      supportsModelChoice?h('div',{style:{marginTop:12,display:'grid',gap:8},children:[
        h('label',{style:{display:'grid',gap:6},children:['增强模型',h('select',{'aria-label':'增强模型',style:selectStyle,
          value:modelChoiceKey(selectedModel),disabled:busy || !workspacePath || catalog.status==='loading',onChange:e=>{
            const choice=catalog.models.find(model=>model.key===e.target.value);
            if(!e.target.value)chooseModel(null);else if(choice)chooseModel(initialEnhancementSelection(choice));
          },children:[h('option',{value:'',children:'跟随工作区默认模型'+(catalog.preferred?` · ${catalog.preferred.modelId}`:'')}),
            selectedModel && !selectedChoice?h('option',{value:modelChoiceKey(selectedModel),disabled:true,
              children:`${selectedModel.modelId}（${catalog.status==='ready'?'已不可用':'待确认'}）`}):null,
            ...Array.from(modelGroups,([id,group])=>h('optgroup',{label:group.name,children:group.models.map(model=>
              h('option',{value:model.key,children:model.modelId},model.key))},id))]})]}),
        selectedChoice?h('label',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},children:['思考强度',
          h('select',{'aria-label':'增强思考强度',style:{...selectStyle,width:160},value:selectedModel.options?.reasoningLevel || '',disabled:busy,
            onChange:e=>chooseModel({providerId:selectedChoice.providerId,modelId:selectedChoice.modelId,options:{reasoningLevel:e.target.value}}),
            children:[!selectedChoice.reasoningLevels.includes(selectedModel.options?.reasoningLevel)?h('option',{value:selectedModel.options?.reasoningLevel || '',disabled:true,children:'请重新选择'}):null,
              ...selectedChoice.reasoningLevels.map(level=>h('option',{value:level,children:reasoningLabel(level)},level))]})]}):null,
        h('div',{style:{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'},children:[
          h('span',{style:{opacity:0.7},children:catalog.status==='loading'?'正在读取模型列表…':catalog.status==='error'?'模型列表读取失败，请重试。':`${catalog.models.length} 个可选模型`}),
          h('button',{type:'button',style:buttonStyle,disabled:busy || catalog.status==='loading',onClick:()=>refreshCatalog(),children:'刷新模型列表'})]})
      ]}):null,
      h('p',{style:{opacity:0.6,margin:'10px 0',lineHeight:1.6},children:supportsModelChoice
        ?'模型选择按工作区保存，仅用于增强草稿。新选模型优先使用较低的思考强度，可在上方调整。'
        :'使用工作区默认模型，仅增强当前草稿。当前旧版暂不支持单独选择增强模型。'}),
      message?h('p',{style:{lineHeight:1.6},children:message}):null,
      recentResult?h('textarea',{'aria-label':'最近增强结果',readOnly:true,value:recentResult,rows:6,style:{boxSizing:'border-box',width:'100%',resize:'vertical',padding:8,borderRadius:6,background:'transparent',color:'inherit',border:'1px solid #8884'}}):null,
      h('div',{style:{display:'flex',gap:8,marginTop:10},children:[
        record?h('button',{type:'button',style:buttonStyle,disabled:!eligible(record),onMouseDown:e=>e.preventDefault(),onClick:restore,children:'↶ 撤销增强'}):null,
        recentResult?h('button',{type:'button',style:buttonStyle,onClick:async()=>{try{await navigator.clipboard.writeText(recentResult);announce('已复制结果。');}catch{announce('复制失败，请在结果框中手动选择复制。');}},children:'复制结果'}):null
      ]})
    ]}):null;
    return h(R.Fragment,{children:[createPortal(controls,mount),dialog?createPortal(dialog,document.body):null]});
  };
}
