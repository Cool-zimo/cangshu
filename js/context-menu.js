/**
 * 右键菜单
 *
 * 浏览器原生右键在网页里往往被"保存图片/查看源代码"占满，
 * 这里统一接管：菜单项由调用方传入，支持分割线与危险项。
 *
 * 实际渲染委托给 Bridge.createMenu（与 GitHub Drive 共用同一实现），
 * 因此两个应用的菜单外观、边界翻转、二级菜单行为完全一致。
 * Bridge 不可用时降级为内置的简单渲染，保证功能不丢。
 */
export class ContextMenu {
    constructor() {
        this.el = null;
        this._bridge = null;      // Bridge.createMenu 返回的实例
        this._onDocClick = null;
        this._onKey = null;
    }

    /**
     * @param {number} x 屏幕坐标（通常取 event.clientX，视口坐标）
     * @param {number} y
     * @param {Array} items [{ label, icon, onClick, danger, disabled, sep, children }]
     */
    show(x, y, items) {
        this.hide();

        const B = (typeof window !== 'undefined') ? window.Bridge : null;
        if (B && B.createMenu) {
            // 共用实现：自带边界翻转、夹取、收缩与二级菜单
            this._bridge = B.createMenu(items, { onClose: () => { this._bridge = null; } });
            this._bridge.show(x, y);
            return;
        }

        // ---------- 降级渲染 ----------
        const el = document.createElement('div');
        el.className = 'ctx-menu';

        for (const it of items) {
            if (it.sep) {
                const s = document.createElement('div');
                s.className = 'ctx-sep';
                el.appendChild(s);
                continue;
            }
            const b = document.createElement('button');
            b.className = 'ctx-item' + (it.danger ? ' danger' : '');
            b.disabled = !!it.disabled;
            b.innerHTML = `<span class="ctx-ico">${it.icon || ''}</span><span class="ctx-label"></span>`;
            b.querySelector('.ctx-label').textContent = it.label;
            b.addEventListener('click', () => {
                this.hide();
                it.onClick?.();
            });
            el.appendChild(b);
        }

        document.body.appendChild(el);

        // 先渲染再定位：需要知道菜单实际尺寸才能做边界处理
        // 用 offsetWidth 而非 getBoundingClientRect，避开入场动画
        // transform: scale(.96) 造成的尺寸偏小
        if (B && B.placeMenu) {
            B.placeMenu(el, x, y);
        } else {
            const w = el.offsetWidth, h = el.offsetHeight;
            el.style.left = Math.max(4, Math.min(x, (window.innerWidth || 0) - w - 8)) + 'px';
            el.style.top = Math.max(4, Math.min(y, (window.innerHeight || 0) - h - 8)) + 'px';
        }
        el.classList.add('on');

        this.el = el;

        // 点别处 / 按 Esc 关闭
        this._onDocClick = (e) => { if (!el.contains(e.target)) this.hide(); };
        this._onKey = (e) => { if (e.key === 'Escape') this.hide(); };
        // 用捕获阶段，保证在目标元素的 click 之前移除监听
        setTimeout(() => {
            document.addEventListener('click', this._onDocClick, true);
            document.addEventListener('contextmenu', this._onDocClick, true);
            document.addEventListener('keydown', this._onKey);
        }, 0);
    }

    hide() {
        if (this._bridge) { this._bridge.hide(); this._bridge = null; }
        if (this.el) {
            this.el.remove();
            this.el = null;
        }
        if (this._onDocClick) {
            document.removeEventListener('click', this._onDocClick, true);
            document.removeEventListener('contextmenu', this._onDocClick, true);
            this._onDocClick = null;
        }
        if (this._onKey) {
            document.removeEventListener('keydown', this._onKey);
            this._onKey = null;
        }
    }
}
