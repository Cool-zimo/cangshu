/**
 * 浏览器加载测试 —— 专门抓「能跑单元测试、但线上白屏」的问题
 * 用 jsdom 真实跑一遍 index.html + app.js 的启动链路
 */
import { createRequire } from 'module';
const require = createRequire('/usr/local/lib/node_modules/');
const { JSDOM } = require('jsdom');
import fs from 'fs';

let pass = 0, fail = 0;
const check = (l, c, e = '') => {
    if (c) { pass++; console.log(`  ✓ ${l}`); }
    else { fail++; console.log(`  ✗ ${l} ${e}`); }
};

const ROOT = new URL('.', import.meta.url).pathname;

// ---------- mock 环境 ----------
const USER = { login: 'Cool-zimo', avatar_url: 'https://x/a.png', name: 'Feng Zimo' };
const REPOS = [
    { full_name: 'Cool-zimo/xiudao', name: 'xiudao', private: false, description: '修仙',
      default_branch: 'main', language: 'JavaScript', size: 2400, stargazers_count: 3,
      forks_count: 0, open_issues_count: 0, pushed_at: '2026-09-06T10:00:00Z',
      updated_at: '2026-09-06T10:00:00Z', created_at: '2026-08-01T10:00:00Z',
      archived: false, fork: false, html_url: 'https://github.com/Cool-zimo/xiudao' },
    { full_name: 'Cool-zimo/cangshu', name: 'cangshu', private: false, description: '仓鼠',
      default_branch: 'main', language: 'CSS', size: 30, stargazers_count: 0,
      forks_count: 0, open_issues_count: 0, pushed_at: '2026-09-11T10:00:00Z',
      updated_at: '2026-09-11T10:00:00Z', created_at: '2026-09-11T10:00:00Z',
      archived: false, fork: false, html_url: 'https://github.com/Cool-zimo/cangshu' },
    { full_name: 'Cool-zimo/lk', name: 'lk', private: true, description: '',
      default_branch: 'main', language: null, size: 545, stargazers_count: 0,
      forks_count: 0, open_issues_count: 0, pushed_at: '2026-08-25T10:00:00Z',
      updated_at: '2026-08-25T10:00:00Z', created_at: '2026-08-25T10:00:00Z',
      archived: false, fork: false, html_url: 'https://github.com/Cool-zimo/lk' }
];

const TREE = { tree: [
    { path: 'src', type: 'tree', sha: 'a' },
    { path: 'README.md', type: 'blob', size: 100, sha: 'b' },
    { path: 'src/main.js', type: 'blob', size: 2048, sha: 'c' },
    { path: 'src ui.js', type: 'blob', size: 512, sha: 'd' }   // 含空格，测编码
] };

let fetchLog = [];
function makeFetch(opts = {}) {
    return async (url, init) => {
        const m = String(url);
        const method = init?.method || 'GET';
        fetchLog.push(`${method} ${m}`);
        const json = (obj, status = 200) => ({
            ok: status < 400, status,
            text: async () => JSON.stringify(obj)
        });
        if (m.endsWith('/user')) return json(USER);
        if (m.includes('/user/repos?')) return json(REPOS);
        if (m.includes('/pages') && method === 'GET') {
            // xiudao 有 Pages，其余没有
            if (m.includes('/xiudao/')) return json({ html_url: 'https://cool-zimo.github.io/xiudao/', status: 'built', build_type: 'legacy' });
            return json({ message: 'Not Found' }, 404);
        }
        if (m.includes('/commits?')) return json([{ sha: 'abc1234567890', commit: { message: 'feat: 新功能\n\n详细说明', author: { name: 'zimo', date: '2026-09-06T10:00:00Z' } } }]);
        if (m.includes('/git/trees/')) return json(TREE);
        if (m.includes('/contents/cangshu.json')) {
            if (method === 'PUT') return json({ content: { sha: 'newsha' } }, 201);
            return json({ message: 'Not Found' }, 404);
        }
        if (m.includes('/contents/README.md') && method === 'GET') {
            return json({ sha: 's1', encoding: 'base64', content: Buffer.from('# 测试\n中文内容').toString('base64') });
        }
        if (m.includes('/repos/Cool-zimo/cangshu-config')) {
            return json({ default_branch: 'main', name: 'cangshu-config' });
        }
        // 已知仓库返回详情；其余（如 ghost-repo）返回 404 → 应被标记为失效
        const dm = m.match(/\/repos\/Cool-zimo\/([A-Za-z0-9._-]+)(\?|$)/);
        if (dm && method === 'GET' && !m.includes('/contents/') && !m.includes('/git/')
            && !m.includes('/pages') && !m.includes('/commits')) {
            const found = REPOS.find(r => r.name === dm[1]);
            if (found) return json(found);
            return json({ message: 'Not Found' }, 404);
        }
        return json({});
    };
}

// ---------- 构建 jsdom ----------
function buildDom() {
    const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
    const dom = new JSDOM(html, { url: 'https://cool-zimo.github.io/cangshu/', pretendToBeVisual: true });
    const w = dom.window;
    // jsdom 没有 canvas / clipboard，补最小实现
    w.HTMLCanvasElement.prototype.getContext = () => null;
    Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async () => {} }, configurable: true
    });
    w.confirm = () => true;
    w.alert = () => {};
    // localStorage jsdom 已支持
    return dom;
}

async function boot(opts = {}) {
    const dom = buildDom();
    const w = dom.window;
    w.fetch = makeFetch(opts);
    global.window = w;
    global.document = w.document;
    global.localStorage = w.localStorage;
    global.navigator = w.navigator;
    global.fetch = w.fetch;
    global.btoa = s => Buffer.from(s, 'binary').toString('base64');
    global.atob = s => Buffer.from(s, 'base64').toString('binary');
    global.HTMLElement = w.HTMLElement;
    global.getComputedStyle = w.getComputedStyle.bind(w);

    const { App } = await import(ROOT + 'js/app.js');
    const app = new App();
    app.init();
    return { dom, w, app };
}

console.log('═══════ 仓鼠 · 浏览器加载测试 ═══════\n');

console.log('【页面骨架】');
{
    const { w } = await boot();
    const d = w.document;
    check('登录页存在', !!d.getElementById('login-screen'));
    check('主界面存在且初始隐藏',
        !!d.getElementById('main-screen') && d.getElementById('main-screen').classList.contains('hidden'));
    check('令牌输入框存在', !!d.getElementById('token-input'));
    check('卡片容器存在', !!d.getElementById('repo-grid'));
    check('文件面板初始隐藏', d.getElementById('file-panel').classList.contains('hidden'));
    check('对话框初始隐藏', d.getElementById('dialog').classList.contains('hidden'));
    check('标题为仓鼠', /仓鼠/.test(d.title), d.title);
}

console.log('\n【登录校验】');
{
    const { w, app } = await boot();
    const d = w.document;
    // 空令牌
    d.getElementById('token-input').value = '';
    await app.login();
    check('空令牌被拒', d.getElementById('login-screen').classList.contains('hidden') === false);
    check('空令牌有错误提示', d.getElementById('login-error').textContent.length > 0,
        d.getElementById('login-error').textContent);

    // 格式错误
    d.getElementById('token-input').value = 'abc123';
    await app.login();
    check('非法格式被拒', /令牌格式不对/.test(d.getElementById('login-error').textContent),
        d.getElementById('login-error').textContent);

    // 正确令牌
    d.getElementById('token-input').value = 'ghp_validtoken123';
    await app.login();
    check('合法令牌登录成功', d.getElementById('login-screen').classList.contains('hidden'));
    check('主界面已显示', !d.getElementById('main-screen').classList.contains('hidden'));
    check('显示用户名', /Cool-zimo/.test(d.getElementById('user-login').textContent),
        d.getElementById('user-login').textContent);
    check('令牌已存 localStorage', !!w.localStorage.getItem('cangshu.token'));
}

console.log('\n【卡片渲染】');
{
    fetchLog = [];
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    // 登录后 config 为空 → 需要手动加两个仓库再刷新
    app.config.add('Cool-zimo', 'xiudao');
    app.config.add('Cool-zimo', 'lk');
    await app.loadAll(true);

    const cards = d.querySelectorAll('#repo-grid .card');
    check('渲染出 2 张卡片', cards.length === 2, `${cards.length}`);
    check('空状态已隐藏', d.getElementById('empty-state').style.display === 'none');

    const html = d.getElementById('repo-grid').innerHTML;
    check('卡片含仓库名 xiudao', /xiudao/.test(html));
    check('卡片含私有徽章', /私有/.test(html), 'lk 是私有仓库');
    check('卡片含公开徽章', /公开/.test(html));
    check('卡片含 Pages 标记', /Pages/.test(html));
    check('卡片含 commit hash', /abc1234/.test(html), '短 hash 前 7 位');
    check('卡片含提交信息', /feat: 新功能/.test(html));

    // 统计栏
    const stat = d.getElementById('stat-bar').textContent;
    check('统计栏显示总数', /共\s*2/.test(stat.replace(/\s+/g, ' ')), stat);
    check('统计栏显示 Pages 数', /Pages\s*1/.test(stat.replace(/\s+/g, ' ')), stat);
}

console.log('\n【搜索过滤】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.config.add('Cool-zimo', 'xiudao');
    app.config.add('Cool-zimo', 'lk');
    await app.loadAll(true);

    app.state.filter = 'xiu';
    app.renderGrid();
    check('过滤后只剩 1 张', d.querySelectorAll('#repo-grid .card').length === 1,
        `${d.querySelectorAll('#repo-grid .card').length}`);

    app.state.filter = '不存在的仓库名';
    app.renderGrid();
    check('无匹配时显示空状态', d.getElementById('empty-state').style.display !== 'none');

    app.state.filter = '';
    app.renderGrid();
    check('清空过滤后恢复', d.querySelectorAll('#repo-grid .card').length === 2);
}

console.log('\n【文件浏览】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.config.add('Cool-zimo', 'xiudao');
    await app.loadAll(true);

    await app.openFiles('Cool-zimo', 'xiudao');
    check('文件面板已显示', !d.getElementById('file-panel').classList.contains('hidden'));
    check('标题显示仓库名', /Cool-zimo\/xiudao/.test(d.getElementById('file-title').textContent),
        d.getElementById('file-title').textContent);

    const rows = d.querySelectorAll('#file-list .file-row');
    check('渲染 3 个条目（1 目录 + 2 文件）', rows.length === 3, `${rows.length}`);

    const names = [...rows].map(r => r.querySelector('.f-name').textContent);
    check('目录排在前面', names[0] === 'src', names.join(','));
    check('含中文/空格文件名', names.includes('src ui.js'), names.join(','));

    // 进入子目录
    const dir = [...rows].find(r => r.dataset.type === 'tree');
    dir.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('进入子目录成功', d.getElementById('file-crumb').textContent.includes('src'),
        d.getElementById('file-crumb').textContent);
    check('子目录含 1 个文件（src/main.js）', d.querySelectorAll('#file-list .file-row').length === 1,
        `${d.querySelectorAll('#file-list .file-row').length}`);

    // 返回上级
    d.querySelector('#crumb-up')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('返回上级恢复 3 项', d.querySelectorAll('#file-list .file-row').length === 3);
}

console.log('\n【右键菜单】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.config.add('Cool-zimo', 'xiudao');
    await app.loadAll(true);

    const card = d.querySelector('#repo-grid .card');
    card.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    const menu = d.querySelector('.ctx-menu');
    check('右键弹出菜单', !!menu);
    if (menu) {
        const labels = [...menu.querySelectorAll('.ctx-item')].map(b => b.textContent.trim());
        check('含「在 VS Code 打开」', labels.some(t => /VS Code/.test(t)), labels.join('|'));
        check('含「改名」', labels.some(t => /改名/.test(t)));
        check('含「切换公开性」项', labels.some(t => /公开|私有/.test(t)));
        check('含「从管理列表移除」', labels.some(t => /移除/.test(t)));
        check('含 Pages 跳转（xiudao 已启用）', labels.some(t => /Pages/.test(t)), labels.join('|'));
        check('含分割线', menu.querySelectorAll('.ctx-sep').length > 0);
    }
    app.ctx.hide();
    check('关闭后菜单移除', !d.querySelector('.ctx-menu'));
}

console.log('\n【vscode.dev 链接】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.config.add('Cool-zimo', 'xiudao');
    await app.loadAll(true);
    await app.openFiles('Cool-zimo', 'xiudao');

    // 捕获 window.open
    let opened = [];
    w.open = (u) => { opened.push(u); return null; };
    global.open = w.open;

    // 文件右键 → VS Code
    // src/main.js 在子目录里，先进入 src
    [...d.querySelectorAll('#file-list .file-row')]
        .find(r => r.dataset.type === 'tree')
        ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const row = [...d.querySelectorAll('#file-list .file-row')]
        .find(r => r.dataset.path === 'src/main.js');
    check('找到 src/main.js', !!row);
    row.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    const vsBtn = [...d.querySelectorAll('.ctx-item')].find(b => /在 VS Code 中打开/.test(b.textContent));
    check('文件右键有 VS Code 项', !!vsBtn);
    vsBtn?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('打开 vscode.dev 文件链接', opened.some(u => u === 'https://vscode.dev/github/Cool-zimo/xiudao/blob/main/src/main.js'),
        opened.join(' '));

    // 含空格的文件名必须编码（src ui.js 在根目录，返回上级）
    opened = [];
    d.querySelector('#crumb-up')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    const spRow = [...d.querySelectorAll('#file-list .file-row')]
        .find(r => r.dataset.path === 'src ui.js');
    check('找到 src ui.js', !!spRow);
    spRow.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }));
    [...d.querySelectorAll('.ctx-item')].find(b => /在 VS Code 中打开/.test(b.textContent))
        ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('含空格路径已编码 %20', opened.some(u => u.includes('src%20ui.js')), opened.join(' '));
}

console.log('\n【新建仓库对话框】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.showNewRepo();
    check('对话框已显示', !d.getElementById('dialog').classList.contains('hidden'));
    check('含名称输入', !!d.getElementById('dlg-name'));
    check('含私有选项', !!d.getElementById('dlg-priv'));
    check('含初始化选项', !!d.getElementById('dlg-init'));
    check('含 Pages 选项', !!d.getElementById('dlg-pages'));

    // 非法名称
    d.getElementById('dlg-name').value = 'bad name!!';
    d.getElementById('dlg-ok').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('非法名称被拒（对话框未关）', !d.getElementById('dialog').classList.contains('hidden'));
    check('提示仓库名规则', /只能含/.test(d.getElementById('toast').textContent),
        d.getElementById('toast').textContent);
}

console.log('\n【添加已有仓库】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    await app.loadAll(true);
    app.showAddRepo();
    const picks = d.querySelectorAll('#dlg-picks .pick');
    check('列出未管理仓库', picks.length === 3, `${picks.length}`);
    // 搜索过滤
    d.getElementById('dlg-filter').value = 'cangshu';
    d.getElementById('dlg-filter').dispatchEvent(new w.Event('input', { bubbles: true }));
    const vis = [...d.querySelectorAll('#dlg-picks .pick')].filter(p => p.style.display !== 'none');
    check('搜索过滤生效', vis.length === 1, `${vis.length}`);
}

console.log('\n【失效仓库不崩溃】');
{
    const { w, app } = await boot();
    const d = w.document;
    d.getElementById('token-input').value = 'ghp_xxx';
    await app.login();
    app.config.add('Cool-zimo', 'ghost-repo');   // 不存在的仓库
    await app.loadAll(true);
    const cards = d.querySelectorAll('#repo-grid .card');
    check('失效仓库仍渲染为卡片', cards.length === 1, `${cards.length}`);
    check('标记为无法访问', /无法访问/.test(d.getElementById('repo-grid').innerHTML));
    check('统计栏显示失效数', /失效/.test(d.getElementById('stat-bar').textContent),
        d.getElementById('stat-bar').textContent);
}

console.log('\n【无远程时的降级】');
{
    // 配置仓库不可用：不应卡死，仍能进入主界面
    const dom = buildDom();
    const w = dom.window;
    w.fetch = async (url, init) => {
        const m = String(url);
        const json = (o, s = 200) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(o) });
        if (m.endsWith('/user')) return json(USER);
        if (m.includes('/user/repos?')) return json(REPOS);
        // 配置仓库全部失败
        return json({ message: 'Forbidden' }, 403);
    };
    global.window = w; global.document = w.document; global.localStorage = w.localStorage;
    global.navigator = w.navigator; global.fetch = w.fetch;
    global.btoa = s => Buffer.from(s, 'binary').toString('base64');
    global.atob = s => Buffer.from(s, 'base64').toString('binary');
    global.HTMLElement = w.HTMLElement;
    global.getComputedStyle = w.getComputedStyle.bind(w);

    const { App } = await import(ROOT + 'js/app.js');
    const app = new App();
    app.init();
    w.document.getElementById('token-input').value = 'ghp_xxx';
    let threw = null;
    try { await app.login(); } catch (e) { threw = e; }
    check('配置仓库 403 时不抛异常', !threw, threw?.message);
    check('仍进入主界面', !w.document.getElementById('main-screen').classList.contains('hidden'));
    check('给出 toast 提示', /配置仓库|本地存储/.test(w.document.getElementById('toast').textContent),
        w.document.getElementById('toast').textContent);

    // 关键：离线模式下仍要能添加仓库并持久化，否则整个应用等于废掉
    check('已进入离线配置模式', app.offlineConfig === true, String(app.offlineConfig));
    app.config.add('Cool-zimo', 'lk');
    await app.saveConfig();
    check('离线保存不报错', true);
    check('已写入 localStorage', !!w.localStorage.getItem('cangshu.config.fallback'));
    const fb = JSON.parse(w.localStorage.getItem('cangshu.config.fallback') || '{}');
    check('本地配置含刚添加的仓库', (fb.managed || []).some(m => m.repo === 'lk'),
        JSON.stringify(fb.managed));

    await app.loadAll(true);
    const cards = w.document.querySelectorAll('#repo-grid .card');
    check('离线模式下仍能渲染卡片', cards.length >= 1, `${cards.length}`);
}

console.log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
process.exit(fail > 0 ? 1 : 0);
