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

        /**
         * 跳转到另一个应用，自动带上完整上下文
         *
         * 丝滑的关键：不只是"跳过去"，而是把当前工作状态一起带过去，
         * 对方打开就能接着干 —— 像同一个软件的两个视图。
         *
         * @param {Object} params - repo / path / view / filter 等
         * @param {Object} opts   - { saveState: 是否保存本应用状态（默认 true） }
         */
        go: function (params, opts) {
            var o = this.other();
            if (!o) return false;
            var options = opts || {};
            if (options.saveState !== false) this.saveState(options.state);

            var p = params || {};
            var cur = this.current();
            // 标记来源，对方据此显示"返回"按钮
            if (cur && !p.from) p.from = cur.id;

            var qs = Object.keys(p)
                .filter(function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; })
                .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); })
                .join('&');
            global.location.href = siblingUrl(o.seg) + (qs ? '?' + qs : '');
            return true;
        },

        /**
         * 返回上一个应用，并恢复它离开时的状态
         * 没有来源记录时，退化为普通切换
         */
        back: function (params) {
            var from = this.param('from') || this.lastFrom();
            if (!from || !APPS[from]) return this.go(params, { saveState: false });
            this.go(Object.assign({ from: '' }, params || {}));
            return true;
        },

        lastFrom: function () {
            return lsGet('bridge.lastFrom');
        },

        /** 取 URL 上的传参 */
        param: function (name) {
            try {
                return new URLSearchParams(global.location.search).get(name);
            } catch (e) { return null; }
        },

        /** 一次性取走全部上下文（读完即清，避免刷新重复触发） */
        consume: function () {
            var self = this;
            var ctx = {};
            ['repo', 'path', 'view', 'filter', 'from'].forEach(function (k) {
                var v = self.param(k);
                if (v) ctx[k] = v;
            });
            if (ctx.from) lsSet('bridge.lastFrom', ctx.from);
            if (global.location.search) this.cleanParams();
            return Object.keys(ctx).length ? ctx : null;
        },

        /** 清掉跳转带来的 query，避免刷新时重复触发 */
        cleanParams: function () {
            if (!global.location.search) return;
            try { global.history.replaceState({}, '', global.location.pathname); } catch (e) {}
        },

        /**
         * 保存本应用当前状态（滚动位置、视图、过滤词等）
         * 从对方返回时用于还原，避免"回来就回到顶部"
         */
        saveState: function (state) {
            var cur = this.current();
            if (!cur) return;
            var s = state || {};
            s.savedAt = Date.now();
            try {
                lsSet('bridge.state.' + cur.id, JSON.stringify(s));
            } catch (e) { /* 隐私模式忽略 */ }
        },

        /** 读取本应用上次保存的状态 */
        loadState: function () {
            var cur = this.current();
            if (!cur) return null;
            var raw = lsGet('bridge.state.' + cur.id);
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (e) { return null; }
        },

        /** 清除状态（避免下次无意恢复） */
        clearState: function () {
            var cur = this.current();
            if (!cur) return;
            try { lsSet('bridge.state.' + cur.id, ''); } catch (e) {}
        },

        /** 生成"快速切换"按钮的 HTML（两个应用共用同一套样式） */
        switchButtonHtml: function () {
            var o = this.other();
            if (!o) return '';
            return '<button class="app-switch-btn" id="app-switch-btn" title="切换到 ' + o.name + '">' +
                '<span class="as-icon">' + o.icon + '</span>' +
                '<span class="as-name">' + o.name + '</span>' +
                '</button>';
        },

        /**
         * 右键菜单智能定位（两个应用共用，保证行为一致）
         *
         * 朴素写法 menu.style.left = e.pageX + 'px' 有两个坑：
         *   1. CSS 是 position:fixed（视口坐标），却喂了 pageX（文档坐标）
         *      —— 页面一滚动，菜单就整体偏移一个滚动距离
         *   2. 完全没有边界处理 —— 靠近右下角时菜单直接被裁掉
         *
         * 这里的策略是三层保险：翻转 → 夹取 → 收缩
         *   ① 右侧/下方放不下就翻到另一侧
         *   ② 翻过去还放不下，就沿该方向夹进视口
         *   ③ 菜单本身就比视口大，限制尺寸并允许内部滚动
         *
         * 另外用 offsetWidth/Height 而非 getBoundingClientRect()：
         * 后者会被入场动画的 transform: scale(.96) 影响，
         * 测出偏小的尺寸，导致边界判断在临界处失效。
         *
         * @param {HTMLElement} el 菜单元素（须已可见）
         * @param {number} x 视口坐标（event.clientX）
         * @param {number} y
         * @returns {{x:number,y:number,flippedX:boolean,flippedY:boolean}}
         */
        placeMenu: function (el, x, y, opts) {
            var o = opts || {};
            var M = o.margin != null ? o.margin : 6;          // 视口安全边距
            var GAP = o.gap != null ? o.gap : 4;              // 翻转后与光标的间隙
            var vw = global.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
            var vh = global.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;

            // 重置上次可能留下的收缩状态，否则第二次打开会沿用旧尺寸
            el.style.maxWidth = '';
            el.style.maxHeight = '';
            el.style.overflowX = '';
            el.style.overflowY = '';

            var w = el.offsetWidth, h = el.offsetHeight;

            // ③ 收缩：菜单比可用空间还大
            var maxW = Math.max(80, vw - M * 2);
            var maxH = Math.max(60, vh - M * 2);
            if (vw && w > maxW) { el.style.maxWidth = maxW + 'px'; el.style.overflowX = 'auto'; w = maxW; }
            if (vh && h > maxH) { el.style.maxHeight = maxH + 'px'; el.style.overflowY = 'auto'; h = maxH; }

            // ① 优先放右/下，不够则翻转；② 翻过去仍放不下则夹住
            var px = x;
            if (vw && px + w + M > vw) {
                px = x - w - GAP;
                if (px < M) px = Math.max(M, Math.min(x, vw - w - M));
            }

            var py = y;
            if (vh && py + h + M > vh) {
                py = y - h - GAP;
                if (py < M) py = Math.max(M, Math.min(y, vh - h - M));
            }

            // ② 最终无条件夹取：
            // 光标坐标可能本身就在视口外（如 99999），
            // 翻转后依然越界，上面两个 if 都拦不住，必须再兜一次底。
            // 经过 ③ 的收缩，w/h 已不超过 vw-2M / vh-2M，此处不会算出负值。
            if (vw) px = Math.max(M, Math.min(px, vw - w - M));
            if (vh) py = Math.max(M, Math.min(py, vh - h - M));

            el.style.left = px + 'px';
            el.style.top = py + 'px';

            // 动画展开方向跟随翻转，视觉上从光标处"长出来"
            var ox = (px < x - 1) ? 'right' : 'left';
            var oy = (py < y - 1) ? 'bottom' : 'top';
            el.style.transformOrigin = oy + ' ' + ox;

            return { x: px, y: py, flippedX: px < x - 1, flippedY: py < y - 1 };
        },

        /**
         * 生成"应用栏"HTML：两个应用平铺，当前的高亮
         * 视觉上像同一个软件的两个标签页
         */
        appBarHtml: function () {
            var cur = this.current();
            if (!cur) return '';
            var self = this;
            var items = Object.keys(APPS).map(function (k) {
                var a = APPS[k];
                var on = cur.id === a.id;
                return '<button class="ab-item' + (on ? ' on' : '') + '" data-app="' + a.id + '"' +
                    (on ? ' aria-current="page"' : '') +
                    ' title="' + (on ? '当前：' : '切换到 ') + a.name + '">' +
                    '<span class="ab-icon">' + a.icon + '</span>' +
                    '<span class="ab-name">' + a.name + '</span>' +
                    (on ? '<span class="ab-dot"></span>' : '') +
                    '</button>';
            }).join('');
            return '<div class="app-bar" id="app-bar">' + items + '</div>';
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Bridge;
    else global.Bridge = Bridge;
})(typeof window !== 'undefined' ? window : globalThis);
