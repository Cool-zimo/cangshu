/**
 * 右键菜单
 *
 * 浏览器原生右键在网页里往往被"保存图片/查看源代码"占满，
 * 这里统一接管：菜单项由调用方传入，支持分割线与危险项。
 * 边界处理：靠近视口右侧/底部时自动翻转，避免菜单被裁掉。
 */
export class ContextMenu {
    constructor() {
        this.el = null;
        this._onDocClick = null;
        this._onKey = null;
    }

    /**
     * @param {number} x 屏幕坐标（通常取 event.clientX）
     * @param {number} y
     * @param {Array} items [{ label, icon, onClick, danger, disabled, sep }]
     */
    show(x, y, items) {
        this.hide();

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
            b.innerHTML = `<span class="ctx-ico">${it.icon || ''}</span><span>${it.label}</span>`;
            b.addEventListener('click', () => {
                this.hide();
                it.onClick?.();
            });
            el.appendChild(b);
        }

        document.body.appendChild(el);

        // 先渲染再定位：需要知道菜单实际尺寸才能做边界处理
        // 统一走 Bridge.placeMenu（与 GitHub Drive 共用同一套算法）：
        // 翻转 → 夹取 → 收缩三层保险，且用 offsetWidth 避开入场动画
        // transform: scale(.96) 对 getBoundingClientRect 的干扰
        const B = window.Bridge;
        if (B && B.placeMenu) {
            B.placeMenu(el, x, y);
        } else {
            const r = el.getBoundingClientRect();
            el.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
            el.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
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
