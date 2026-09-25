'use strict';

// ── State ──
let uploadedFiles = [];

// ── Tabs ──
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', (tab === 'upload' && i === 0) || (tab === 'paste' && i === 1));
    });
    document.getElementById('tab-upload').classList.toggle('active', tab === 'upload');
    document.getElementById('tab-paste').classList.toggle('active', tab === 'paste');
}

// ── Drag & drop ──
function dragOver(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.add('drag-over');
}

function dragLeave() {
    document.getElementById('drop-zone').classList.remove('drag-over');
}

function drop(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.remove('drag-over');
    const validFiles = Array.from(e.dataTransfer.files).filter(f => /\.(txt|html?)$/i.test(f.name));
    if (validFiles.length) handleFiles(validFiles);
}

function handleFiles(files) {
    uploadedFiles = Array.from(files);
    document.getElementById('file-list').innerHTML =
        uploadedFiles.map(f => `<div>${esc(f.name)}</div>`).join('');
}

// ── File reading with encoding fallback ──
async function readFileText(file) {
    const buf = await file.arrayBuffer();
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder('iso-8859-1').decode(buf);
    }
}

// ── HTML text extraction (optimizado para Wikipedia) ──
// Elementos que no forman parte del texto corrido del artículo
const HTML_NOISE = [
    'script', 'style', 'noscript', 'table', 'figure', 'math',
    'sup.reference', '.mw-editsection', '.infobox', '.navbox', '.thumb',
    '.gallery', '.hatnote', '.noprint', '.toc', '#toc', '.reflist',
    '.listaref', '.references', '.metadata', '.ambox', '.mw-empty-elt'
].join(', ');

// Secciones finales que no aportan texto corrido
const HTML_END_SECTIONS = /^(notas|referencias|bibliograf[ií]a|v[eé]ase también|enlaces externos|notes|references|bibliography|see also|external links|further reading)$/i;

function extractTextFromHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('#mw-content-text .mw-parser-output')
              || doc.querySelector('article, main, [role="main"]')
              || doc.body;

    // Cortar desde la primera sección final (Referencias, Véase también...)
    const endHeading = Array.from(root.querySelectorAll('h2'))
        .find(h => HTML_END_SECTIONS.test(h.textContent.trim()));
    if (endHeading) {
        let el = endHeading.closest('.mw-heading') || endHeading;
        while (el.parentElement && el.parentElement !== root) el = el.parentElement;
        while (el) { const next = el.nextElementSibling; el.remove(); el = next; }
    }

    root.querySelectorAll(HTML_NOISE).forEach(el => el.remove());

    return Array.from(root.querySelectorAll('p'))
        .map(p => p.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
}

// ── Text processing ──
function normalizeToken(token) {
    return token
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function detectStopwordLanguage(tokens) {
    const scores = tokens.reduce((acc, token) => {
        if (FUNCTION_WORDS_ES.has(token)) acc.es += 1;
        if (FUNCTION_WORDS_EN.has(token)) acc.en += 1;
        return acc;
    }, { es: 0, en: 0 });
    return scores.en > scores.es ? 'en' : 'es';
}

function removeFunctionWords(text) {
    const tokens = text.split(/\s+/);
    const normalizedTokens = tokens.map(normalizeToken).filter(Boolean);
    const language = detectStopwordLanguage(normalizedTokens);
    const functionWords = language === 'en' ? FUNCTION_WORDS_EN : FUNCTION_WORDS_ES;

    return text
        .split(/\s+/)
        .filter(token => {
            const normalized = normalizeToken(token);
            return normalized && !functionWords.has(normalized);
        })
        .join(' ');
}

function cleanText(text, lowercase, removeStopwords) {
    if (lowercase) text = text.toLowerCase();
    if (removeStopwords) text = removeFunctionWords(text);
    return text;
}

function tokenizeSentences(text) {
    // Protect common Spanish/academic abbreviations
    const abbrevs = ['Sr', 'Sra', 'Dr', 'Dra', 'Prof', 'Profa', 'etc', 'vs',
                     'núm', 'pág', 'págs', 'art', 'fig', 'cap', 'vol', 'ed',
                     'pp', 'p', 'ej', 'al', 'ibid', 'cf', 'op'];
    let t = text;
    abbrevs.forEach(a => {
        t = t.replace(new RegExp(`\\b${a}\\.`, 'gi'), m => m.slice(0, -1) + '\x01');
    });

    // Split at sentence boundaries: .!? optionally followed by closing quote, then space + uppercase
    const parts = t.split(/(?<=[.!?][»"']?)\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡"'«(])/);
    return parts.map(s => s.replace(/\x01/g, '.').trim()).filter(Boolean);
}

// ── Main processing ──
async function processData() {
    const segBySentences = document.getElementById('segment-sentences').checked;
    const lowercase      = document.getElementById('do-lowercase').checked;
    const removeStopwords = document.getElementById('do-remove-stopwords').checked;
    const contentKey     = document.getElementById('content-key').value.trim() || 'texto';

    const rawData = [];

    for (const file of uploadedFiles) {
        let content = await readFileText(file);
        if (/\.html?$/i.test(file.name)) content = extractTextFromHTML(content);
        content = cleanText(content, lowercase, removeStopwords);
        const chunks = segBySentences ? tokenizeSentences(content) : [content];
        chunks.forEach(s => { if (s.trim()) rawData.push({ fuente: file.name, contenido: s.trim() }); });
    }

    const manualText = document.getElementById('manual-text').value;
    if (manualText.trim()) {
        let content = cleanText(manualText, lowercase, removeStopwords);
        const chunks = segBySentences ? tokenizeSentences(content) : [content];
        chunks.forEach(s => { if (s.trim()) rawData.push({ fuente: 'entrada_manual', contenido: s.trim() }); });
    }

    renderResults(rawData, contentKey);
}

// ── Render ──
function renderResults(rawData, contentKey) {
    const labelKeys = [];  // se añaden desde la vista previa
    const resultsDiv = document.getElementById('results');

    if (!rawData.length) {
        resultsDiv.innerHTML = '<div class="info-banner">Sube archivos o pega texto para generar el dataset estructurado.</div>';
        return;
    }

    const dataset = rawData.map((item, i) => {
        const row = { id_registro: i + 1, fuente: item.fuente };
        row[contentKey] = item.contenido;
        return row;
    });

    const fullText   = dataset.map(r => r[contentKey]).join(' ');
    const allTokens  = fullText.split(/\s+/).filter(Boolean);
    const totalWords = allTokens.length;
    const totalChars = fullText.length;

    const freqMap = {};
    allTokens.forEach(t => { const w = normalizeToken(t); if (w) freqMap[w] = (freqMap[w] || 0) + 1; });
    const freqList   = Object.entries(freqMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
    const uniqueTypes = freqList.length;
    const ttr         = totalWords > 0 ? (uniqueTypes / totalWords) : 0;
    const hapaxCount  = freqList.filter(([, c]) => c === 1).length;
    const hapaxRatio  = uniqueTypes > 0 ? hapaxCount / uniqueTypes : 0;
    const top10       = freqList.slice(0, 10);
    const top20       = freqList.slice(0, 20);

    const columns  = ['id_registro', 'fuente', contentKey, ...labelKeys];

    const moreNote = dataset.length > 15
        ? `<p class="table-note">Mostrando 15 de ${dataset.length} ítems.</p>` : '';

    resultsDiv.innerHTML = `
        <div class="success-box">Procesamiento completado: <strong>${dataset.length}</strong> ítems generados.</div>

        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value">${dataset.length.toLocaleString('es')}</div>
                <div class="metric-label">Filas</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(ttr).toFixed(3)}</div>
                <div class="metric-label">TTR <span class="ttr-help" title="Type-Token Ratio: cociente entre el número de tipos (palabras únicas) y el total de tokens. Mide la riqueza léxica del corpus. Un valor cercano a 1 indica alta variedad; cercano a 0, mucha repetición.">?</span></div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(hapaxRatio * 100).toFixed(1)}%</div>
                <div class="metric-label">Hapax <span class="ttr-help" title="Porcentaje de hapax legomena: palabras que aparecen una sola vez en el corpus. Un valor alto indica riqueza léxica o escasez de datos de entrenamiento.">?</span></div>
            </div>
        </div>

        <div class="section-title">Vista previa del dataset</div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:0.5rem;">Haz clic en cualquier celda para editarla directamente. Los cambios se incluyen en la exportación — o descarga el dataset tal cual y anótalo fuera de esta herramienta.</p>
        <div class="add-label">
            <input type="text" id="new-label" placeholder="Nueva etiqueta de metadatos (separa varias con punto y coma)"
                   onkeydown="if (event.key === 'Enter') addLabel()">
            <button class="btn-add-label" onclick="addLabel()">+ Añadir etiqueta</button>
        </div>
        <div class="table-wrap">
            <table id="preview-table"></table>
        </div>
        ${moreNote}

        <hr class="divider">
        <div class="section-title">Palabras más frecuentes</div>
        <div class="freq-section">
            ${top10.map(([w, c]) => `
            <div class="freq-row">
                <span class="freq-word" title="${esc(w)}">${esc(w)}</span>
                <div class="freq-bar-bg"><div class="freq-bar" style="width:${(c / top10[0][1] * 100).toFixed(1)}%"></div></div>
                <span class="freq-count">${c}</span>
            </div>`).join('')}
        </div>
        <p class="table-note" style="margin:0.8rem 0 0">Frecuencias absolutas de las ${uniqueTypes.toLocaleString('es')} palabras distintas:</p>
        <div class="export-grid" style="grid-template-columns:repeat(2, 1fr)">
            <button class="btn-export-stats" onclick="exportFreqCSV()">Descargar frecuencias (CSV)</button>
            <button class="btn-export-stats" onclick="exportFreqXLSX()">Descargar frecuencias (Excel)</button>
        </div>

        <hr class="divider">
        <div class="section-title">Exportar dataset</div>
        <div class="export-grid">
            <button class="btn-export" onclick="exportJSON()">JSON</button>
            <button class="btn-export" onclick="exportJSONL()">JSONL</button>
            <button class="btn-export" onclick="exportCSV()">CSV</button>
            <button class="btn-export" onclick="exportXML()">XML</button>
            <button class="btn-export" onclick="exportTXT()">TXT</button>
        </div>
        <button class="btn-export-stats" onclick="exportStats()">Descargar estadísticas descriptivas (JSON)</button>
    `;

    window._ds         = dataset;
    window._contentKey = contentKey;
    window._labelKeys  = labelKeys;
    window._columns    = columns;
    window._stats      = {
        total_filas:           dataset.length,
        total_tokens:          totalWords,
        total_caracteres:      totalChars,
        types:                 uniqueTypes,
        ttr:                   parseFloat(ttr.toFixed(4)),
        hapax_legomena:        hapaxCount,
        hapax_ratio:           parseFloat(hapaxRatio.toFixed(4)),
        top_20_frecuencias:    top20.map(([w, c]) => ({ palabra: w, frecuencia: c })),
        lista_frecuencias:     freqList.map(([w, c]) => ({ palabra: w, frecuencia: c })),
    };

    renderTable();
}

function renderTable() {
    const columns = window._columns;
    const head = columns.map(c => {
        const i = window._labelKeys.indexOf(c);
        if (i === -1) return `<th>${esc(c)}</th>`;
        return `<th>${esc(c)} <button class="btn-remove-label" title="Quitar etiqueta" onclick="removeLabel(${i})">×</button></th>`;
    }).join('');

    const rows = window._ds.slice(0, 15).map((row, rowIdx) =>
        `<tr>${columns.map(c => {
            const val = esc(String(row[c] ?? ''));
            if (c === 'id_registro') return `<td>${val}</td>`;
            return `<td contenteditable="true" data-row="${rowIdx}" data-col="${esc(c)}" title="${val}">${val}</td>`;
        }).join('')}</tr>`
    ).join('');

    document.getElementById('preview-table').innerHTML =
        `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`;
}

// ── Etiquetas de metadatos (también añadibles tras procesar) ──
function sanitizeLabel(label) {
    // Sin espacios, para que sirva como nombre de columna y de elemento XML
    return label.trim().replace(/\s+/g, '_');
}

function addLabel() {
    const input = document.getElementById('new-label');
    input.value.split(';').map(sanitizeLabel).filter(Boolean).forEach(k => {
        if (window._columns.includes(k)) return;
        window._labelKeys.push(k);
        window._columns.push(k);
        window._ds.forEach(r => { r[k] = ''; });
    });
    input.value = '';
    renderTable();
}

function removeLabel(i) {
    const [k] = window._labelKeys.splice(i, 1);
    window._columns = window._columns.filter(c => c !== k);
    window._ds.forEach(r => { delete r[k]; });
    renderTable();
}

// ── Helpers ──
function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escXml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
             .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function download(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    URL.revokeObjectURL(url);
}

function outName() {
    return document.getElementById('output-name').value.trim() || 'corpus';
}

// ── Export ──
function exportJSON() {
    download(JSON.stringify(window._ds, null, 4), `${outName()}.json`, 'application/json');
}

function exportJSONL() {
    download(window._ds.map(r => JSON.stringify(r)).join('\n'), `${outName()}.jsonl`, 'application/jsonl');
}

function exportCSV() {
    const cols = window._columns;
    const rows = window._ds.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g,'""')}"`).join(','));
    // BOM para que Excel reconozca UTF-8 (tildes, ñ)
    download('\uFEFF' + [cols.join(','), ...rows].join('\n'), `${outName()}.csv`, 'text/csv;charset=utf-8');
}

function exportTXT() {
    // Un ítem por línea, solo el texto
    const lines = window._ds.map(r => String(r[window._contentKey] ?? '').replace(/\s*\n\s*/g, ' '));
    download(lines.join('\n'), `${outName()}.txt`, 'text/plain;charset=utf-8');
}

function syncCell(e) {
    const td = e.target.closest('td[contenteditable]');
    if (!td) return;
    const row = parseInt(td.dataset.row);
    const col = td.dataset.col;
    if (!isNaN(row) && col && window._ds) {
        window._ds[row][col] = td.innerText;
    }
}

document.addEventListener('input', syncCell);

function exportFreqCSV() {
    const rows = window._stats.lista_frecuencias.map(({ palabra, frecuencia }, i) =>
        `${i + 1},"${palabra.replace(/"/g,'""')}",${frecuencia}`);
    // BOM para que Excel reconozca UTF-8 (tildes, ñ)
    download('\uFEFF' + ['rango,palabra,frecuencia_absoluta', ...rows].join('\n'),
             `${outName()}_frecuencias.csv`, 'text/csv;charset=utf-8');
}

// SheetJS se carga solo al exportar a Excel (requiere conexión la primera vez)
let xlsxLoading = null;
function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxLoading ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => { xlsxLoading = null; reject(); };
        document.head.appendChild(script);
    });
    return xlsxLoading;
}

async function downloadXLSX(rows, header, sheetName, filename) {
    try {
        const XLSX = await loadXLSX();
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), sheetName);
        XLSX.writeFile(wb, filename);
    } catch {
        alert('No se pudo cargar el generador de Excel. Comprueba tu conexión o exporta en CSV.');
    }
}

function exportFreqXLSX() {
    const rows = window._stats.lista_frecuencias.map(({ palabra, frecuencia }, i) =>
        ({ rango: i + 1, palabra, frecuencia_absoluta: frecuencia }));
    downloadXLSX(rows, ['rango', 'palabra', 'frecuencia_absoluta'], 'frecuencias', `${outName()}_frecuencias.xlsx`);
}

function exportStats() {
    download(JSON.stringify(window._stats, null, 4), `${outName()}_estadisticas.json`, 'application/json');
}

function exportXML() {
    const ck  = window._contentKey;
    const lks = window._labelKeys;
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<corpus>'];
    for (const item of window._ds) {
        lines.push('  <documento>');
        lines.push(`    <id_registro>${escXml(String(item.id_registro))}</id_registro>`);
        lines.push(`    <${escXml(ck)}>${escXml(String(item[ck] ?? ''))}</${escXml(ck)}>`);
        lines.push(`    <fuente>${escXml(String(item.fuente ?? ''))}</fuente>`);
        lks.forEach(k => lines.push(`    <${escXml(k)}>${escXml(String(item[k] || 'PENDIENTE'))}</${escXml(k)}>`));
        lines.push('  </documento>');
    }
    lines.push('</corpus>');
    download(lines.join('\n'), `${outName()}.xml`, 'application/xml');
}
