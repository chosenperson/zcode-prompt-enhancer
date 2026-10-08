import assert from 'node:assert/strict';
import {readEnhancementModel,listEnhancementModels,initialEnhancementSelection,
  resolveEnhancementSelection,modelChoiceKey,modelPreferenceKey,parseModelPreference} from './enhancer.mjs';
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS '+name);}
const model=(id,levels,extra={})=>({modelId:id,config:{optionSpecs:{reasoningLevel:{values:levels}},...extra}});
const selection={providerId:'mock',modelId:'test',options:{reasoningLevel:'high'}};
const fast={providerId:'mock',modelId:'fast',options:{reasoningLevel:'none'}};
const view={preferredSelection:selection,providers:[
  {providerId:'mock',providerName:'Mock provider',models:[model('test',['low','high']),model('fast',['high','none','low'])]},
  {providerId:'second',providerName:'Another provider',models:[model('fast',['low','high'])]}
]};
const services={modelSelectionService:{getView:async()=>view}};

await test('跟随默认时保留原生模型和思考选项',async()=>{
  assert.deepEqual(await readEnhancementModel(services,{},'selection'),{model:selection,field:'selection'});
});
await test('显式选模型只改变本次增强请求，不改工作区默认',async()=>{
  const before=JSON.stringify(view);
  assert.deepEqual(await readEnhancementModel(services,{},'selection',fast),{model:fast,field:'selection'});
  assert.equal(JSON.stringify(view),before);
});
await test('供应商模型同名时保持独立身份',()=>{
  const catalog=listEnhancementModels(view);
  assert.equal(catalog.length,3);
  assert.notEqual(catalog[1].key,catalog[2].key);
  assert.equal(catalog[2].providerName,'Another provider');
});
await test('优先选择模型明确支持的低思考强度',()=>{
  const catalog=listEnhancementModels(view);
  assert.deepEqual(initialEnhancementSelection(catalog[1]),fast);
  assert.equal(initialEnhancementSelection(catalog[2]).options.reasoningLevel,'low');
});
await test('未知思考枚举保留模型可用值，不编造关闭值',()=>{
  assert.equal(initialEnhancementSelection({providerId:'x',modelId:'y',reasoningLevels:['automatic']}).options.reasoningLevel,'automatic');
});
await test('隐藏或停用供应商、停用模型和无合法思考值的模型不展示',()=>{
  assert.deepEqual(listEnhancementModels({providers:[
    {providerId:'hidden',config:{visibility:'hidden'},models:[model('x',['low'])]},
    {providerId:'off',config:{enabled:false},models:[model('x',['low'])]},
    {providerId:'test',models:[model('off',['low'],{enabled:false}),model('empty',[])]}
  ]}),[]);
});
await test('重复模型和重复思考值去重',()=>{
  const catalog=listEnhancementModels({providers:[{providerId:'x',models:[model('y',['low','low']),model('y',['low'])]}]});
  assert.equal(catalog.length,1);
  assert.deepEqual(catalog[0].reasoningLevels,['low']);
});
await test('选定模型被移除时阻止请求，不回退默认模型',()=>{
  assert.throws(()=>resolveEnhancementSelection({preferredSelection:selection,providers:[]},fast),/增强模型已不可用/);
});
await test('每次增强重新检查模型是否仍可用',async()=>{
  let current=view;
  const live={modelSelectionService:{getView:async()=>current}};
  await readEnhancementModel(live,{},'selection',fast);
  current={preferredSelection:selection,providers:[]};
  await assert.rejects(()=>readEnhancementModel(live,{},'selection',fast),/增强模型已不可用/);
});
await test('失效或缺失的思考选项要求重新选择',()=>{
  assert.throws(()=>resolveEnhancementSelection(view,{...fast,options:{reasoningLevel:'ultra'}}),/思考强度已变化/);
  assert.throws(()=>resolveEnhancementSelection(view,{providerId:'mock',modelId:'fast'}),/思考强度已变化/);
});
await test('存储解析仅保留模型标识与思考值',()=>{
  assert.deepEqual(parseModelPreference(JSON.stringify({...fast,apiKey:'do-not-store',options:{reasoningLevel:'none',secret:'drop'}})),fast);
});
await test('损坏的本地选择安全恢复为跟随默认',()=>{
  for(const raw of [null,'','bad','null','{}','{"providerId":1,"modelId":"x"}'])assert.equal(parseModelPreference(raw),null);
});
await test('工作区和远端身份分别隔离保存的模型',()=>{
  assert.notEqual(modelPreferenceKey({workspacePath:'a'}),modelPreferenceKey({workspacePath:'b'}));
  assert.notEqual(modelPreferenceKey({workspacePath:'a',workspaceIdentity:'remote1'}),modelPreferenceKey({workspacePath:'a',workspaceIdentity:'remote2'}));
});
await test('模型标识中的分隔符不会串成另一个模型',()=>{
  assert.notEqual(modelChoiceKey({providerId:'a/b',modelId:'c'}),modelChoiceKey({providerId:'a',modelId:'b/c'}));
});
await test('旧版继续使用原生 modelRef 默认协议',async()=>{
  let called;
  const legacy={zcodeSessionService:{readWorkspaceState:async args=>{called=args;return {settings:{model:{current:selection}}};}}};
  assert.deepEqual(await readEnhancementModel(legacy,{workspacePath:'mock'},undefined,fast),{model:selection,field:'modelRef'});
  assert.deepEqual(called,{workspacePath:'mock',preferWorkspaceDefaults:true});
});
await test('空默认模型和服务失败不构造替代模型',async()=>{
  assert.equal((await readEnhancementModel({modelSelectionService:{getView:async()=>({})}},{},'selection')).model,undefined);
  await assert.rejects(()=>readEnhancementModel({modelSelectionService:{getView:async()=>{throw Error('unavailable');}}},{},'selection',fast),/unavailable/);
});
console.log(`TOTAL ${passed} MODEL CHECKS PASS`);
