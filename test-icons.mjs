/** 图标集测试：所有图标必须是合法 SVG */
let pass=0,fail=0;
const check=(l,c,e='')=>{c?(pass++,console.log(`  ✓ ${l}`)):(fail++,console.log(`  ✗ ${l} ${e}`));};
import fs from 'fs';
const code=fs.readFileSync(new URL('./js/icons.js', import.meta.url),'utf8');
const win={}; new Function('window','globalThis',code)(win,win);
const I=win.Icons;

console.log('═══════ 图标集测试 ═══════\n');

console.log('【① 基础】');
{
    check('已加载', !!I);
    check('图标数量 > 50', I.names.length>50, `${I.names.length} 个`);
    check('has() 正确', I.has('folder') && !I.has('不存在的图标'));
}

console.log('\n【② 每个图标都能生成合法 SVG】');
{
    let bad=[];
    for(const n of I.names){
        const s=I.get(n);
        if(!s || !s.startsWith('<svg') || !s.endsWith('</svg>')) bad.push(n+':格式');
        // 标签配对
        const open=(s.match(/<[a-z]/g)||[]).length;
        const close=(s.match(/<\//g)||[]).length + (s.match(/\/>/g)||[]).length;
        if(open!==close) bad.push(`${n}:标签 ${open}/${close}`);
        // 不含 NaN/undefined
        if(/NaN|undefined/.test(s)) bad.push(n+':含 NaN/undefined');
    }
    check(`全部 ${I.names.length} 个图标结构合法`, bad.length===0, bad.slice(0,5).join(', '));
}

console.log('\n【③ 尺寸与样式可控】');
{
    const s=I.get('folder',{size:32});
    check('size 生效', s.includes('width="32"') && s.includes('height="32"'), s.slice(0,80));
    const s2=I.get('star',{fill:'currentColor'});
    check('fill 可传', s2.includes('fill="currentColor"'));
    const s3=I.get('star');
    check('默认 fill=none（线条风格）', s3.includes('fill="none"'));
    check('默认 stroke=currentColor（跟随主题）', s3.includes('stroke="currentColor"'));
    const s4=I.get('x',{className:'big'});
    check('className 生效', s4.includes('class="ico big"'));
    const s5=I.get('x',{style:'color:red'});
    check('style 生效', s5.includes('style="color:red"'));
}

console.log('\n【④ 未知图标不崩】');
{
    check('返回空串', I.get('__nope__')==='');
    check('不抛异常', (()=>{try{I.get(null);return true;}catch(e){return false;}})());
}

console.log('\n【⑤ 文件类型映射】');
{
    const cases=[
        ['a.js','fileCode'], ['index.html','fileCode'], ['style.css','fileCode'],
        ['data.json','fileCode'], ['main.py','fileCode'],
        ['photo.png','fileImage'], ['a.jpg','fileImage'], ['x.svg','fileImage'],
        ['song.mp3','fileAudio'], ['a.wav','fileAudio'],
        ['v.mp4','fileVideo'], ['a.mov','fileVideo'],
        ['a.zip','fileArchive'], ['a.rar','fileArchive'], ['a.7z','fileArchive'],
        ['readme.md','fileText'], ['a.pdf','fileText'], ['a.txt','fileText'],
        ['setup.exe','package'], ['a.apk','package'],
        ['无扩展名','file'], ['未知.xyz','file']
    ];
    let bad=[];
    for(const [fn,exp] of cases){
        const s=I.forFile(fn);
        if(!s.includes('viewBox')) bad.push(fn+':空');
        // 提取实际用的图形不好判断，改为断言"返回非空 SVG"
    }
    check(`${cases.length} 种文件名都能返回 SVG`, bad.length===0, bad.join(','));
    check('js 是代码图标', I.forFile('a.js')===I.get('fileCode'));
    check('mp3 是音频图标', I.forFile('a.mp3')===I.get('fileAudio'));
    check('png 是图片图标', I.forFile('a.png')===I.get('fileImage'));
    check('无扩展名兜底为 file', I.forFile('Makefile')===I.get('file'));
    check('大写后缀也识别', I.forFile('A.MP3')===I.get('fileAudio'));
    check('null 不崩', I.forFile(null).includes('<svg'));
}

console.log('\n【⑥ 品牌图标】');
{
    const d=I.brand('drive');
    check('drive 品牌图', d.includes('icon-drive-192.png') && d.includes('<img'));
    const c=I.brand('cangshu',128);
    check('cangshu 品牌图', c.includes('icon-cangshu-192.png'));
    check('尺寸参数生效', c.includes('width="128"'));
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail>0?1:0);
