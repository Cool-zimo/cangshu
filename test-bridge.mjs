/** 验证联动桥：同源令牌互认、URL 计算、参数传递 */
let pass=0,fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log(`  ✓ ${l}`)):(fail++,console.log(`  ✗ ${l} ${e}`));};

// 伪造浏览器环境
function mkWin(pathname){
    const store={};
    return {
        location:{ origin:'https://cool-zimo.github.io', pathname, search:'', href:'' },
        localStorage:{
            getItem:k=>k in store?store[k]:null,
            setItem:(k,v)=>{store[k]=String(v);},
            removeItem:k=>{delete store[k];},
            _store:store
        },
        history:{replaceState(){}}
    };
}
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const fs = await import('fs');

function loadBridge(win){
    const code=fs.readFileSync(new URL('./js/bridge.js', import.meta.url),'utf8');
    new Function('window','globalThis','module',code)(win,win,{exports:null});
    return win.Bridge;
}

console.log('═══════ 联动桥测试 ═══════\n');

console.log('【① 应用识别】');
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    check('cangshu 下识别为仓鼠', B.current()?.id==='cangshu', B.current()?.id);
    check('对方是 GitHub Drive', B.other()?.id==='drive', B.other()?.id);
    check('对方 seg 正确', B.other()?.seg==='github_drive');
}
{
    const w=mkWin('/github_drive/'); const B=loadBridge(w);
    check('drive 下识别为 GitHub Drive', B.current()?.id==='drive');
    check('对方是仓鼠', B.other()?.id==='cangshu');
}

console.log('\n【② URL 计算】');
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    B.go();
    check('从仓鼠跳到 drive（带来源标记）', w.location.href==='https://cool-zimo.github.io/github_drive/?from=cangshu', w.location.href);
}
{
    const w=mkWin('/github_drive/index.html'); const B=loadBridge(w);
    B.go();
    check('从 drive 跳到仓鼠（不继承 index.html）', w.location.href==='https://cool-zimo.github.io/cangshu/?from=drive', w.location.href);
}
{
    const w=mkWin('/github_drive/sub/dir/page.html'); const B=loadBridge(w);
    B.go();
    check('深层路径也只保留第一段', w.location.href==='https://cool-zimo.github.io/cangshu/?from=drive', w.location.href);
}
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    B.go({repo:'Cool-zimo/xiudao'});
    check('跳转带参数', w.location.href.includes('repo=Cool-zimo%2Fxiudao'), w.location.href);
}

console.log('\n【③ 令牌互认（核心）】');
{
    // 场景：用户先在 GitHub Drive 登录过
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    w.localStorage.setItem('github_drive_token','ghp_fromdrive123');
    w.localStorage.setItem('github_drive_user',JSON.stringify({login:'Cool-zimo'}));
    check('仓鼠能发现 drive 的令牌', B.findToken()==='ghp_fromdrive123', B.findToken());
    check('识别为对方已登录', B.otherHasToken()===true);
    const u=B.findUser();
    check('能读到对方用户名', u?.login==='Cool-zimo', JSON.stringify(u));
}
{
    // 反向：先在仓鼠登录
    const w=mkWin('/github_drive/'); const B=loadBridge(w);
    w.localStorage.setItem('cangshu.token','github_pat_fromcangshu');
    check('drive 能发现仓鼠的令牌', B.findToken()==='github_pat_fromcangshu', B.findToken());
    check('识别为对方已登录', B.otherHasToken()===true);
}
{
    // 优先用自己的
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    w.localStorage.setItem('cangshu.token','ghp_mine');
    w.localStorage.setItem('github_drive_token','ghp_other');
    check('优先用本应用令牌', B.findToken()==='ghp_mine', B.findToken());
}

console.log('\n【④ 令牌同步】');
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    B.saveToken('ghp_shared',{login:'Cool-zimo'});
    check('写入 drive 的位置', w.localStorage.getItem('github_drive_token')==='ghp_shared');
    check('写入 cangshu 的位置', w.localStorage.getItem('cangshu.token')==='ghp_shared');
    check('两边用户名都写了',
        JSON.parse(w.localStorage.getItem('github_drive_user')).login==='Cool-zimo' &&
        JSON.parse(w.localStorage.getItem('cangshu.user')).login==='Cool-zimo');
}

console.log('\n【⑤ 边界与安全】');
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    check('无令牌时返回 null', B.findToken()===null);
    w.localStorage.setItem('cangshu.token','not-a-token');
    check('拒绝非 ghp_/github_pat_ 格式', B.findToken()===null, B.findToken());
}
{
    const w=mkWin('/'); const B=loadBridge(w);
    check('未知路径不崩', B.current()===null);
    check('未知路径 go() 返回 false', B.go()===false);
}
{
    // localStorage 不可用（隐私模式）
    const w=mkWin('/cangshu/');
    w.localStorage={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
    let B=null, threw=null;
    try{ B=loadBridge(w); B.findToken(); }catch(e){ threw=e; }
    check('localStorage 被禁时不抛异常', !threw, threw?.message);
}
{
    const w=mkWin('/cangshu/'); const B=loadBridge(w);
    const h=B.switchButtonHtml();
    check('生成切换按钮 HTML', h.includes('app-switch-btn') && h.includes('📁'), h.slice(0,60));
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail>0?1:0);
