/**
 * 仓鼠 · 主应用
 *
 * 三块状态：
 *   auth   令牌与账号
 *   config 配置仓库里的「我管理哪些仓库」
 *   repos  每个被管理仓库的实时数据（详情 + Pages + 最新提交）
 *
 * 渲染是"整体重绘"式：数据变了就 render()。
 * 仓库数量级在几百以内，重绘成本远低于维护增量 DOM 的复杂度。
 */

import { GitHubAPI } from './api.js';
import { ConfigStore, blankConfig, DEFAULT_CONFIG_REPO } from './config.js';
import { ContextMenu } from './context-menu.js';

const LS_TOKEN = 'cangshu.token';
const LS_USER = 'cangshu.user';
const LS_CONFIG_FALLBACK = 'cangshu.config.fallback';
// 多账号：账号清单与"当前是哪个"。
// LS_TOKEN / LS_USER 仍然表示**当前账号**，保留不动 ——
// Bridge 依赖它们判断登录状态，Drive 也读这两个 key，不能改。
const LS_ACCOUNTS = 'cangshu.accounts';
const LS_CURRENT = 'cangshu.current';

export class App {
    constructor() {
        this.api = null;
        this.config = null;
        this.ctx = new ContextMenu();

        this.state = {
            user: null,
            repos: [],          // 被管理仓库的详情数组
            allRepos: [],       // 账号下全部仓库（"添加"对话框用）
            loading: false,
            error: '',
            view: 'grid',       // grid | files
            current: null,      // { owner, repo, branch }
            tree: [],
            treePath: '',
            filter: ''
        };
    }

    // ================= 启动 =================

    init() {
        this.setupBridge();
        this.dom = {
            login: document.getElementById('login-screen'),
            main: document.getElementById('main-screen'),
            token: document.getElementById('token-input'),
            loginBtn: document.getElementById('login-btn'),
            loginErr: document.getElementById('login-error'),
            savedBox: document.getElementById('saved-box'),
            savedList: document.getElementById('saved-list'),

            avatar: document.getElementById('user-avatar'),
            userLogin: document.getElementById('user-login'),
            grid: document.getElementById('repo-grid'),
            empty: document.getElementById('empty-state'),
            stat: document.getElementById('stat-bar'),
            toast: document.getElementById('toast'),

            filePanel: document.getElementById('file-panel'),
            fileTitle: document.getElementById('file-title'),
            fileList: document.getElementById('file-list'),
            fileCrumb: document.getElementById('file-crumb'),

            dlg: document.getElementById('dialog'),
            dlgBody: document.getElementById('dialog-body')
        };

        this.dom.loginBtn?.addEventListener('click', () => this.login());
        this.dom.token?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.login();
        });
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        // 点头像 → 切换账号 / 退出
        document.querySelector('.user')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            this.showAccountMenu(r.left, r.bottom + 4);
        });
        // 右键头像也能出菜单（与 Drive 的习惯一致）
        document.querySelector('.user')?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showAccountMenu(e.clientX, e.clientY);
        });
        document.getElementById('refresh-btn')?.addEventListener('click', () => this.loadAll(true));
        document.getElementById('new-repo-btn')?.addEventListener('click', () => this.showNewRepo());
        document.getElementById('add-repo-btn')?.addEventListener('click', () => this.showAddRepo());
        document.getElementById('config-btn')?.addEventListener('click', () => this.showConfig());
        document.getElementById('file-back')?.addEventListener('click', () => this.closeFiles());
        document.getElementById('file-open-vscode')?.addEventListener('click', () => this.openRepoInVSCode());
        document.getElementById('search-input')?.addEventListener('input', (e) => {
            this.state.filter = e.target.value.trim().toLowerCase();
            this.renderGrid();
        });

        // 已保存账号：可能有多个，逐个渲染成卡片
        this.migrateLegacyAccount();
        this.renderSavedAccounts();

        // 主界面空白处右键 → 全局菜单
        document.getElementById('main-screen')?.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.card') || e.target.closest('.file-row')) return;
            e.preventDefault();
            this.ctx.show(e.clientX, e.clientY, [
                { icon: '➕', label: '新建仓库', onClick: () => this.showNewRepo() },
                { icon: '📥', label: '添加已有仓库', onClick: () => this.showAddRepo() },
                { sep: true },
                { icon: '🔄', label: '刷新全部', onClick: () => this.loadAll(true) }
            ]);
        });
    }

    // ================= 登录 =================

    async login(tokenOverride) {
        const token = (tokenOverride || this.dom.token.value).trim();
        if (!token) return this.loginError('请输入令牌');
        if (!/^(ghp_|github_pat_|gho_|ghs_|ghu_)/.test(token)) {
            return this.loginError('令牌格式不对，应以 ghp_ 或 github_pat_ 开头');
        }

        this.setLoginBusy(true);
        const api = new GitHubAPI(token);
        const r = await api.whoami();
        this.setLoginBusy(false);

        if (!r.ok) return this.loginError(r.message);

        const user = {
            login: r.data.login, avatar_url: r.data.avatar_url, name: r.data.name
        };
        localStorage.setItem(LS_TOKEN, token);
        localStorage.setItem(LS_USER, JSON.stringify(user));
        // 登记进账号清单（同一账号重复登录只更新令牌，不产生重复条目）
        this.addAccount(token, user);
        // 同步给 GitHub Drive，让对面也是已登录状态
        this.saveTokenToBridge(token, user);

        this.api = api;
        this.state.user = r.data;
        this.config = new ConfigStore(api, r.data.login);

        this.dom.login.classList.add('hidden');
        this.dom.main.classList.remove('hidden');
        this.dom.avatar.src = r.data.avatar_url;
        this.dom.userLogin.textContent = '@' + r.data.login;

        await this.bootConfig();
        await this.loadAll();
        // 如果是从 GitHub Drive 带上下文跳过来的，登录后立刻定位
        await this.applyBridgeContext();
    }

    loginError(msg) {
        this.dom.loginErr.textContent = msg;
        this.dom.loginErr.style.display = msg ? '' : 'none';
    }

    setLoginBusy(busy) {
        this.dom.loginBtn.disabled = busy;
        this.dom.loginBtn.textContent = busy ? '验证中…' : '进 入 仓 鼠';
    }

    logout() {
        // 只结束当前会话，账号清单保留 ——
        // 回到登录页还能看到已保存的账号，点一下就回来。
        // 想彻底删掉某个账号，用登录页卡片上的 ×。
        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_CURRENT);
        location.reload();
    }

    // ================= 多账号 =================

    getAccounts() {
        try {
            const raw = localStorage.getItem(LS_ACCOUNTS);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch { return []; }
    }

    saveAccounts(list) {
        try { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(list)); } catch {}
    }

    /**
     * 登录成功后登记账号
     * 同一个账号重复登录时只更新令牌和头像，不产生重复条目
     */
    addAccount(token, user) {
        const list = this.getAccounts();
        const id = user.login;
        const now = new Date().toISOString();
        const hit = list.find(a => a.id === id);
        if (hit) {
            hit.token = token;
            hit.user = user;
            hit.lastUsed = now;
        } else {
            list.push({ id, token, user, addedAt: now, lastUsed: now });
        }
        this.saveAccounts(list);
        localStorage.setItem(LS_CURRENT, id);
        return id;
    }

    removeAccount(id) {
        const list = this.getAccounts().filter(a => a.id !== id);
        this.saveAccounts(list);
        // 删的正是当前账号 → 立即结束会话
        if (localStorage.getItem(LS_CURRENT) === id) {
            localStorage.removeItem(LS_TOKEN);
            localStorage.removeItem(LS_USER);
            localStorage.removeItem(LS_CURRENT);
        }
    }

    /**
     * 切换账号：写入"当前账号"，并同步给 GitHub Drive
     *
     * 同步这一步是联动的关键 —— 否则仓鼠切到 B 之后，
     * 从仓鼠跳去 Drive 时 Drive 还是 A，两个应用状态打架。
     */
    switchAccount(id) {
        const acc = this.getAccounts().find(a => a.id === id);
        if (!acc) return false;
        localStorage.setItem(LS_TOKEN, acc.token);
        localStorage.setItem(LS_USER, JSON.stringify(acc.user));
        localStorage.setItem(LS_CURRENT, id);
        acc.lastUsed = new Date().toISOString();
        this.saveAccounts(this.getAccounts().map(a => a.id === id ? acc : a));
        this.saveTokenToBridge(acc.token, acc.user);
        return true;
    }

    /**
     * 老用户升级：之前只存了一对 token/user，没有账号清单
     * 启动时把现有的补进清单，避免升级后"账号不见了"
     */
    migrateLegacyAccount() {
        if (this.getAccounts().length) return;
        const token = localStorage.getItem(LS_TOKEN);
        const raw = localStorage.getItem(LS_USER);
        if (!token || !raw) return;
        try {
            const u = JSON.parse(raw);
            if (u && u.login) this.addAccount(token, u);
        } catch { /* 缓存损坏就跳过 */ }
    }

    /**
     * 渲染登录页的已保存账号列表
     *
     * 每个账号一行：点头像区直接登录，点 × 从本机移除。
     * 移除只删本机保存的令牌，不动 GitHub 上的任何东西。
     */
    renderSavedAccounts() {
        const list = this.getAccounts();
        const box = this.dom.savedBox;
        if (!box) return;
        if (!list.length) { box.style.display = 'none'; return; }

        const cur = localStorage.getItem(LS_CURRENT);
        box.style.display = '';
        const title = box.querySelector('.saved-title');
        if (title) title.textContent = `已保存的账号（${list.length}）`;

        this.dom.savedList.innerHTML = list.map(a => {
            const u = a.user || {};
            const isCur = a.id === cur;
            return `
                <div class="saved-acc${isCur ? ' is-current' : ''}" data-id="${esc(a.id)}">
                    <img src="${esc(u.avatar_url || '')}" alt="">
                    <span class="acc-name">@${esc(u.login || a.id)}</span>
                    ${isCur ? '<em>当前</em>' : '<em>点击登录</em>'}
                    <button class="acc-del" data-del="${esc(a.id)}" title="从本机移除">×</button>
                </div>`;
        }).join('');

        // 点击卡片 → 用该账号登录
        this.dom.savedList.querySelectorAll('.saved-acc').forEach(el => {
            el.addEventListener('click', () => {
                const acc = this.getAccounts().find(a => a.id === el.dataset.id);
                if (acc) this.login(acc.token);
            });
        });

        // 点 × → 移除（阻止冒泡，否则会先触发登录）
        this.dom.savedList.querySelectorAll('.acc-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.del;
                const acc = this.getAccounts().find(a => a.id === id);
                const name = acc ? (acc.user?.login || id) : id;
                if (!confirm(`把 @${name} 从本机移除？\n\n只删除本机保存的令牌，GitHub 上的账号和仓库不受影响。`)) return;
                this.removeAccount(id);
                this.renderSavedAccounts();
            });
        });
    }

    /**
     * 顶栏用户区菜单：切换账号 / 退出
     *
     * 配置仓库是账号私有的，换账号等于换一整套仓库，
     * 所以切换后必须重载 —— 不能只换 api 实例。
     */
    showAccountMenu(x, y) {
        const list = this.getAccounts();
        const cur = localStorage.getItem(LS_CURRENT);
        const items = [];

        const others = list.filter(a => a.id !== cur);
        if (others.length) {
            items.push({ icon: '🔄', label: '切换账号', onClick: () => {}, disabled: true });
            others.forEach(a => items.push({
                icon: '👤',
                label: `@${a.user?.login || a.id}`,
                onClick: () => {
                    if (this.switchAccount(a.id)) location.reload();
                }
            }));
            items.push({ sep: true });
        }

        items.push({
            icon: '⎋',
            label: '退出登录',
            onClick: () => this.logout()
        });

        this.ctx.show(x, y, items);
    }

    /** 准备配置仓库（不存在就建） */
    // ================= 与 GitHub Drive 联动 =================

    get bridge() { return (typeof window !== 'undefined') ? window.Bridge : null; }

    /**
     * 挂载跨应用切换按钮 + 检测对方是否已登录
     *
     * 两个应用同在 cool-zimo.github.io 下，localStorage 共享，
     * 所以在一边登录过，另一边能直接沿用，无需再输一遍令牌。
     */
    setupBridge() {
        const B = this.bridge;
        if (!B || !B.other()) return;

        // 顶栏：应用栏（两个应用平铺，当前高亮）
        const slot = document.getElementById('app-switch-slot');
        if (slot) {
            slot.innerHTML = B.appBarHtml();
            slot.querySelectorAll('.ab-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const to = btn.dataset.app;
                    if (to === B.current()?.id) return;
                    // 带上当前工作上下文，对方打开就是同一个仓库
                    const cur = this.state.current;
                    this.goToApp(to, cur ? { repo: `${cur.owner}/${cur.repo}` } : {});
                });
            });
        }

        // 登录页：对方已登录则提供"沿用"
        if (B.otherHasToken()) {
            const box = document.getElementById('bridge-box');
            const info = document.getElementById('bridge-info');
            const btn = document.getElementById('bridge-btn');
            if (box) box.style.display = '';
            if (info) {
                const u = B.findUser();
                const other = B.other();
                info.innerHTML = `${other.icon} <strong>${esc(u?.login || '已登录账号')}</strong>` +
                    `<span class="bridge-note">（令牌只在你本机浏览器里，不会上传）</span>`;
            }
            btn?.addEventListener('click', async () => {
                const t = B.findToken();
                if (!t) return this.toast('未读到令牌，请手动输入', 'err');
                const inp = document.getElementById('token-input');
                if (inp) inp.value = t;
                await this.login();
            });
        }
    }

    /** 跳到另一个应用：先存状态，再带上下文过去 */
    goToApp(appId, params) {
        const B = this.bridge;
        if (!B) return;
        B.saveState({
            view: this.state.view,
            filter: this.state.filter,
            scroll: window.scrollY || 0,
            repo: this.state.current ? `${this.state.current.owner}/${this.state.current.repo}` : ''
        });
        B.go(params || {});
    }

    /**
     * 消费跳转带过来的上下文：定位 + 高亮 + 恢复状态
     * 这是"像同一个软件"的核心体验
     */
    async applyBridgeContext() {
        const B = this.bridge;
        if (!B) return;
        const ctx = B.consume();
        if (!ctx) return;

        // 恢复离开时的状态（视图/过滤词）
        if (ctx.filter) {
            this.state.filter = ctx.filter;
            const si = document.getElementById('search-input');
            if (si) si.value = ctx.filter;
        }

        // 定位到指定仓库：滚动 + 高亮脉冲
        if (ctx.repo) {
            const [o, rp] = ctx.repo.split('/');
            if (o && rp) {
                const target = { owner: o, repo: rp };
                // 若该仓库不在管理列表，顺手加上，避免"跳过来却找不到"
                if (!this.config?.has(o, rp)) {
                    this.config?.add(o, rp);
                    this.saveConfig().catch(() => {});
                    await this.loadAll(true);
                }
                this.focusRepo(target);
                if (ctx.view === 'files' || ctx.path) this.openFiles(o, rp);
            }
        }

        // 恢复滚动位置
        const st = B.loadState();
        if (st && typeof st.scroll === 'number') {
            requestAnimationFrame(() => window.scrollTo(0, st.scroll));
        }
        B.clearState();
    }

    /** 把某张卡片滚到视野中央并高亮脉冲 */
    focusRepo(target) {
        const tryFocus = (times) => {
            const el = document.querySelector(
                `.card[data-owner="${CSS.escape(target.owner)}"][data-repo="${CSS.escape(target.repo)}"]`);
            if (!el) {
                if (times > 0) setTimeout(() => tryFocus(times - 1), 120);
                return;
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('card-focus');
            setTimeout(() => el.classList.remove('card-focus'), 2200);
        };
        tryFocus(12);
    }

    /** 保存令牌时同步给对方应用，让对面也变已登录 */
    saveTokenToBridge(token, user) {
        const B = this.bridge;
        if (!B) return;
        try { B.saveToken(token, user); } catch (e) { /* 不影响主流程 */ }
    }

    async bootConfig() {
        const r = await this.config.ensureRepo();
        if (!r.ok) {
            // 令牌没有建仓权限（如 fine-grained 只给了只读）时，
            // 不能让整个应用废掉 —— 降级到浏览器本地存储
            this.offlineConfig = true;
            this._loadLocalConfig();
            this.toast('配置仓库不可用，已改用本地存储：' + r.message, 'err');
            return;
        }
        const l = await this.config.load();
        if (!l.ok) {
            this.offlineConfig = true;
            this._loadLocalConfig();
            this.toast('读取配置失败，已改用本地存储：' + l.message, 'err');
        } else if (r.created) {
            this.toast(`已创建配置仓库 ${DEFAULT_CONFIG_REPO}（私有）`, 'ok');
        }
    }

    /** 本地兜底：把管理列表存浏览器 */
    _loadLocalConfig() {
        try {
            const raw = localStorage.getItem(LS_CONFIG_FALLBACK);
            this.config.data = raw ? JSON.parse(raw) : blankConfig();
        } catch { this.config.data = blankConfig(); }
    }

    _saveLocalConfig() {
        try { localStorage.setItem(LS_CONFIG_FALLBACK, JSON.stringify(this.config.data)); } catch {}
    }

    // ================= 数据加载 =================


    /**
     * 统一保存配置
     * 远程可用 → 存配置仓库；不可用 → 落本地存储。
     * 这样即使令牌没建仓权限，用户添加的仓库也不会丢。
     */
    async saveConfig() {
        if (!this.config) return { ok: false };
        if (this.offlineConfig) {
            this._saveLocalConfig();
            return { ok: true, local: true };
        }
        // 注意：这里必须是 config.save()，不能是 this.saveConfig()
        // 否则会无限递归直接栈溢出（上一轮批量替换时误伤过一次）
        const r = await this.config.save();
        if (!r.ok) {
            this.offlineConfig = true;
            this._saveLocalConfig();
            this.toast('远程配置保存失败，已存本地：' + r.message, 'err');
            return { ok: true, local: true };
        }
        return r;
    }

    async loadAll(silent = false) {
        if (this.state.loading) return;
        this.state.loading = true;
        this.state.error = '';
        if (!silent) this.renderGrid();

        // 1. 账号下全部仓库（供"添加"用，且用来补全管理列表里的详情）
        const all = await this.api.listAllRepos();
        this.state.allRepos = all.ok ? all.data : [];
        if (!all.ok) this.state.error = all.message;

        // 2. 逐个拉取被管理仓库的详情
        const managed = this.config?.list() || [];
        const out = [];
        for (const m of managed) {
            const d = await this.fetchRepoDetail(m.owner, m.repo);
            if (d) out.push({ ...d, meta: m });
        }
        this.state.repos = out;

        this.state.loading = false;
        this.renderGrid();
    }

    async fetchRepoDetail(owner, repo) {
        const [base, pages, commits] = await Promise.all([
            this.api.getRepo(owner, repo),
            this.api.getPages(owner, repo),
            this.api.listCommits(owner, repo, { perPage: 1 })
        ]);
        if (!base.ok) {
            // 仓库被删除或无权访问：标记为失效，不静默丢弃
            return { owner, repo, missing: true, reason: base.message, meta: null };
        }
        const d = base.data;
        return {
            owner, repo,
            missing: false,
            full_name: d.full_name,
            description: d.description || '',
            private: d.private,
            html_url: d.html_url,
            default_branch: d.default_branch,
            language: d.language,
            size: d.size,
            stargazers: d.stargazers_count,
            forks: d.forks_count,
            open_issues: d.open_issues_count,
            pushed_at: d.pushed_at,
            updated_at: d.updated_at,
            created_at: d.created_at,
            archived: d.archived,
            fork: d.fork,
            pages: pages.ok ? {
                enabled: true,
                url: pages.data.html_url,
                status: pages.data.status,
                buildType: pages.data.build_type
            } : { enabled: false },
            lastCommit: (commits.ok && commits.data[0]) ? {
                sha: commits.data[0].sha,
                short: commits.data[0].sha.slice(0, 7),
                message: (commits.data[0].commit.message || '').split('\n')[0],
                author: commits.data[0].commit.author?.name,
                date: commits.data[0].commit.author?.date
            } : null
        };
    }

    // ================= 卡片网格 =================

    renderGrid() {
        const list = this.state.repos.filter(r => {
            if (!this.state.filter) return true;
            return (r.repo + ' ' + r.owner + ' ' + (r.description || ''))
                .toLowerCase().includes(this.state.filter);
        });

        const n = list.length;
        const priv = list.filter(r => r.private).length;
        const pg = list.filter(r => r.pages?.enabled).length;
        const gone = list.filter(r => r.missing).length;

        this.dom.stat.innerHTML = `
            <span>共 <b>${n}</b> 个仓库</span>
            <span>私有 <b>${priv}</b></span>
            <span>Pages <b>${pg}</b></span>
            ${gone ? `<span class="warn">失效 <b>${gone}</b></span>` : ''}
            ${this.state.loading ? '<span class="muted">加载中…</span>' : ''}
            ${this.state.error ? `<span class="err">${esc(this.state.error)}</span>` : ''}
        `;

        if (!n) {
            this.dom.grid.innerHTML = '';
            this.dom.empty.style.display = '';
            return;
        }
        this.dom.empty.style.display = 'none';
        this.dom.grid.innerHTML = list.map(r => this.cardHTML(r)).join('');

        // 绑定卡片事件
        [...this.dom.grid.querySelectorAll('.card')].forEach(el => {
            const owner = el.dataset.owner, repo = el.dataset.repo;
            el.querySelector('[data-act="open"]')?.addEventListener('click', () => this.openFiles(owner, repo));
            el.querySelector('[data-act="vscode"]')?.addEventListener('click', () => this.openRepoInVSCode(owner, repo));
            el.querySelector('[data-act="github"]')?.addEventListener('click', () => {
                const r = this.findRepo(owner, repo);
                window.open(r?.html_url || `https://github.com/${owner}/${repo}`, '_blank');
            });
            el.querySelector('[data-act="rename"]')?.addEventListener('click', () => this.showRename(owner, repo));
            el.querySelector('[data-act="vis"]')?.addEventListener('click', () => this.toggleVisibility(owner, repo));
            el.querySelector('[data-act="del"]')?.addEventListener('click', () => this.confirmDelete(owner, repo));
            el.addEventListener('contextmenu', (e) => this.cardMenu(e, owner, repo));
        });
    }

    findRepo(owner, repo) {
        return this.state.repos.find(r =>
            r.owner.toLowerCase() === owner.toLowerCase() &&
            r.repo.toLowerCase() === repo.toLowerCase());
    }

    cardHTML(r) {
        if (r.missing) {
            return `
            <div class="card missing" data-owner="${esc(r.owner)}" data-repo="${esc(r.repo)}">
                <div class="card-top">
                    <span class="card-icon">👻</span>
                    <div class="card-name">
                        <b>${esc(r.owner)}/${esc(r.repo)}</b>
                        <span class="tag err">无法访问</span>
                    </div>
                </div>
                <p class="card-desc err">${esc(r.reason || '仓库不存在或令牌无权访问')}</p>
                <div class="card-acts">
                    <button data-act="del">从列表移除</button>
                </div>
            </div>`;
        }

        const pages = r.pages?.enabled
            ? `<a class="pill pages ok" href="${esc(r.pages.url)}" target="_blank" title="${esc(r.pages.status || '')}">🌐 Pages</a>`
            : `<span class="pill pages off" title="未启用 Pages">🌐 未启用</span>`;

        const hash = r.lastCommit
            ? `<code class="hash" title="${esc(r.lastCommit.message)}">${esc(r.lastCommit.short)}</code>`
            : '<span class="muted">空仓库</span>';

        return `
        <div class="card" data-owner="${esc(r.owner)}" data-repo="${esc(r.repo)}">
            <div class="card-top">
                <span class="card-icon">${r.private ? '🔒' : '📦'}</span>
                <div class="card-name">
                    <b>${esc(r.repo)}</b>
                    <span class="tag ${r.private ? 'priv' : 'pub'}">${r.private ? '私有' : '公开'}</span>
                    ${r.archived ? '<span class="tag warn">已归档</span>' : ''}
                    ${r.fork ? '<span class="tag">派生</span>' : ''}
                </div>
            </div>

            <p class="card-desc">${esc(r.description || '（无描述）')}</p>

            <div class="card-meta">
                ${hash}
                ${r.language ? `<span class="lang">${esc(r.language)}</span>` : ''}
                <span class="muted">${fmtSize(r.size)}</span>
            </div>

            <div class="card-pills">
                ${pages}
                <span class="pill">⭐ ${r.stargazers}</span>
                <span class="pill" title="分支">🌿 ${esc(r.default_branch)}</span>
            </div>

            ${r.lastCommit ? `<div class="card-commit" title="${esc(r.lastCommit.message)}">
                ${esc(r.lastCommit.message.slice(0, 48))}
            </div>` : ''}

            <div class="card-foot">
                <span class="muted">${timeAgo(r.pushed_at)}</span>
                <div class="card-acts">
                    <button data-act="open" title="浏览文件">📂</button>
                    <button data-act="vscode" title="在 VS Code 打开">💠</button>
                    <button data-act="github" title="GitHub 页面">🐙</button>
                    <button data-act="rename" title="改名">✏️</button>
                    <button data-act="vis" title="切换公开性">👁️</button>
                    <button data-act="del" class="danger" title="删除">🗑️</button>
                </div>
            </div>
        </div>`;
    }

    cardMenu(e, owner, repo) {
        e.preventDefault();
        const r = this.findRepo(owner, repo);
        if (!r) return;

        // 图标统一走 SVG 集：emoji 各浏览器渲染不一致，
        // 且无法跟随暗色主题变色
        const ico = (n) => (window.Icons ? window.Icons.get(n, { size: 15 }) : '');

        this.ctx.show(e.clientX, e.clientY, [
            { icon: ico('folderOpen'), label: '浏览文件', onClick: () => this.openFiles(owner, repo) },
            { icon: ico('code'), label: '在 VS Code 打开', onClick: () => this.openRepoInVSCode(owner, repo) },
            { icon: ico('external'), label: 'GitHub 页面', onClick: () => window.open(r.html_url, '_blank') },
            r.pages?.enabled && {
                icon: ico('globe'), label: '打开 Pages 站点',
                onClick: () => window.open(r.pages.url, '_blank')
            },
            { sep: true },
            {
                icon: ico('settings'), label: '仓库设置',
                children: [
                    { icon: ico('edit'), label: '改名', onClick: () => this.showRename(owner, repo) },
                    {
                        icon: ico(r.private ? 'unlock' : 'lock'),
                        label: r.private ? '设为公开' : '设为私有',
                        onClick: () => this.toggleVisibility(owner, repo)
                    },
                    { icon: ico('tag'), label: '设置备注名', onClick: () => this.showAlias(owner, repo) }
                ]
            },
            {
                icon: ico('copy'), label: '复制',
                children: [
                    {
                        icon: ico('link'), label: 'git 地址',
                        onClick: () => this.copy(`https://github.com/${owner}/${repo}.git`)
                    },
                    { icon: ico('book'), label: '仓库名', onClick: () => this.copy(`${owner}/${repo}`) }
                ]
            },
            { sep: true },
            {
                icon: ico('trash'), label: '从管理列表移除', danger: true,
                onClick: () => this.removeManaged(owner, repo)
            }
        ].filter(Boolean));
    }

    // ================= 文件浏览 =================

    async openFiles(owner, repo) {
        const r = this.findRepo(owner, repo);
        const branch = r?.default_branch || 'main';
        this.state.current = { owner, repo, branch };
        this.state.view = 'files';
        this.state.treePath = '';

        this.dom.filePanel.classList.remove('hidden');
        this.dom.fileTitle.textContent = `${owner}/${repo}`;
        this.dom.fileList.innerHTML = '<div class="muted pad">加载文件树…</div>';

        const t = await this.api.getTree(owner, repo, branch);
        if (!t.ok) {
            this.dom.fileList.innerHTML = `<div class="err pad">${esc(t.message)}</div>`;
            return;
        }
        this.state.tree = (t.data.tree || []);
        this.renderTree();
    }

    renderTree() {
        const { owner, repo, branch } = this.state.current;
        const prefix = this.state.treePath;
        const all = this.state.tree;

        // 当前层级：直接子项
        //
        // 去重必须用「同一把 key」：Git 树里目录本身是一条 tree 记录，
        // 同时它的子文件又会各自合成出同一个目录名。
        // 若只对合成目录去重，目录就会被渲染两次（src 出现两行）。
        // 所以真实目录项和合成目录项都按 name 记进 seen。
        const items = [];
        const seen = new Set();
        for (const n of all) {
            if (prefix && !n.path.startsWith(prefix + '/')) continue;
            const rest = prefix ? n.path.slice(prefix.length + 1) : n.path;
            if (!rest) continue;
            const seg = rest.split('/');

            if (seg.length === 1) {
                // 该层直接子项：目录(tree) 与文件(blob) 都按名字去重
                if (seen.has(seg[0])) continue;
                seen.add(seg[0]);
                items.push({ name: seg[0], path: n.path, type: n.type, size: n.size, sha: n.sha });
            } else {
                // 更深层级：合成一条目录
                if (seen.has(seg[0])) continue;
                seen.add(seg[0]);
                items.push({
                    name: seg[0],
                    path: prefix ? `${prefix}/${seg[0]}` : seg[0],
                    type: 'tree', size: 0, sha: ''
                });
            }
        }
        items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'tree' ? -1 : 1)));

        this.dom.fileCrumb.innerHTML = prefix
            ? `<button id="crumb-up">⬆️ 上级</button><span>${esc(prefix)}</span>`
            : `<span class="muted">根目录 · ${esc(branch)}</span>`;
        this.dom.fileCrumb.querySelector('#crumb-up')?.addEventListener('click', () => {
            const p = this.state.treePath.split('/');
            p.pop();
            this.state.treePath = p.join('/');
            this.renderTree();
        });

        if (!items.length) {
            this.dom.fileList.innerHTML = '<div class="muted pad">（空）</div>';
            return;
        }

        this.dom.fileList.innerHTML = items.map(it => `
            <div class="file-row" data-path="${esc(it.path)}" data-type="${it.type}">
                <span class="f-ico">${it.type === 'tree' ? '📁' : fileIcon(it.name)}</span>
                <span class="f-name">${esc(it.name)}</span>
                <span class="f-size">${it.type === 'tree' ? '' : fmtSize(Math.ceil((it.size || 0) / 1024))}</span>
            </div>`).join('');

        [...this.dom.fileList.querySelectorAll('.file-row')].forEach(el => {
            const path = el.dataset.path, type = el.dataset.type;
            el.addEventListener('click', () => {
                if (type === 'tree') { this.state.treePath = path; this.renderTree(); }
                else this.previewFile(path);
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.fileMenu(e, path, type);
            });
        });
    }

    fileMenu(e, path, type) {
        const { owner, repo, branch } = this.state.current;
        const isDir = type === 'tree';
        // 路径必须逐段编码后拼接：直接拼原路径会让空格把 URL 截断
        // （"src ui.js" → ".../main/src ui.js" 链接直接断掉）
        const enc = encodePath(path);
        const vsUrl = isDir
            ? `https://vscode.dev/github/${owner}/${repo}`
            : `https://vscode.dev/github/${owner}/${repo}/blob/${branch}/${enc}`;
        const ghUrl = `https://github.com/${owner}/${repo}/${isDir ? 'tree' : 'blob'}/${branch}/${enc}`;

        const ico = (n) => (window.Icons ? window.Icons.get(n, { size: 15 }) : '');

        this.ctx.show(e.clientX, e.clientY, [
            {
                icon: ico('code'), label: isDir ? '在 VS Code 打开仓库' : '在 VS Code 中打开',
                onClick: () => window.open(vsUrl, '_blank')
            },
            { icon: ico('external'), label: '在 GitHub 查看', onClick: () => window.open(ghUrl, '_blank') },
            { sep: true },
            {
                icon: ico('copy'), label: '复制',
                children: [
                    { icon: ico('fileText'), label: '文件路径', onClick: () => this.copy(path) },
                    { icon: ico('link'), label: 'VS Code 链接', onClick: () => this.copy(vsUrl) },
                    { icon: ico('link'), label: 'GitHub 链接', onClick: () => this.copy(ghUrl) }
                ]
            },
            !isDir && {
                icon: ico('download'), label: '下载文件',
                onClick: () => window.open(
                    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${enc}`, '_blank')
            }
        ].filter(Boolean));
    }

    async previewFile(path) {
        const { owner, repo, branch } = this.state.current;
        const r = await this.api.getFile(owner, repo, path, branch);
        if (!r.ok) return this.toast(r.message, 'err');
        const code = esc(r.content.slice(0, 20000));
        this.showDialog(`📄 ${path}`, `
            <div class="preview">
                <div class="prev-acts">
                    <button id="prev-vscode">💠 在 VS Code 打开</button>
                    <button id="prev-copy">📋 复制内容</button>
                </div>
                <pre>${code}</pre>
                ${r.content.length > 20000 ? '<p class="muted">（内容过长，仅显示前 20000 字符）</p>' : ''}
            </div>`);
        document.getElementById('prev-vscode')?.addEventListener('click', () => {
            window.open(`https://vscode.dev/github/${owner}/${repo}/blob/${branch}/${encodePath(path)}`, '_blank');
        });
        document.getElementById('prev-copy')?.addEventListener('click', () => this.copy(r.content));
    }

    closeFiles() {
        this.state.view = 'grid';
        this.dom.filePanel.classList.add('hidden');
    }

    openRepoInVSCode(owner, repo) {
        if (!owner) ({ owner, repo } = this.state.current || {});
        // 兜底：两个来源都没有时不要打开 /undefined/undefined
        if (!owner || !repo) return this.toast('请先打开一个仓库', 'err');
        window.open(`https://vscode.dev/github/${owner}/${repo}`, '_blank');
    }

    // ================= 仓库操作 =================

    async createRepo({ name, description, isPrivate, init, pages }) {
        const r = await this.api.createRepo({
            name, description, private: isPrivate, autoInit: init
        });
        if (!r.ok) return this.toast(r.message, 'err');

        if (pages) {
            const p = await this.api.enablePages(this.state.user.login, name, r.data.default_branch || 'main');
            if (!p.ok) this.toast('仓库已建，但 Pages 启用失败：' + p.message, 'err');
        }
        this.config.add(this.state.user.login, name);
        await this.saveConfig();
        this.toast(`已创建 ${name}`, 'ok');
        await this.loadAll(true);
    }

    async showRename(owner, repo) {
        const r = this.findRepo(owner, repo);
        this.showDialog('✏️ 仓库改名', `
            <label>新名称</label>
            <input id="dlg-name" value="${esc(repo)}" autocomplete="off">
            <p class="hint">重命名后，旧地址会自动跳转到新地址。配置里的记录会同步更新。</p>
            <div class="dlg-acts">
                <button id="dlg-ok" class="primary">确认改名</button>
                <button id="dlg-cancel">取消</button>
            </div>`);
        document.getElementById('dlg-name')?.focus();
        document.getElementById('dlg-ok')?.addEventListener('click', async () => {
            const nn = document.getElementById('dlg-name').value.trim();
            if (!nn || nn === repo) return this.closeDialog();
            const res = await this.api.renameRepo(owner, repo, nn);
            this.closeDialog();
            if (!res.ok) return this.toast(res.message, 'err');
            this.config.rename(owner, repo, nn);
            await this.saveConfig();
            this.toast(`已改名为 ${nn}`, 'ok');
            await this.loadAll(true);
        });
        document.getElementById('dlg-cancel')?.addEventListener('click', () => this.closeDialog());
    }

    async toggleVisibility(owner, repo) {
        const r = this.findRepo(owner, repo);
        if (!r) return;
        const to = !r.private;
        if (to === false && !confirm(`把 ${owner}/${repo} 设为公开？\n所有人都能看到这个仓库的代码。`)) return;
        if (to === true && !confirm(`把 ${owner}/${repo} 设为私有？\n已启用的 Pages 站点可能会被停用。`)) return;

        const res = await this.api.setVisibility(owner, repo, to);
        if (!res.ok) return this.toast(res.message, 'err');
        this.toast(`${repo} 已设为${to ? '私有' : '公开'}`, 'ok');
        await this.loadAll(true);
    }

    async confirmDelete(owner, repo) {
        const r = this.findRepo(owner, repo);
        if (r?.missing) return this.removeManaged(owner, repo);
        if (!confirm(
            `⚠️ 确定删除 ${owner}/${repo} ？\n\n` +
            `这会永久删除代码、Issues、Star 和 Pages 站点，无法恢复！\n\n` +
            `如果只想从仓鼠的管理列表里移除，请点"取消"，然后右键卡片选"从管理列表移除"。`
        )) return;
        if (!confirm(`再确认一次：真的要删除 ${owner}/${repo} 吗？`)) return;

        const res = await this.api.deleteRepo(owner, repo);
        if (!res.ok) return this.toast(res.message, 'err');
        this.config.remove(owner, repo);
        await this.saveConfig();
        this.toast(`已删除 ${repo}`, 'ok');
        await this.loadAll(true);
    }

    async removeManaged(owner, repo) {
        if (!confirm(`从仓鼠的管理列表移除 ${owner}/${repo}？\n（不会删除 GitHub 上的仓库）`)) return;
        this.config.remove(owner, repo);
        const r = await this.saveConfig();
        if (!r.ok) return this.toast('移除失败：' + r.message, 'err');
        this.toast('已移除', 'ok');
        await this.loadAll(true);
    }

    async showAlias(owner, repo) {
        const m = this.config.list().find(x =>
            x.owner.toLowerCase() === owner.toLowerCase() && x.repo.toLowerCase() === repo.toLowerCase());
        this.showDialog('🏷️ 备注名', `
            <label>给 ${esc(owner)}/${esc(repo)} 起个备注（留空清除）</label>
            <input id="dlg-alias" value="${esc(m?.alias || '')}" autocomplete="off">
            <div class="dlg-acts">
                <button id="dlg-ok" class="primary">保存</button>
                <button id="dlg-cancel">取消</button>
            </div>`);
        document.getElementById('dlg-ok')?.addEventListener('click', async () => {
            const a = document.getElementById('dlg-alias').value.trim();
            this.config.setAlias(owner, repo, a);
            this.closeDialog();
            await this.saveConfig();
            this.toast('已保存备注', 'ok');
        });
        document.getElementById('dlg-cancel')?.addEventListener('click', () => this.closeDialog());
    }

    // ================= 对话框 =================

    showNewRepo() {
        this.showDialog('➕ 新建仓库', `
            <label>仓库名称</label>
            <input id="dlg-name" placeholder="my-repo" autocomplete="off">
            <label>描述（可选）</label>
            <input id="dlg-desc" placeholder="一句话说明" autocomplete="off">
            <label class="chk"><input type="checkbox" id="dlg-priv"> 设为私有</label>
            <label class="chk"><input type="checkbox" id="dlg-init" checked> 初始化 README</label>
            <label class="chk"><input type="checkbox" id="dlg-pages"> 同时启用 Pages</label>
            <div class="dlg-acts">
                <button id="dlg-ok" class="primary">创建</button>
                <button id="dlg-cancel">取消</button>
            </div>`);
        document.getElementById('dlg-name')?.focus();
        document.getElementById('dlg-ok')?.addEventListener('click', async () => {
            const name = document.getElementById('dlg-name').value.trim();
            if (!name) return this.toast('请填写仓库名', 'err');
            if (!/^[\w.-]+$/.test(name)) return this.toast('仓库名只能含字母、数字、_ . -', 'err');
            this.closeDialog();
            await this.createRepo({
                name,
                description: document.getElementById('dlg-desc').value.trim(),
                isPrivate: document.getElementById('dlg-priv').checked,
                init: document.getElementById('dlg-init').checked,
                pages: document.getElementById('dlg-pages').checked
            });
        });
        document.getElementById('dlg-cancel')?.addEventListener('click', () => this.closeDialog());
    }

    showAddRepo() {
        const managed = new Set(
            this.config.list().map(m => `${m.owner}/${m.repo}`.toLowerCase()));
        const opts = this.state.allRepos
            .filter(r => !managed.has(r.full_name.toLowerCase()))
            .slice(0, 300);

        this.showDialog('📥 添加已有仓库到管理列表', `
            <label>从你的账号中选择（共 ${opts.length} 个未管理的）</label>
            <input id="dlg-filter" placeholder="搜索仓库名…" autocomplete="off">
            <div class="pick-list" id="dlg-picks">
                ${opts.map(r => `
                    <label class="pick">
                        <input type="checkbox" value="${esc(r.full_name)}">
                        <span>${r.private ? '🔒' : '📦'} ${esc(r.full_name)}</span>
                    </label>`).join('') || '<p class="muted">没有更多可添加的仓库</p>'}
            </div>
            <hr>
            <label>或手动输入 owner/repo（可管理他人仓库，需有权限）</label>
            <input id="dlg-manual" placeholder="Cool-zimo/xiudao" autocomplete="off">
            <div class="dlg-acts">
                <button id="dlg-ok" class="primary">添加</button>
                <button id="dlg-cancel">取消</button>
            </div>`);

        const filter = document.getElementById('dlg-filter');
        filter?.addEventListener('input', () => {
            const q = filter.value.trim().toLowerCase();
            [...document.querySelectorAll('#dlg-picks .pick')].forEach(p => {
                p.style.display = p.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });

        document.getElementById('dlg-ok')?.addEventListener('click', async () => {
            const picked = [...document.querySelectorAll('#dlg-picks input:checked')]
                .map(i => i.value);
            const manual = document.getElementById('dlg-manual').value.trim();
            if (manual) picked.push(manual);
            if (!picked.length) return this.toast('请至少选择一个', 'err');

            this.closeDialog();
            let ok = 0, fail = 0, lastErr = '';
            for (const full of picked) {
                const [o, rp] = full.split('/');
                if (!o || !rp) { fail++; lastErr = `格式错误：${full}`; continue; }
                const a = this.config.add(o, rp);
                if (a.ok) ok++; else { fail++; lastErr = a.message; }
            }
            const s = await this.saveConfig();
            if (!s.ok) return this.toast('保存配置失败：' + s.message, 'err');
            this.toast(`已添加 ${ok} 个${fail ? `，${fail} 个失败 ${lastErr}` : ''}`, ok ? 'ok' : 'err');
            await this.loadAll(true);
        });
        document.getElementById('dlg-cancel')?.addEventListener('click', () => this.closeDialog());
    }

    showConfig() {
        const d = this.config.data || {};
        this.showDialog('⚙️ 配置', `
            <label>配置仓库</label>
            <p class="hint">仓鼠把「管理哪些仓库」存在这里：
                <code>${esc(this.state.user.login)}/${esc(this.config.repo)}</code>（私有）</p>
            <label>已管理 ${(d.managed || []).length} 个仓库</label>
            <div class="pick-list">
                ${(d.managed || []).map(m => `
                    <div class="pick static">
                        <span>${esc(m.owner)}/${esc(m.repo)}</span>
                        ${m.alias ? `<em>${esc(m.alias)}</em>` : ''}
                    </div>`).join('') || '<p class="muted">（空）</p>'}
            </div>
            <label>原始 JSON</label>
            <pre class="json">${esc(JSON.stringify(d, null, 2))}</pre>
            <div class="dlg-acts">
                <button id="dlg-cancel" class="primary">关闭</button>
            </div>`);
        document.getElementById('dlg-cancel')?.addEventListener('click', () => this.closeDialog());
    }

    showDialog(title, html) {
        this.dom.dlgBody.innerHTML = `<h3>${title}</h3>${html}`;
        this.dom.dlg.classList.remove('hidden');
    }

    closeDialog() {
        this.dom.dlg.classList.add('hidden');
        this.dom.dlgBody.innerHTML = '';
    }

    // ================= 工具 =================

    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast('已复制', 'ok');
        } catch {
            this.toast('复制失败，请手动选择', 'err');
        }
    }

    toast(msg, kind = '') {
        const el = this.dom.toast;
        if (!el) return;
        el.textContent = msg;
        el.className = 'toast on ' + kind;
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => { el.className = 'toast'; }, 2600);
    }
}

// ---------- 辅助函数 ----------

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function fmtSize(kb) {
    if (!kb) return '0 B';
    if (kb < 1024) return kb + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
}

export function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    if (d < 2592000) return Math.floor(d / 86400) + ' 天前';
    if (d < 31536000) return Math.floor(d / 2592000) + ' 个月前';
    return Math.floor(d / 31536000) + ' 年前';
}

/** 路径逐段编码：保留 / 分隔符，其余按 URL 编码（空格 → %20，# → %23） */
export function encodePath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
}

export function fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
        js: '📜', mjs: '📜', ts: '📘', json: '🧩', md: '📝',
        html: '🌐', css: '🎨', py: '🐍', go: '🐹',
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
        sh: '⚙️', yml: '⚙️', yaml: '⚙️', txt: '📄', zip: '🗜️'
    };
    return map[ext] || '📄';
}
