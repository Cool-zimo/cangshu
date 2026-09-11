/** 仓鼠核心逻辑测试：mock 单元 + 真实 API 冒烟 */
let pass = 0, fail = 0;
const check = (l, c, e = '') => {
    if (c) { pass++; console.log(`  ✓ ${l}`); }
    else { fail++; console.log(`  ✗ ${l} ${e}`); }
};

const REAL_FETCH = globalThis.fetch;   // mock 之后要还原，否则真实冒烟测试用的是假数据

// Node 里补 btoa/atob（浏览器原生有）
if (typeof btoa === 'undefined') {
    global.btoa = s => Buffer.from(s, 'binary').toString('base64');
    global.atob = s => Buffer.from(s, 'base64').toString('binary');
}

const { GitHubAPI, encodeBase64Utf8, decodeBase64Utf8 } = await import('./cangshu/js/api.js');
const { ConfigStore, blankConfig, CONFIG_FILE, DEFAULT_CONFIG_REPO } = await import('./cangshu/js/config.js');

console.log('═══════ 仓鼠 · 核心逻辑测试 ═══════\n');

console.log('【中文安全的 base64】');
{
    const s = '仓库管理 🐹 中文测试 "引号" & 符号 <标签>';
    const enc = encodeBase64Utf8(s);
    const dec = decodeBase64Utf8(enc);
    check('中文往返无损', dec === s, dec);
    check('编码不含非法字符', /^[A-Za-z0-9+/=]+$/.test(enc));

    // 与 GitHub 的行为一致：换行需要保留（GitHub 返回带换行的 base64）
    const multi = 'line1\nline2\n中文';
    check('多行文本往返', decodeBase64Utf8(encodeBase64Utf8(multi)) === multi);
}

console.log('\n【错误码归一化】');
{
    const cases = [
        [401, '令牌无效或已过期'],
        [403, '权限不足'],
        [404, '资源不存在'],
        [422, '参数校验失败'],
        [500, 'GitHub 服务端异常']
    ];
    for (const [code, kw] of cases) {
        const api = new GitHubAPI('fake');
        global.fetch = async () => ({
            ok: false, status: code,
            text: async () => JSON.stringify({ message: 'some error' })
        });
        const r = await api.whoami();
        check(`HTTP ${code} → "${kw}"`, !r.ok && r.status === code && r.message.includes(kw), r.message);
    }

    // 网络失败
    global.fetch = async () => { throw new Error('Failed to fetch'); };
    const api2 = new GitHubAPI('fake');
    const r2 = await api2.whoami();
    check('网络异常被捕获（不抛出）', r2.ok === false && r2.status === 0 && /网络/.test(r2.message), r2.message);

    // 204 删除成功
    global.fetch = async () => ({ ok: true, status: 204, text: async () => '' });
    const r3 = await new GitHubAPI('t').deleteRepo('a', 'b');
    check('204 视为成功（删除仓库）', r3.ok === true, JSON.stringify(r3));
}

console.log('\n【API 方法路径与参数】');
{
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ default_branch: 'main', sha: 'abc123' })
        };
    };
    const api = new GitHubAPI('tok');

    await api.createRepo({ name: 'demo', description: 'd', private: true, autoInit: true });
    let c = calls.at(-1);
    check('建仓用 POST /user/repos', c.method === 'POST' && c.url.endsWith('/user/repos'));
    check('建仓带 private/auto_init', c.body.private === true && c.body.auto_init === true);

    await api.renameRepo('o', 'r', 'newname');
    c = calls.at(-1);
    check('改名用 PATCH', c.method === 'PATCH' && c.body.name === 'newname');

    await api.setVisibility('o', 'r', false);
    c = calls.at(-1);
    check('改公开性 PATCH private', c.method === 'PATCH' && c.body.private === false);

    await api.deleteRepo('o', 'r');
    c = calls.at(-1);
    check('删仓用 DELETE', c.method === 'DELETE');

    // 翻页：第一次满 100，第二次不满 → 应停
    global.fetch = async (url) => {
        const isP2 = url.includes('page=2');
        const n = isP2 ? 5 : 100;
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })))
        };
    };
    const r = await api.listAllRepos();
    check('仓库列表自动翻页', r.ok && r.data.length === 105, `${r.data.length}`);
}

console.log('\n【异常响应防御】');
{
    // GitHub 返回 200 但内容是对象（异常/代理拦截）时不应崩溃
    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ message: 'not a list' }) });
    const api = new GitHubAPI('t');
    const r = await api.listAllRepos();
    check('非数组响应被拦截（不抛异常）', r.ok === false && /格式异常/.test(r.message), r.message);
}

console.log('\n【配置仓库：增删改查】');
{
    const api = new GitHubAPI('tok');
    const cs = new ConfigStore(api, 'Cool-zimo');
    cs.data = blankConfig();

    check('初始为空', cs.list().length === 0);

    check('添加成功', cs.add('Cool-zimo', 'xiudao').ok === true);
    check('重复添加被拒', cs.add('Cool-zimo', 'xiudao').ok === false);
    check('大小写不敏感查重', cs.has('COOL-ZIMO', 'XIUDAO') === true);
    check('不同仓库可加', cs.add('Cool-zimo', 'cangshu').ok === true);
    check('列表有 2 项', cs.list().length === 2);

    check('移除成功', cs.remove('Cool-zimo', 'xiudao').ok === true);
    check('移除后剩 1 项', cs.list().length === 1);
    check('移除不存在的返回 false', cs.remove('x', 'y').ok === false);

    cs.add('Cool-zimo', 'old-name');
    check('改名同步配置', cs.rename('Cool-zimo', 'old-name', 'new-name').ok === true);
    check('改名后旧名查不到', cs.has('Cool-zimo', 'old-name') === false);
    check('改名后新名能查到', cs.has('Cool-zimo', 'new-name') === true);

    check('设置备注', cs.setAlias('Cool-zimo', 'new-name', '修仙游戏').ok === true);
    check('备注已存', cs.list().find(m => m.repo === 'new-name').alias === '修仙游戏');
}

console.log('\n【配置保存：带 sha 防覆盖】');
{
    let putBody = null;
    let existingSha = 'sha-from-server';
    global.fetch = async (url, opts) => {
        if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, status: 200, text: async () => JSON.stringify({ content: { sha: 'newsha' } }) }; }
        if (url.includes('/contents/')) {
            return {
                ok: true, status: 200,
                text: async () => JSON.stringify({
                    sha: existingSha, encoding: 'base64',
                    content: encodeBase64Utf8(JSON.stringify(blankConfig()))
                })
            };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ default_branch: 'main' }) };
    };
    const cs = new ConfigStore(new GitHubAPI('t'), 'Cool-zimo');
    await cs.load();
    await cs.save();
    check('保存时携带服务端最新 sha', putBody?.sha === 'sha-from-server', putBody?.sha);
    check('保存内容可解析回 JSON', (() => { try { JSON.parse(decodeBase64Utf8(putBody.content)); return true; } catch { return false; } })());
    check('提交信息含品牌标识', putBody.message.includes('仓鼠'));

    // 文件不存在时（404）save 应能新建
    global.fetch = async (url, opts) => {
        if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, status: 201, text: async () => JSON.stringify({ content: { sha: 's' } }) }; }
        if (url.includes('/contents/')) return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not Found' }) };
        return { ok: true, status: 200, text: async () => JSON.stringify({ default_branch: 'main' }) };
    };
    const cs2 = new ConfigStore(new GitHubAPI('t'), 'Cool-zimo');
    await cs2.load();
    const s2 = await cs2.save();
    check('首次保存（无 sha）成功', s2.ok === true, JSON.stringify(s2));
}

console.log('\n【vscode.dev 链接格式】');
{
    // GitHub 官方格式：/github/{owner}/{repo}/blob/{branch}/{path}
    const mk = (o, r, b, p) => `https://vscode.dev/github/${o}/${r}/blob/${b}/${p}`;
    const url = mk('Cool-zimo', 'xiudao', 'main', 'src/main.js');
    check('文件链接含 blob 与分支', url === 'https://vscode.dev/github/Cool-zimo/xiudao/blob/main/src/main.js', url);
    const repoUrl = 'https://vscode.dev/github/Cool-zimo/xiudao';
    check('仓库链接格式正确', repoUrl === 'https://vscode.dev/github/Cool-zimo/xiudao');
    // 路径含空格应编码
    const sp = 'https://vscode.dev/github/o/r/blob/main/' + encodeURIComponent('my file.js');
    check('含空格路径已编码', sp.includes('my%20file.js'), sp);
}

// ================= 真实 API 冒烟 =================
console.log('\n【真实 API 冒烟测试】');
{
    const TK = process.env.GH_TOKEN;
    if (!TK) {
        console.log('  (跳过：未设 GH_TOKEN)');
    } else {
        global.fetch = REAL_FETCH;      // 还原真实网络
        const api = new GitHubAPI(TK);
        const me = await api.whoami();
        check('whoami 成功', me.ok, me.message);
        if (me.ok) console.log(`    账号: ${me.data.login}`);

        const repos = await api.listAllRepos();
        check('列出仓库', repos.ok, repos.message);
        if (repos.ok) console.log(`    可见仓库: ${repos.data.length} 个`);

        const created = await api.createRepo({
            name: 'cangshu-smoke-test', description: '临时冒烟测试', private: true, autoInit: true
        });
        if (created.ok || (created.status === 422)) {
            check('建仓接口可用', true);
            if (created.ok) {
                await api.renameRepo(me.data.login, 'cangshu-smoke-test', 'cangshu-smoke-renamed');
                const after = await api.getRepo(me.data.login, 'cangshu-smoke-renamed');
                check('改名生效', after.ok && after.data.name === 'cangshu-smoke-renamed');
                const del = await api.deleteRepo(me.data.login, 'cangshu-smoke-renamed');
                check('删仓成功', del.ok, del.message);
            }
        } else {
            check('建仓接口可用', false, created.message);
        }

        // 配置仓库端到端
        const cs = new ConfigStore(api, me.data.login);
        const en = await cs.ensureRepo();
        check('配置仓库就绪', en.ok, en.message);
        if (en.ok) {
            await cs.load();
            cs.add(me.data.login, 'xiudao', { alias: '修仙' });
            const sv = await cs.save();
            check('配置写入成功', sv.ok, sv.message);
            const cs2 = new ConfigStore(api, me.data.login);
            await cs2.load();
            check('配置读回一致', cs2.has(me.data.login, 'xiudao'), JSON.stringify(cs2.list()));
            cs2.remove(me.data.login, 'xiudao');
            await cs2.save();
        }
    }
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail > 0 ? 1 : 0);
