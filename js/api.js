/**
 * GitHub REST API 封装
 *
 * 设计要点：
 *   · 统一错误归一化：HTTP 错误转成 { ok:false, status, message }，
 *     上层不用再猜 e.status 是否存在（403/404/422 各有不同含义）
 *   · 写操作前自动取 sha：更新/删除文件必须带 sha，否则 422
 *   · 令牌只从参数传入，不落全局变量、不写 localStorage 之外的任何地方
 */

export class GitHubAPI {
    constructor(token) {
        this.token = token;
        this.base = 'https://api.github.com';
    }

    setToken(token) { this.token = token; }

    async _req(path, { method = 'GET', body = null, raw = false } = {}) {
        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'cangshu-app'
            }
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }

        let res;
        try {
            res = await fetch(this.base + path, opts);
        } catch (e) {
            // 网络层失败（断网 / CORS / 代理拦截）
            return { ok: false, status: 0, message: '网络请求失败：' + e.message };
        }

        if (res.status === 204) return { ok: true, status: 204, data: null };

        let data = null;
        const text = await res.text();
        if (text) {
            try { data = JSON.parse(text); }
            catch { data = raw ? text : { message: text.slice(0, 200) }; }
        }

        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                message: this._explain(res.status, data?.message),
                data
            };
        }
        return { ok: true, status: res.status, data };
    }

    /** 把 HTTP 状态码翻译成人话 */
    _explain(status, msg) {
        const map = {
            400: '请求格式有误',
            401: '令牌无效或已过期，请重新登录',
            403: '权限不足（令牌缺少对应 scope）或触发了接口限流',
            404: '资源不存在，或令牌无权访问该私有仓库',
            409: '冲突（仓库为空时无法读取内容）',
            422: '参数校验失败' + (msg ? '：' + msg : ''),
            451: '该操作因法律原因不可用',
            500: 'GitHub 服务端异常，请稍后重试'
        };
        return map[status] || (msg || `请求失败（HTTP ${status}）`);
    }

    // ---------- 账号 ----------

    async whoami() {
        return this._req('/user');
    }

    // ---------- 仓库 ----------

    /** 当前账号可见的全部仓库（自动翻页，避免超过 100 个被截断） */
    async listAllRepos({ perPage = 100, maxPages = 10 } = {}) {
        const all = [];
        for (let page = 1; page <= maxPages; page++) {
            const r = await this._req(
                `/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
            );
            if (!r.ok) return r;
            // 防御：GitHub 若返回非数组（异常/代理拦截/限流提示），
            // 直接 spread 会抛 TypeError 让整个面板崩掉
            if (!Array.isArray(r.data)) {
                return {
                    ok: false,
                    status: r.status,
                    message: '仓库列表格式异常：' + JSON.stringify(r.data).slice(0, 120)
                };
            }
            all.push(...r.data);
            if (r.data.length < perPage) break;
        }
        return { ok: true, data: all };
    }

    async getRepo(owner, repo) {
        return this._req(`/repos/${owner}/${repo}`);
    }

    /** 新建仓库 */
    async createRepo({ name, description = '', private: isPrivate = false, autoInit = true }) {
        return this._req('/user/repos', {
            method: 'POST',
            body: { name, description, private: isPrivate, auto_init: autoInit }
        });
    }

    /** 改仓库属性：name / description / private / homepage */
    async updateRepo(owner, repo, patch) {
        return this._req(`/repos/${owner}/${repo}`, { method: 'PATCH', body: patch });
    }

    async renameRepo(owner, repo, newName) {
        return this.updateRepo(owner, repo, { name: newName });
    }

    async setVisibility(owner, repo, isPrivate) {
        return this.updateRepo(owner, repo, { private: isPrivate });
    }

    /** 删除仓库（危险操作，调用方必须先二次确认） */
    async deleteRepo(owner, repo) {
        return this._req(`/repos/${owner}/${repo}`, { method: 'DELETE' });
    }

    // ---------- 内容（读写文件） ----------

    /** 读文件内容，返回 { sha, content(解码后), size } */
    async getFile(owner, repo, path, branch) {
        const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
        const r = await this._req(`/repos/${owner}/${repo}/contents/${path}${q}`);
        if (!r.ok) return r;
        const d = r.data;
        if (d.encoding !== 'base64') {
            return { ok: false, message: `暂不支持的编码：${d.encoding}` };
        }
        // 中文安全：先解码 Latin-1 再按 UTF-8 还原（Node 环境用 Buffer 兜底）
        return {
            ok: true,
            sha: d.sha,
            content: decodeBase64Utf8(d.content),
            size: d.size
        };
    }

    /** 写入/更新文件（存在则覆盖，需 sha） */
    async putFile(owner, repo, path, content, { message, branch = 'main', sha = null } = {}) {
        const body = {
            message: message || `chore: update ${path}`,
            content: encodeBase64Utf8(content),
            branch
        };
        if (sha) body.sha = sha;
        return this._req(`/repos/${owner}/${repo}/contents/${path}`, {
            method: 'PUT', body
        });
    }

    /** 递归文件树 */
    async getTree(owner, repo, branch = 'HEAD') {
        return this._req(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    }

    // ---------- 提交 / 分支 ----------

    async listCommits(owner, repo, { perPage = 1 } = {}) {
        return this._req(`/repos/${owner}/${repo}/commits?per_page=${perPage}`);
    }

    async listBranches(owner, repo) {
        return this._req(`/repos/${owner}/${repo}/branches`);
    }

    /** 默认分支：优先仓库声明，回退 main */
    async defaultBranch(owner, repo) {
        const r = await this.getRepo(owner, repo);
        if (r.ok && r.data?.default_branch) return r.data.default_branch;
        return 'main';
    }

    // ---------- Pages ----------

    async getPages(owner, repo) {
        return this._req(`/repos/${owner}/${repo}/pages`);
    }

    async getPagesBuilds(owner, repo) {
        return this._req(`/repos/${owner}/{repo}/pages/builds?per_page=1`.replace('{repo}', repo));
    }

    /** 启用 Pages（source=branch + 路径） */
    async enablePages(owner, repo, branch = 'main', path = '/') {
        return this._req(`/repos/${owner}/${repo}/pages`, {
            method: 'POST',
            body: { source: { branch, path } }
        });
    }

    async requestPagesBuild(owner, repo) {
        return this._req(`/repos/${owner}/${repo}/pages/builds`, { method: 'POST' });
    }
}

// ---------- base64（中文安全） ----------

export function encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

export function decodeBase64Utf8(b64) {
    const clean = b64.replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}
