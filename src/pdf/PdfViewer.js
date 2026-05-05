/**
 * PdfViewer.js
 * PDF 课件展示模块
 * 依赖：window.pdfjsLib（由 index.html 中的 CDN script 提供）
 */

// ── 视图切换回调（由 app-init.js 注入，避免循环依赖）────────
let _showView = () => {};
export function setShowViewCallback(fn) { _showView = fn; }

// ── 状态 ─────────────────────────────────────────────────────
let pdfDoc         = null;
let pdfCurrentPage = 1;
let pdfTotalPages  = 0;
let pdfRenderTask  = null;
let pdfLoaded      = false;

// ── 页码信息更新 ──────────────────────────────────────────────
function updatePageInfo() {
    const currentEl = document.querySelector('#pageInfo .current-page');
    const totalEl   = document.querySelector('#pageInfo .total-page');
    if (currentEl) currentEl.textContent = pdfCurrentPage;
    if (totalEl)   totalEl.textContent   = ' / ' + pdfTotalPages;

    const countBadge = document.getElementById('pdfPageCountBadge');
    if (countBadge) countBadge.textContent = pdfTotalPages + ' 页';

    document.getElementById('prevPageBtn').disabled = pdfCurrentPage <= 1;
    document.getElementById('nextPageBtn').disabled = pdfCurrentPage >= pdfTotalPages;

    document.querySelectorAll('.pdf-thumb-item').forEach(item => {
        const pg = parseInt(item.dataset.page, 10);
        item.classList.toggle('active', pg === pdfCurrentPage);
    });
}

// ── 渲染当前页到 Canvas ───────────────────────────────────────
export function renderPage(pageNum) {
    if (!pdfDoc) return Promise.resolve();

    const loadingEl = document.getElementById('pdfCanvasLoading');
    const canvas    = document.getElementById('pdfCanvas');
    const ctx       = canvas.getContext('2d');

    if (loadingEl) loadingEl.classList.remove('hidden');

    if (pdfRenderTask) {
        try { pdfRenderTask.cancel(); } catch (_) {}
        pdfRenderTask = null;
    }

    return pdfDoc.getPage(pageNum).then(page => {
        const mainEl     = document.querySelector('.pdf-main');
        const containerW = mainEl.clientWidth  - 40;
        const containerH = mainEl.clientHeight - 40;
        const naturalVP  = page.getViewport({ scale: 1 });
        const scaleW     = containerW / naturalVP.width;
        const scaleH     = containerH / naturalVP.height;
        const scale      = Math.min(scaleW, scaleH, 2.5);
        const vp         = page.getViewport({ scale });

        canvas.width  = vp.width;
        canvas.height = vp.height;
        canvas.style.width  = '';
        canvas.style.height = '';

        pdfRenderTask = page.render({ canvasContext: ctx, viewport: vp });
        return pdfRenderTask.promise;
    }).then(() => {
        if (loadingEl) loadingEl.classList.add('hidden');
        pdfRenderTask = null;
        updatePageInfo();
    }).catch(err => {
        if (err && err.name !== 'RenderingCancelledException') {
            console.error('[PDF] render error:', err);
        }
        pdfRenderTask = null;
    });
}

// ── 渲染缩略图（异步批量）────────────────────────────────────
function renderThumbnails() {
    if (!pdfDoc) return;
    const container = document.getElementById('pdfThumbnails');
    if (!container) return;
    container.innerHTML = '';

    const thumbScale = 0.18;

    function renderThumb(pageNum, thumbCanvas) {
        pdfDoc.getPage(pageNum).then(page => {
            const vp = page.getViewport({ scale: thumbScale });
            thumbCanvas.width  = vp.width;
            thumbCanvas.height = vp.height;
            return page.render({
                canvasContext: thumbCanvas.getContext('2d'),
                viewport: vp,
            }).promise;
        }).catch(() => {});
    }

    for (let i = 1; i <= pdfTotalPages; i++) {
        const pageNum    = i;
        const item       = document.createElement('div');
        item.className   = 'pdf-thumb-item' + (pageNum === pdfCurrentPage ? ' active' : '');
        item.dataset.page = pageNum;

        const thumbCanvas = document.createElement('canvas');
        const label       = document.createElement('div');
        label.className   = 'pdf-thumb-label';
        label.textContent = pageNum;
        item.appendChild(thumbCanvas);
        item.appendChild(label);

        item.addEventListener('click', () => {
            pdfCurrentPage = pageNum;
            renderPage(pageNum);
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        container.appendChild(item);

        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => renderThumb(pageNum, thumbCanvas), { timeout: 3000 });
        } else {
            setTimeout(() => renderThumb(pageNum, thumbCanvas), pageNum * 80);
        }
    }
}

// ── 加载 PDF 文件 ─────────────────────────────────────────────
export function loadPdfFile(file) {
    if (!file) return;

    if (typeof pdfjsLib === 'undefined') {
        alert('PDF.js 尚未加载完成，请稍候重试。');
        return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const nameBadge = document.getElementById('pdfFileNameBadge');
    if (nameBadge) {
        const name = file.name.length > 22 ? file.name.slice(0, 20) + '…' : file.name;
        nameBadge.textContent = name;
    }

    file.arrayBuffer().then(arrayBuffer => {
        return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    }).then(doc => {
        pdfDoc         = doc;
        pdfTotalPages  = doc.numPages;
        pdfCurrentPage = 1;
        pdfLoaded      = true;

        document.getElementById('prevPageBtn').disabled = false;
        document.getElementById('nextPageBtn').disabled = false;

        // 通知 app-init 切换视图（通过注入的回调，避免循环依赖）
        _showView('pdf');

        renderPage(1).then(() => renderThumbnails());
    }).catch(err => {
        console.error('[PDF] load error:', err);
        alert('PDF 文件加载失败：' + (err.message || err));
    });
}

// ── 查询是否已加载 PDF ───────────────────────────────────────
export function isPdfLoaded() {
    return pdfLoaded;
}

// ── 键盘快捷键（PDF 翻页）────────────────────────────────────
export function initKeyboard() {
    document.addEventListener('keydown', e => {
        const pdfViewer = document.getElementById('pdf-viewer');
        if (!pdfViewer.classList.contains('visible')) return;

        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (pdfCurrentPage > 1) { pdfCurrentPage--; renderPage(pdfCurrentPage); }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (pdfCurrentPage < pdfTotalPages) { pdfCurrentPage++; renderPage(pdfCurrentPage); }
        }
    });
}

// ── 绑定翻页按钮 ─────────────────────────────────────────────
export function initPdfButtons() {
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (pdfCurrentPage > 1) { pdfCurrentPage--; renderPage(pdfCurrentPage); }
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        if (pdfCurrentPage < pdfTotalPages) { pdfCurrentPage++; renderPage(pdfCurrentPage); }
    });

    document.getElementById('loadPdfBtn').addEventListener('click', () => {
        document.getElementById('pdfFileInput').click();
    });

    document.getElementById('pdfFileInput').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) loadPdfFile(file);
        e.target.value = '';
    });
}
