/** 路径编码测试 —— 空格/中文/# 都会让 URL 断掉 */
let pass=0, fail=0;
const check=(l,c,e='')=>{ c?(pass++,console.log(`  ✓ ${l}`)):(fail++,console.log(`  ✗ ${l} ${e}`)); };

const { encodePath, esc, timeAgo, fmtSize, fileIcon } = await import('./js/app.js');

console.log('═══════ 路径编码测试 ═══════\n');

console.log('【encodePath】');
check('普通路径不变', encodePath('src/main.js')==='src/main.js', encodePath('src/main.js'));
check('空格 → %20', encodePath('src ui.js')==='src%20ui.js', encodePath('src ui.js'));
check('# → %23', encodePath('a#b.js')==='a%23b.js', encodePath('a#b.js'));
check('中文正确编码', encodePath('中文/文件.js')==='%E4%B8%AD%E6%96%87/%E6%96%87%E4%BB%B6.js', encodePath('中文/文件.js'));
check('多级混合', encodePath('a b/c#d/e.js')==='a%20b/c%23d/e.js', encodePath('a b/c#d/e.js'));
check('斜杠保留', encodePath('a/b/c').split('/').length===3);
check('空串安全', encodePath('')==='');
check('不重复编码 %', encodePath('a%20b.js')==='a%2520b.js');   // % 本身需转义

console.log('\n【拼进 URL 后不断裂】');
{
  const u = `https://vscode.dev/github/o/r/blob/main/${encodePath('src ui.js')}`;
  check('URL 无空格', !u.includes(' '), u);
  check('URL 无裸 #（会被当片段）', !u.includes('#'), u);
  check('可被 URL 解析', /^https:\/\//.test(new URL(u).href));
}

console.log('\n【esc XSS 防御】');
{
  check('转义 <script>', esc('<script>alert(1)</script>')==='&lt;script&gt;alert(1)&lt;/script&gt;');
  check('转义双引号', esc('a"b')==='a&quot;b');
  check('转义单引号', esc("a'b")==='a&#39;b');
  check('转义 & ', esc('a&b')==='a&amp;b');
  check('null 安全', esc(null)==='');
  check('undefined 安全', esc(undefined)==='');
  check('数字可转', esc(123)==='123');
  // 真实攻击场景：仓库描述里的恶意内容
  const evil = '<img src=x onerror="alert(document.cookie)">';
  check('恶意描述被转义', !esc(evil).includes('<img'), esc(evil));
}

console.log('\n【格式化辅助】');
{
  check('时间：刚刚', timeAgo(new Date().toISOString())==='刚刚');
  check('时间：小时前', /小时前/.test(timeAgo(new Date(Date.now()-7200000).toISOString())));
  check('时间：天前', /天前/.test(timeAgo(new Date(Date.now()-172800000).toISOString())));
  check('时间：空值', timeAgo(null)==='');
  check('大小：KB', fmtSize(512)==='512 KB');
  check('大小：MB', fmtSize(2048)==='2.0 MB');
  check('大小：0', fmtSize(0)==='0 B');
  check('图标：js', fileIcon('a.js')==='📜');
  check('图标：未知', typeof fileIcon('a.xyz')==='string');
  check('图标：无扩展名', !!fileIcon('Makefile'));
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail>0?1:0);
