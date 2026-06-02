/**
 * app.js
 * Manages the UI events, canvas image processing,
 * Gemini API integration, and table interactions.
 */

// API Configuration
const GEMINI_API_KEY = "AQ.Ab8RN6LzkNoxLmJ0LxK4o8sPmT93UXB4KDcF7iRU17sos9OFlA";

// Global State
let originalImage = null;
let parsedMenuItems = [];
const parser = new MenuParser();

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const editorSection = document.getElementById('editor-section');
const previewCanvas = document.getElementById('preview-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const resultsCard = document.getElementById('results-card');
const ocrBtn = document.getElementById('ocr-btn');
const progressCard = document.getElementById('progress-card');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressDetails = document.getElementById('progress-details');
const menuTableBody = document.getElementById('menu-table-body');
const totalItemsText = document.getElementById('total-items');
const avgPriceText = document.getElementById('avg-price');
const maxPriceText = document.getElementById('max-price');
const emptyState = document.getElementById('empty-state');
const resetBtn = document.getElementById('reset-btn');
const addRowBtn = document.getElementById('add-row-btn');

// Preprocessing controls
const brightnessCtrl = document.getElementById('brightness-ctrl');
const contrastCtrl = document.getElementById('contrast-ctrl');
const binarizeCtrl = document.getElementById('binarize-ctrl');
const thresholdCtrl = document.getElementById('threshold-ctrl');
const brightnessVal = document.getElementById('brightness-val');
const contrastVal = document.getElementById('contrast-val');
const thresholdVal = document.getElementById('threshold-val');
const thresholdGroup = document.getElementById('threshold-group');

// Initialize Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initUploadEvents();
    initFilterEvents();
    initTableEvents();
    initExportEvents();
});

// Setup File Upload & Drag and Drop Events
function initUploadEvents() {
    // Click to upload
    dropZone.addEventListener('click', () => fileInput.click());

    // Stop propagation of click events from bubbling to dropZone parent
    fileInput.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    fileInput.addEventListener('change', handleFileSelect);

    // Drag events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    ['dragleave', 'dragend', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            processUploadedFile(files[0]);
        }
    });
}

// Handle File Input Selection
function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        processUploadedFile(e.target.files[0]);
    }
}

// Read and load image
function processUploadedFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast('이미지 파일만 업로드할 수 있습니다.', 'danger');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        originalImage = new Image();
        originalImage.onload = () => {
            setupCanvasSize();
            preprocessImage();
            editorSection.style.display = 'flex';
            ocrBtn.disabled = false;
            document.body.setAttribute('data-step', 'edit');
            
            // Scroll smoothly to editor
            editorSection.scrollIntoView({ behavior: 'smooth' });
            showToast('이미지가 성공적으로 로드되었습니다.');
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

// Setup Canvas width & height based on image aspect ratio
function setupCanvasSize() {
    if (!originalImage) return;

    // Define max bounds for processing canvas to keep operations speedy
    const MAX_DIMENSION = 2000;
    let width = originalImage.width;
    let height = originalImage.height;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
        } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
        }
    }

    previewCanvas.width = width;
    previewCanvas.height = height;
    
    // Match overlay canvas size
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    
    // Clear overlay canvas
    const oCtx = overlayCanvas.getContext('2d');
    oCtx.clearRect(0, 0, width, height);
}

// Setup Preprocessing Filters Listeners
function initFilterEvents() {
    brightnessCtrl.addEventListener('input', (e) => {
        brightnessVal.textContent = e.target.value;
        preprocessImage();
    });

    contrastCtrl.addEventListener('input', (e) => {
        contrastVal.textContent = e.target.value;
        preprocessImage();
    });

    binarizeCtrl.addEventListener('change', (e) => {
        if (e.target.checked) {
            thresholdGroup.style.display = 'flex';
        } else {
            thresholdGroup.style.display = 'none';
        }
        preprocessImage();
    });

    thresholdCtrl.addEventListener('input', (e) => {
        thresholdVal.textContent = e.target.value;
        preprocessImage();
    });

    resetBtn.addEventListener('click', () => {
        brightnessCtrl.value = 0;
        brightnessVal.textContent = '0';
        contrastCtrl.value = 0;
        contrastVal.textContent = '0';
        binarizeCtrl.checked = false;
        thresholdCtrl.value = 128;
        thresholdVal.textContent = '128';
        thresholdGroup.style.display = 'none';
        
        setupCanvasSize();
        preprocessImage();
        showToast('필터 설정이 초기화되었습니다.');
    });

    // Run OCR button click
    ocrBtn.addEventListener('click', runOCR);
}

// Apply Image Filters (Contrast, Brightness, Binarization)
function preprocessImage() {
    if (!originalImage) return;

    const ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.drawImage(originalImage, 0, 0, previewCanvas.width, previewCanvas.height);

    const bVal = parseInt(brightnessCtrl.value);
    const cVal = parseInt(contrastCtrl.value);
    const isBinarize = binarizeCtrl.checked;
    const tVal = parseInt(thresholdCtrl.value);

    const imageData = ctx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    const data = imageData.data;

    // Contrast Factor calculation
    // contrast value goes from -100 to 100
    const factor = (259 * (cVal + 255)) / (255 * (259 - cVal));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. Apply Brightness
        if (bVal !== 0) {
            r += bVal;
            g += bVal;
            b += bVal;
        }

        // 2. Apply Contrast
        if (cVal !== 0) {
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
        }

        // 3. Optional Binarization / Grayscale
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        
        if (isBinarize) {
            const val = gray >= tVal ? 255 : 0;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
        } else {
            // Clamp RGB values
            data[i] = Math.min(255, Math.max(0, r));
            data[i + 1] = Math.min(255, Math.max(0, g));
            data[i + 2] = Math.min(255, Math.max(0, b));
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
}

// Update OCR Loading Progress Bar UI
function updateProgress(percent, statusText, detailText = '') {
    progressCard.style.display = 'block';
    progressBar.style.width = `${percent}%`;
    progressText.textContent = statusText;
    progressDetails.textContent = detailText;
}

// Run Gemini Vision AI engine
async function runOCR() {
    if (!originalImage) return;

    ocrBtn.disabled = true;
    document.body.setAttribute('data-step', 'analyzing');

    updateProgress(20, 'Vision AI 분석 요청 중...', 'Gemini 인공지능 서버에 메뉴 분석을 요청하고 있습니다.');

    try {
        // Get base64 data from previewCanvas
        const dataUrl = previewCanvas.toDataURL('image/jpeg', 0.85);
        const base64Data = dataUrl.split(',')[1]; // Remove prefix "data:image/jpeg;base64,"

        // Define Gemini generate content endpoint using gemini-2.5-flash
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `제공된 이미지에서 모든 메뉴 이름과 해당 가격을 추출하라.

규칙:
1. 가격은 '원', ',', '.', '천원' 등의 단위나 텍스트 기호를 모두 제거하고 오직 순수한 숫자(Integer) 형태로만 정제하라. (예: '7,050원' -> 7050, '7.0' -> 7000)
2. 메뉴명과 가격의 물리적 거리가 멀거나 줄바꿈이 불규칙해도 문맥을 파악하여 정확히 1:1로 매칭하라.

반드시 아래와 같이 'menu_items' 키에 배열이 들어있는 JSON 객체 형식으로만 답해야 하고 백틱(\`\`\`json) 마크다운은 붙이지 마라:
{
  "menu_items": [
    { "menu_name": "메뉴이름1", "price": 10000 },
    { "menu_name": "메뉴이름2", "price": 8000 }
  ]
}`
                            },
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: base64Data
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json'
                }
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error ? errData.error.message : 'API 호출에 실패했습니다.');
        }

        updateProgress(80, '데이터 파싱 중...', '분석 결과를 정리하고 있습니다.');

        const resJson = await response.json();
        const textResponse = resJson.candidates[0].content.parts[0].text;
        const parsedRes = JSON.parse(textResponse);
        const rawItems = parsedRes.menu_items || parsedRes;

        // Map to parsedMenuItems structure
        parsedMenuItems = (Array.isArray(rawItems) ? rawItems : []).map(item => ({
            name: item.menu_name || item.name || '이름 없음',
            price: item.price ? `${item.price.toLocaleString()}원` : '-',
            rawPrice: parseInt(item.price, 10) || 0,
            confidence: 100,
            bbox: null // Bounding boxes are not available for Gemini API
        }));

        // Clear overlay canvas
        const oCtx = overlayCanvas.getContext('2d');
        oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        updateProgress(100, '분석 완료!', '메뉴 정보를 성공적으로 불러왔습니다.');

        setTimeout(() => {
            progressCard.style.display = 'none';
            ocrBtn.disabled = false;
            renderMenuTable();
            
            resultsCard.classList.add('active');
            document.body.setAttribute('data-step', 'done');
            resultsCard.scrollIntoView({ behavior: 'smooth' });

            if (parsedMenuItems.length > 0) {
                showToast(`Vision AI가 총 ${parsedMenuItems.length}개의 메뉴를 완벽하게 추출했습니다.`, 'success');
            } else {
                showToast('메뉴 데이터를 식별하지 못했습니다.', 'warning');
            }
        }, 800);

    } catch (e) {
        console.error('Gemini Vision AI Error: ', e);
        updateProgress(0, '오류 발생', e.message);
        ocrBtn.disabled = false;
        document.body.setAttribute('data-step', 'edit');
        showToast('Vision AI 분석 실패: ' + e.message, 'danger');
    }
}

// Build table elements from data
function renderMenuTable() {
    menuTableBody.innerHTML = '';
    
    if (parsedMenuItems.length === 0) {
        emptyState.style.display = 'flex';
        updateSummary();
        return;
    }
    
    emptyState.style.display = 'none';

    parsedMenuItems.forEach((item, index) => {
        const row = document.createElement('tr');
        row.dataset.index = index;
        
        row.innerHTML = `
            <td style="color: var(--text-dim); text-align: center; width: 60px;">${index + 1}</td>
            <td>
                <input type="text" class="cell-input name-input" value="${escapeHtml(item.name)}" placeholder="메뉴 이름 입력">
            </td>
            <td>
                <input type="text" class="cell-input price-input" value="${escapeHtml(item.price)}" placeholder="가격 입력 (예: 12,000원)">
            </td>
            <td class="row-action">
                <button class="btn-delete" title="삭제">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
            </td>
        `;
        menuTableBody.appendChild(row);
    });

    updateSummary();
}

// Listen to cell modifications and rows management
function initTableEvents() {
    // Delete row
    menuTableBody.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.btn-delete');
        if (!deleteBtn) return;

        const row = deleteBtn.closest('tr');
        const index = parseInt(row.dataset.index);
        
        parsedMenuItems.splice(index, 1);
        
        // Re-render table
        renderMenuTable();
        showToast('메뉴가 삭제되었습니다.', 'warning');
    });

    // Update value when editing text input
    menuTableBody.addEventListener('input', (e) => {
        const input = e.target.closest('.cell-input');
        if (!input) return;

        const row = input.closest('tr');
        const index = parseInt(row.dataset.index);
        const item = parsedMenuItems[index];

        if (input.classList.contains('name-input')) {
            item.name = input.value;
        } else if (input.classList.contains('price-input')) {
            item.price = input.value;
            // Parse updated numerical price in background
            const numericInfo = parser.parsePriceValue(input.value);
            if (numericInfo) {
                item.rawPrice = numericInfo.rawPrice;
            } else {
                item.rawPrice = 0; // Invalid price
            }
            updateSummary(); // Recompute totals in real-time
        }
    });

    // Manual Row addition
    addRowBtn.addEventListener('click', () => {
        const newItem = {
            name: '',
            price: '',
            rawPrice: 0,
            confidence: 100,
            bbox: null
        };
        
        parsedMenuItems.push(newItem);
        renderMenuTable();
        
        // Scroll to the bottom of the table
        const container = document.querySelector('.menu-table-container');
        container.scrollTop = container.scrollHeight;
        
        // Focus on the newly created name input
        const newRow = menuTableBody.lastElementChild;
        if (newRow) {
            newRow.querySelector('.name-input').focus();
        }
        
        showToast('새 메뉴가 추가되었습니다.');
    });
}

// Re-calculate statistics for the summary footer
function updateSummary() {
    const totalCount = parsedMenuItems.length;
    
    let sum = 0;
    let validPricesCount = 0;
    let maxPriceVal = -Infinity;
    let maxPriceItemName = '-';

    parsedMenuItems.forEach(item => {
        if (item.rawPrice && item.rawPrice > 0) {
            sum += item.rawPrice;
            validPricesCount++;

            if (item.rawPrice > maxPriceVal) {
                maxPriceVal = item.rawPrice;
                maxPriceItemName = item.name || '이름 없음';
            }
        }
    });

    const averagePrice = validPricesCount > 0 ? Math.round(sum / validPricesCount) : 0;

    totalItemsText.textContent = `${totalCount}개`;
    avgPriceText.textContent = averagePrice > 0 ? `${averagePrice.toLocaleString()}원` : '-';
    maxPriceText.textContent = maxPriceVal > -Infinity ? `${maxPriceItemName} (${maxPriceVal.toLocaleString()}원)` : '-';

    // Save to local storage for the ordering room to import automatically
    const menuDataForRoom = parsedMenuItems.map(item => ({
        menu_name: item.name || '이름 없음',
        price: item.rawPrice || 0
    }));
    localStorage.setItem('last_ocr_menu', JSON.stringify(menuDataForRoom, null, 2));
}

// Exports configuration (CSV, JSON, Copy to Clipboard)
function initExportEvents() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        if (parsedMenuItems.length === 0) return;

        let csvContent = '\uFEFF'; // UTF-8 BOM
        csvContent += '번호,메뉴 이름,가격\n';
        
        parsedMenuItems.forEach((item, index) => {
            // Escape double quotes inside values
            const cleanName = (item.name || '').replace(/"/g, '""');
            const cleanPrice = (item.price || '').replace(/"/g, '""');
            csvContent += `${index + 1},"${cleanName}","${cleanPrice}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `menu_list_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('CSV 파일이 다운로드되었습니다.', 'success');
    });

    document.getElementById('export-json-btn').addEventListener('click', () => {
        if (parsedMenuItems.length === 0) return;

        const cleanList = parsedMenuItems.map((item, idx) => ({
            id: idx + 1,
            name: item.name,
            price_text: item.price,
            price_value: item.rawPrice
        }));

        const jsonStr = JSON.stringify(cleanList, null, 4);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `menu_list_${new Date().toISOString().slice(0,10)}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('JSON 파일이 다운로드되었습니다.', 'success');
    });

    document.getElementById('copy-clipboard-btn').addEventListener('click', () => {
        if (parsedMenuItems.length === 0) return;

        let textString = '';
        parsedMenuItems.forEach((item) => {
            textString += `${item.name || '이름 없음'}\t${item.price || ''}\n`;
        });

        navigator.clipboard.writeText(textString).then(() => {
            showToast('텍스트가 클립보드에 복사되었습니다.', 'success');
        }).catch(err => {
            console.error('Copy to clipboard failed: ', err);
            showToast('복사에 실패했습니다.', 'danger');
        });
    });
}

// Helpers
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message, type = 'primary') {
    const oldToast = document.querySelector('.toast');
    if (oldToast) {
        oldToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    
    let icon = '';
    if (type === 'success') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'warning') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else if (type === 'danger') {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else {
        icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 100);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}
