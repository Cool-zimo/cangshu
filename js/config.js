/**
 * 配置仓库 —— 把「我管理哪些仓库」存在 GitHub 上
 *
 * 为什么不放 localStorage：
 *   换台设备、换个浏览器就全丢了。存在仓库里才能多端同步，
 *   和 github_drive 的思路一致。
 *
 * 存储位置：配置仓库根目录下的 cangshu.json
 *   {
 *     "version": 1,
 *     "updatedAt": "2026-09-11T...",
 *     "managed": [
 *       { "owner": "Cool-zimo", "repo": "xiudao",
 *         "note": "", "alias": "", "addedAt": "..." }
 *     ],
 *     "settings": { "configRepo": "cangshu-config", "defaultBranch": "main" }
 *   }
 */

import { encodeBase64Utf8 } from './api.js';

export const CONFIG_FILE = 'cangshu.json';
export const DEFAULT_CONFIG_REPO = 'cangshu-config';

export class ConfigStore {
    constructor(api, owner, repoName = null) {
        this.api = api;
        this.owner = owner;
        // 允许指定仓库名：测试用它隔离到独立仓库，
        // 否则端到端测试会直接改写用户的真实配置
        this.repo = repoName || DEFAULT_CONFIG_REPO;
        this.branch = 'main';
        this._sha = null;
        this.data = null;
    }

    /** 确保配置仓库存在（不存在则自动创建，私有更安全） */
    async ensureRepo() {
        const r = await this.api.getRepo(this.owner, this.repo);
        if (r.ok) {
            this.branch = r.data.default_branch || 'main';
            return { ok: true, created: false };
        }
        if (r.status !== 404) return r;

        const c = await this.api.createRepo({
            name: this.repo,
            description: '🐹 仓鼠 · 配置文件存储（勿删）',
            private: true,
            autoInit: true
        });
        if (!c.ok) return c;
        this.branch = c.data.default_branch || 'main';
        return { ok: true, created: true };
    }

    /** 读取配置；文件不存在则视为全新配置（不算错误） */
    async load() {
        const r = await this.api.getFile(this.owner, this.repo, CONFIG_FILE, this.branch);
        if (r.ok) {
            this._sha = r.sha;
            try {
                this.data = JSON.parse(r.content);
            } catch {
                this.data = blankConfig();
            }
            return { ok: true, data: this.data };
        }
        if (r.status === 404) {
            this._sha = null;
            this.data = blankConfig();
            return { ok: true, data: this.data, fresh: true };
        }
        return r;
    }

    /**
     * 保存前把当前（服务端）版本另存一份历史快照
     *
     * 事故背景：端到端测试曾直接写真实配置仓库，
     * 一次 save() 就把用户管理列表清成空数组，且无从恢复。
     * 有了历史快照，任何一次覆盖都可追溯、可回滚。
     */
    async snapshot(reason = 'auto') {
        try {
            const r = await this.api.getFile(this.owner, this.repo, CONFIG_FILE, this.branch);
            if (!r.ok || !r.content) return { ok: false };
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const path = `history/${ts}.json`;
            const body = JSON.stringify(
                { reason, savedAt: new Date().toISOString(), config: JSON.parse(r.content) }, null, 2);
            return await this.api.putFile(
                this.owner, this.repo, path, body,
                { message: `配置快照：${reason}`, branch: this.branch }
            );
        } catch (e) {
            // 快照失败绝不能阻断正常保存
            return { ok: false, message: e.message };
        }
    }

    async save() {
        if (!this.data) return { ok: false, message: '配置尚未加载' };
        // 写前重取 sha，避免多端并发覆盖（和 github_drive 同样的问题）
        const cur = await this.api.getFile(this.owner, this.repo, CONFIG_FILE, this.branch);
        let sha = this._sha;
        if (cur.ok) sha = cur.sha;
        else if (cur.status !== 404) return cur;

        this.data.updatedAt = new Date().toISOString();
        // 覆盖前留痕：只在服务端已有配置时才快照
        if (this._sha) await this.snapshot('before-save');
        const r = await this.api.putFile(
            this.owner, this.repo, CONFIG_FILE,
            JSON.stringify(this.data, null, 2),
            { message: '🐹 更新仓鼠配置', branch: this.branch, sha }
        );
        if (r.ok) this._sha = r.data?.content?.sha || sha;
        return r;
    }

    // ---------- 管理列表 ----------

    list() {
        return this.data?.managed || [];
    }

    has(owner, repo) {
        return this.list().some(m =>
            m.owner.toLowerCase() === owner.toLowerCase() &&
            m.repo.toLowerCase() === repo.toLowerCase());
    }

    add(owner, repo, meta = {}) {
        if (this.has(owner, repo)) return { ok: false, message: '该仓库已在管理列表中' };
        this.data.managed.push({
            owner, repo,
            alias: meta.alias || '',
            note: meta.note || '',
            addedAt: new Date().toISOString()
        });
        return { ok: true };
    }

    remove(owner, repo) {
        const before = this.data.managed.length;
        this.data.managed = this.list().filter(m =>
            !(m.owner.toLowerCase() === owner.toLowerCase() &&
                m.repo.toLowerCase() === repo.toLowerCase()));
        return { ok: this.data.managed.length < before };
    }

    /** 仓库改名后同步更新配置，避免留下悬空记录 */
    rename(owner, oldName, newName) {
        const m = this.list().find(x =>
            x.owner.toLowerCase() === owner.toLowerCase() &&
            x.repo.toLowerCase() === oldName.toLowerCase());
        if (!m) return { ok: false };
        m.repo = newName;
        return { ok: true };
    }

    setAlias(owner, repo, alias) {
        const m = this.list().find(x =>
            x.owner.toLowerCase() === owner.toLowerCase() &&
            x.repo.toLowerCase() === repo.toLowerCase());
        if (!m) return { ok: false };
        m.alias = alias;
        return { ok: true };
    }
}

export function blankConfig() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        managed: [],
        settings: {
            configRepo: DEFAULT_CONFIG_REPO,
            theme: 'auto'
        }
    };
}
