/**
 * 右键菜单定位测试
 * 覆盖：右下角/左下角/右上角/超大菜单/极小视口/滚动后坐标
 */
import fs from 'fs';
let pass=0,fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log(`  ✓ ${l}`)):(fail++,console.log(`  ✗ ${l} ${e}`));};

/** 伪造视口与元素 */
function mkEnv(vw, vh, w, h){
    const style={};
    const el={
        offsetWidth:w, offsetHeight:h,
        style:{ setProperty(){}, },
    };
    // style 需要可写属性
    el.style = {};
    const store={};
    const win={
        innerWidth:vw, innerHeight:vh,
        document:{documentElement:{clientWidth:vw, clientHeight:vh}},
        location:{}, history:{}, localStorage:{getItem:()=>null,setItem(){}}
    };
    const code=fs.readFileSync(new URL('./js/bridge.js', import.meta.url),'utf8');
    new Function('window','globalThis',code)(win,win);
    return {B:win.Bridge, el, style:el.style};
}

console.log('═══════ 右键菜单定位测试 ═══════\n');

console.log('【① 空间充足：不翻转，原位】');
{
    const {B,el}=mkEnv(1200,800,200,300);
    const r=B.placeMenu(el, 100, 100);
    check('x 不变', r.x===100, String(r.x));
    check('y 不变', r.y===100, String(r.y));
    check('未翻转', !r.flippedX && !r.flippedY);
    check('left 已写入样式', el.style.left==='100px', el.style.left);
}

console.log('\n【② 右下角：双向翻转】');
{
    const {B,el}=mkEnv(1200,800,200,300);
    const r=B.placeMenu(el, 1180, 760);   // 距右 20、距下 40，都放不下
    check('水平翻转', r.flippedX===true);
    check('垂直翻转', r.flippedY===true);
    check('右边界不溢出', r.x + 200 <= 1200, `right=${r.x+200}`);
    check('下边界不溢出', r.y + 300 <= 800, `bottom=${r.y+300}`);
    check('翻转后 x = 光标左侧', r.x < 1180, String(r.x));
    check('翻转后 y = 光标上方', r.y < 760, String(r.y));
}

console.log('\n【③ 仅右侧放不下】');
{
    const {B,el}=mkEnv(1200,800,200,300);
    const r=B.placeMenu(el, 1150, 100);
    check('只翻转 X', r.flippedX===true && !r.flippedY);
    check('不溢出右边', r.x+200<=1200);
    check('y 保持原位', r.y===100, String(r.y));
}

console.log('\n【④ 仅下方放不下】');
{
    const {B,el}=mkEnv(1200,800,200,300);
    const r=B.placeMenu(el, 100, 700);
    check('只翻转 Y', r.flippedY===true && !r.flippedX);
    check('不溢出下边', r.y+300<=800);
    check('x 保持原位', r.x===100, String(r.x));
}

console.log('\n【⑤ 菜单比视口还大 → 收缩 + 滚动】');
{
    const {B,el,style}=mkEnv(400,300,600,500);   // 菜单 600x500 > 视口 400x300
    const r=B.placeMenu(el, 380, 280);
    check('限制最大宽度', style.maxWidth==='388px', style.maxWidth);
    check('限制最大高度', style.maxHeight==='288px', style.maxHeight);
    check('允许垂直滚动', style.overflowY==='auto', style.overflowY);
    check('收缩后不溢出右', r.x+388<=400+1, `${r.x+388}`);
    check('收缩后不溢出下', r.y+288<=300+1, `${r.y+288}`);
}

console.log('\n【⑥ 极小视口不崩】');
{
    const {B,el}=mkEnv(120,80,200,300);
    let r=null,threw=null;
    try{ r=B.placeMenu(el,115,75); }catch(e){ threw=e; }
    check('不抛异常', !threw, threw?.message);
    check('x 不为负', r && r.x>=0, String(r?.x));
    check('y 不为负', r && r.y>=0, String(r?.y));
}

console.log('\n【⑦ 光标在视口外（负值/超大）】');
{
    const {B,el}=mkEnv(1200,800,200,300);
    const r1=B.placeMenu(el,-50,100);
    check('负 x 被夹到边距', r1.x>=6, String(r1.x));
    const r2=B.placeMenu(el,100,-50);
    check('负 y 被夹到边距', r2.y>=6, String(r2.y));
    const r3=B.placeMenu(el,99999,99999);
    check('超大 x 不越界', r3.x+200<=1200, String(r3.x));
    check('超大 y 不越界', r3.y+300<=800, String(r3.y));
}

console.log('\n【⑧ 动画原点跟随翻转】');
{
    const {B,el,style}=mkEnv(1200,800,200,300);
    B.placeMenu(el,100,100);
    check('不翻转时原点左上', style.transformOrigin==='top left', style.transformOrigin);
    B.placeMenu(el,1180,760);
    check('双向翻转时原点右下', style.transformOrigin==='bottom right', style.transformOrigin);
}

console.log('\n【⑨ 重复调用不残留上次收缩】');
{
    // 同一视口：先用超大菜单触发收缩，再换成小菜单，应完全重置
    const {B,el,style}=mkEnv(400,300,600,500);
    B.placeMenu(el,100,100);
    check('大菜单触发收缩', style.maxHeight==='288px', style.maxHeight);
    check('大菜单触发横向收缩', style.maxWidth==='388px', style.maxWidth);

    el.offsetWidth=120; el.offsetHeight=60;   // 换成小菜单
    B.placeMenu(el,100,100);
    check('小菜单已重置 maxHeight', style.maxHeight==='', `"${style.maxHeight}"`);
    check('小菜单已重置 maxWidth', style.maxWidth==='', `"${style.maxWidth}"`);
    check('小菜单已重置 overflowY', style.overflowY==='', `"${style.overflowY}"`);
    check('小菜单原位不翻转', el.style.left==='100px', el.style.left);
}

console.log('\n【⑩ 菜单生命周期（Bridge.createMenu）】');
{
    const fs2=(await import('fs')).default;
    function mkDoc(){
        const store={};
        const els=[];
        const doc={
            body:{
                appendChild(el){ els.push(el); },
                removeChild(el){ const i=els.indexOf(el); if(i>=0) els.splice(i,1); }
            },
            createElement(tag){
                return {
                    tag, className:'', children:[], _html:'',
                    style:{},
                    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                                contains(c){return this._s.has(c);} },
                    innerHTML:'', textContent:'',
                    appendChild(c){ this.children.push(c); },
                    remove(){ const i=els.indexOf(this); if(i>=0) els.splice(i,1); },
                    addEventListener(){}, removeEventListener(){},
                    // createMenu 会往 .ctx-label 写文本、对 .has-sub 调 classList，
                    // 这里返回带完整接口的占位元素
                    querySelector(){ return {
                        textContent:'',
                        classList:{ _s:new Set(), add(c){this._s.add(c);},
                                    remove(c){this._s.delete(c);},
                                    contains(c){return this._s.has(c);} }
                    }; },
                    querySelectorAll(){ return []; },
                    getBoundingClientRect(){ return {left:0,top:0,right:0,bottom:0,width:180,height:200}; },
                    setAttribute(){}, contains(){ return false; }
                };
            },
            addEventListener(){}, removeEventListener(){},
            documentElement:{clientWidth:1200,clientHeight:800}
        };
        return {doc, els};
    }

    const code=fs2.readFileSync('./js/bridge.js','utf8');
    const {doc, els}=mkDoc();
    const win={
        innerWidth:1200, innerHeight:800, document:doc,
        location:{pathname:'/cangshu/',origin:'https://x',search:''},
        history:{replaceState(){}},
        localStorage:{getItem:()=>null,setItem(){}}
    };
    new Function('window','globalThis',code)(win,win);
    const B=win.Bridge;

    // 关键回归：show() 内部的清理不得触发 onClose，
    // 否则调用方句柄被置空 → 后续 hide() 无效 → 菜单关不掉
    let closeCount=0;
    const m=B.createMenu([{label:'A',onClick(){}}],{onClose:()=>{closeCount++;}});
    check('show 前未触发 onClose', closeCount===0, `${closeCount} 次`);
    m.show(10,10);
    check('show 后仍未触发 onClose（关键）', closeCount===0, `${closeCount} 次`);
    check('show 后菜单已挂载', !!m._el());
    m.hide();
    check('hide 后触发 onClose 一次', closeCount===1, `${closeCount} 次`);
    check('hide 后菜单已卸载', !m._el());

    // 重复 show 不残留
    const m2=B.createMenu([{label:'B'}]);
    m2.show(10,10); m2.show(20,20);
    check('重复 show 只有一个菜单', els.filter(e=>e.className&&e.className.indexOf('ctx-menu')===0).length===1,
        `${els.filter(e=>e.className&&e.className.indexOf('ctx-menu')===0).length} 个`);
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail>0?1:0);
