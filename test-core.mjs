import assert from 'node:assert/strict';
import {plainDocument,isPlainDraft,enhancementPrompt,canApply,documentKey,committedAction} from './enhancer.mjs';
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const state=text=>({toJSON:()=>plainDocument(text)});
test('双换行与有效空白不被压缩',()=>{
  const doc=plainDocument('a  b\n行2\n\n第三段\n');
  assert.equal(doc.root.children[0].children[0].text,'a  b\n行2');
  assert.equal(doc.root.children[1].children[0].text,'第三段\n');
});
test('仅允许可安全回填的纯文本文档',()=>{
  assert.equal(isPlainDraft(state('你好')),true);
  assert.equal(isPlainDraft({toJSON:()=>({root:{type:'root',children:[{type:'mention'}]}})}),false);
  assert.equal(isPlainDraft({toJSON:()=>({root:{type:'root',children:[{type:'text',format:1}]}})}),false);
});
test('特殊替换字符原样进入 WorkBuddy 草稿',()=>{
  const draft="C:\\test\\a.js $& $' $`\n  原始错误";
  assert.ok(enhancementPrompt(draft,'workbuddy').includes(draft));
});
test('创意模板按 JSON 封装草稿',()=>{
  const draft='修复 "test"\n保留';
  assert.ok(enhancementPrompt(draft,'creative').includes(JSON.stringify({instruction:draft})));
});
const valid={cancelled:false,originalKey:'a',currentKey:'a',originalContext:'x',currentContext:'x',connected:true,composing:false};
test('同任务同草稿允许回填',()=>assert.equal(canApply(valid),true));
for(const [name,change] of Object.entries({取消:{cancelled:true},手动改稿:{currentKey:'b'},切换任务:{currentContext:'y'},编辑器失效:{connected:false},输入法编辑:{composing:true}})){
  test(name+'阻止回填',()=>assert.equal(canApply({...valid,...change}),false));
}
test('文档指纹保留换行和空格差异',()=>assert.notEqual(documentKey(state('a b')),documentKey(state('a  b'))));
{
  const listeners=new Set();
  const editor={registerUpdateListener:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const restored=await committedAction(editor,()=>{
    for(const fn of [...listeners])fn({editorState:'旧状态'});
    queueMicrotask(()=>{for(const fn of [...listeners])fn({editorState:'撤销完成'});});
  },value=>value==='撤销完成');
  test('忽略原生撤销的中间提交，只确认目标文档',()=>assert.equal(restored,'撤销完成'));
  test('提交完成后移除临时监听器',()=>assert.equal(listeners.size,0));
}
console.log(`TOTAL ${passed} PASS`);
