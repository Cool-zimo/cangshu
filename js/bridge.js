/**
 * 应用间联动桥（Bridge）
 *
 * 关键前提：GitHub Drive 与仓鼠都部署在同一个 origin 下
 *   https://cool-zimo.github.io/github_drive/
 *   https://cool-zimo.github.io/cangshu/
 * 同源 → localStorage 天然共享 → 令牌可以互认，
 * 登录一个，另一个免登录，这才是真正的「丝滑」。
 *
 * 本文件在两个仓库里各存一份，内容完全一致。
 * 同时兼容普通脚本与 ES module 两种加载方式。
 */
(function (global) {
    'use strict';

    var APPS = {
        drive: {
            id: 'drive',
            seg: 'github_drive',
            name: 'GitHub Drive',
            icon: '📁',
            tokenKey: 'github_drive_token',
            userKey: 'github_drive_user'
        },
        cangshu: {
            id: 'cangshu',
            seg: 'cangshu',
            name: '仓鼠',
            icon: '🐹',
            tokenKey: 'cangshu.token',
            userKey: 'cangshu.user'
        }
    };

    /** 安全读 localStorage（隐私模式会抛异常） */
    function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }

    /**
     * 计算同一 origin 下另一个应用的 URL
     * 只替换 pathname 的第一段，因此本地 localhost 跑也能对跳
     */
    function siblingUrl(seg, path) {
        // 只保留第一段并替换，其余路径段一律丢弃：
        // 两个应用的文件结构完全不同（如 /github_drive/index.html
        // 换成 cangshu 后会拼出 /cangshu/index.html/ 这种错误地址），
        // 跨应用跳转本就不该继承路径
        var u = global.location.origin + '/' + seg + '/';
        if (path) u += String(path).replace(/^\//, '');
        return u;
    }

    var Bridge = {
        APPS: APPS,

        /** 当前应用是谁（按 URL 第一段判断） */
        current: function () {
            var seg = (global.location.pathname || '/').split('/').filter(Boolean)[0] || '';
            for (var k in APPS) if (APPS[k].seg === seg) return APPS[k];
            return null;
        },

        /** 对方应用 */
        other: function () {
            var cur = this.current();
            if (!cur) return null;
            return cur.id === 'drive' ? APPS.cangshu : APPS.drive;
        },

        /**
         * 从任意已知位置找令牌
         * 优先本应用自己的 key，其次对方的（实现"沿用账号"）
         */
        findToken: function (preferSelf) {
            var cur = this.current();
            var order = [];
            if (preferSelf !== false && cur) order.push(cur.tokenKey);
            for (var k in APPS) {
                if (order.indexOf(APPS[k].tokenKey) < 0) order.push(APPS[k].tokenKey);
            }
            // 兼容旧版 github_drive 存在 storage 前缀下的写法
            order.push('github_drive_token');
            for (var i = 0; i < order.length; i++) {
                var v = lsGet(order[i]);
                if (v && /^(ghp_|github_pat_)/.test(v)) return v;
            }
            return null;
        },

        /** 找已保存的用户信息（尽力而为，解析失败不影响） */
        findUser: function () {
            var cur = this.current();
            var keys = [];
            if (cur) keys.push(cur.userKey);
            for (var k in APPS) if (keys.indexOf(APPS[k].userKey) < 0) keys.push(APPS[k].userKey);
            for (var i = 0; i < keys.length; i++) {
                var raw = lsGet(keys[i]);
                if (!raw) continue;
                try {
                    var u = JSON.parse(raw);
                    if (u && u.login) return u;
                } catch (e) { /* 不是 JSON，跳过 */ }
            }
            return null;
        },

        /**
         * 把令牌写到所有应用的位置
         * 这样两边都变成"已登录"状态
         */
        saveToken: function (token, user) {
            for (var k in APPS) {
                lsSet(APPS[k].tokenKey, token);
                if (user) lsSet(APPS[k].userKey, JSON.stringify(user));
            }
        },

        /** 对方是否已登录（用于显示"沿用账号"提示） */
        otherHasToken: function () {
            var o = this.other();
            if (!o) return false;
            var t = lsGet(o.tokenKey);
            return !!(t && /^(ghp_|github_pat_)/.test(t));
        },

        /** 跳转到另一个应用，可带上下文参数 */
        go: function (params) {
            var o = this.other();
            if (!o) return false;
            var p = params || {};
            var qs = Object.keys(p)
                .filter(function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; })
                .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); })
                .join('&');
            global.location.href = siblingUrl(o.seg) + (qs ? '?' + qs : '');
            return true;
        },

        /** 取 URL 上的传参 */
        param: function (name) {
            try {
                return new URLSearchParams(global.location.search).get(name);
            } catch (e) { return null; }
        },

        /** 清掉跳转带来的 query，避免刷新时重复触发 */
        cleanParams: function () {
            if (!global.location.search) return;
            try { global.history.replaceState({}, '', global.location.pathname); } catch (e) {}
        },

        /** 生成"快速切换"按钮的 HTML（两个应用共用同一套样式） */
        switchButtonHtml: function () {
            var o = this.other();
            if (!o) return '';
            return '<button class="app-switch-btn" id="app-switch-btn" title="切换到 ' + o.name + '">' +
                '<span class="as-icon">' + o.icon + '</span>' +
                '<span class="as-name">' + o.name + '</span>' +
                '</button>';
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Bridge;
    else global.Bridge = Bridge;
})(typeof window !== 'undefined' ? window : globalThis);
