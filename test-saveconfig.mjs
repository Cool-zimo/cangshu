/**
 * saveConfig 递归回归测试
 *
 * 事故：helper 内部误写 this.saveConfig() 调用自身，
 * 导致任何一次配置保存都无限递归 → 栈溢出 → 保存失败。
 * 表现就是"加了仓库，刷新后又没了"。
 */
let pass=0,fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log(`  ✓ ${l}`)):(fail++,console.log(`  ✗ ${l} ${e}`));};
const fs=(await import('fs')).default;

console.log('═══════ saveConfig 递归回归 ═══════\n');

/** 精确截取 saveConfig 方法体（大括号配对） */
function extractSaveConfig(){
    const src=fs.readFileSync('./js/app.js','utf8');
    const start=src.indexOf('async saveConfig()');
    if(start<0) throw new Error('未找到 saveConfig');
    let i=src.indexOf('{', start), depth=0, end=-1;
    for(let k=i;k<src.length;k++){
        if(src[k]==='{') depth++;
        else if(src[k]==='}'){ depth--; if(depth===0){ end=k; break; } }
    }
    if(end<0) throw new Error('括号未配对');
    return src.slice(i+1, end);   // 只要方法体
}


console.log('【① 静态检查：不得自调用】');
{
    const src=fs.readFileSync('./js/app.js','utf8');
    const i=src.indexOf('async saveConfig()');
    const body=src.slice(i, i+1200);
    check('方法体内不出现 this.saveConfig()', !body.includes('await this.saveConfig()'));
    check('方法体内调用 config.save()', body.includes('await this.config.save()'));
}

console.log('\n【② 行为验证：能真正保存】');
{
    // 模拟 App：只取 saveConfig 的逻辑
    const methodSrc=extractSaveConfig();

    let calls=0;
    const fake={
        offlineConfig:false,
        config:{ save: async()=>{ calls++; return {ok:true}; } },
        _saveLocalConfig(){},
        toast(){},
        ...(()=>{ const o={}; new Function('o','return o')(o); return o; })()
    };
    // 把方法挂到 fake 上
    const fn=new Function('return async function(){'+methodSrc+'}');
    const saveConfig=fn();

    let r=null, threw=null;
    try { r=await saveConfig.call(fake); } catch(e){ threw=e; }
    check('调用不抛异常', !threw, threw?.message);
    check('config.save 恰好被调用 1 次', calls===1, `${calls} 次`);
    check('返回 ok', r?.ok===true, JSON.stringify(r));
}

console.log('\n【③ 离线模式走本地，不碰远程】');
{
    const methodSrc=extractSaveConfig();
    const fn=new Function('return async function(){'+methodSrc+'}');
    const saveConfig=fn();

    let localSaved=0, remoteCalls=0;
    const fake={
        offlineConfig:true,
        config:{ save: async()=>{ remoteCalls++; return {ok:true}; } },
        _saveLocalConfig(){ localSaved++; },
        toast(){}
    };
    const r=await saveConfig.call(fake);
    check('离线时不调用远程', remoteCalls===0, `${remoteCalls} 次`);
    check('离线时写入本地', localSaved===1, `${localSaved} 次`);
    check('离线也返回 ok', r?.ok===true);
}

console.log('\n【④ 远程失败自动降级本地】');
{
    const methodSrc=extractSaveConfig();
    const fn=new Function('return async function(){'+methodSrc+'}');
    const saveConfig=fn();

    let localSaved=0, toastMsg='';
    const fake={
        offlineConfig:false,
        config:{ save: async()=>({ok:false,message:'403'}) },
        _saveLocalConfig(){ localSaved++; },
        toast(m){ toastMsg=m; }
    };
    const r=await saveConfig.call(fake);
    check('远程失败后落本地', localSaved===1, `${localSaved} 次`);
    check('切到离线模式', fake.offlineConfig===true);
    check('给出提示', /本地/.test(toastMsg), toastMsg);
    check('仍返回 ok（不阻断用户）', r?.ok===true);
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail>0?1:0);
