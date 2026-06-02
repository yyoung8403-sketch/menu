/**
 * room.js
 * Manages the routing, Supabase connections, database updates,
 * participant selections, and real-time dashboard calculations.
 */

// Global State
let supabaseClient = null;
let currentRoomId = null;
let currentMenu = []; // Stores menu items [{ id, name, price }]
let selectedQuantities = {}; // Participant selections { menuItemId: quantity }
let isRoomClosed = false;

// ==========================================
// 🔑 SUPABASE HARDCODED CONFIGURATION
// ==========================================
const SUPABASE_URL = "https://apltvydxlsbgsauqfext.supabase.co";
const SUPABASE_KEY = "sb_publishable_AZLxRS8NANTo-KA6pPfoag_Hb_DlCxy";

// DOM View Elements
const views = {
    create: document.getElementById('create-view'),
    share: document.getElementById('share-view'),
    entry: document.getElementById('entry-view'),
    menuSelect: document.getElementById('menu-select-view'),
    success: document.getElementById('success-view'),
    dashboard: document.getElementById('dashboard-view')
};

// Initialize app on load
window.addEventListener('DOMContentLoaded', () => {
    initApp();
    window.addEventListener('hashchange', routePage);
});

// Setup Initial Client and Router
function initApp() {
    // Initialize Supabase Client directly using hardcoded credentials
    try {
        let url = SUPABASE_URL;
        let key = SUPABASE_KEY;

        // Fallback to localStorage if placeholders are not replaced yet
        if (url === "YOUR_SUPABASE_URL" || key === "YOUR_SUPABASE_ANON_KEY") {
            const savedUrl = localStorage.getItem('supabase_url');
            const savedKey = localStorage.getItem('supabase_key');
            if (savedUrl && savedKey) {
                url = savedUrl;
                key = savedKey;
            }
        }

        if (url === "YOUR_SUPABASE_URL" || key === "YOUR_SUPABASE_ANON_KEY") {
            showToast('room.js 상단의 Supabase URL과 Anon Key를 입력해 주세요.', 'warning');
        } else {
            supabaseClient = supabase.createClient(url, key);
        }
        routePage();
    } catch (e) {
        console.error('Supabase init failed:', e);
        showToast('Supabase 연결 초기화 실패: ' + e.message, 'danger');
    }

    // Create room listener
    document.getElementById('create-room-btn').addEventListener('click', createRoom);

    // Join room listener
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);

    // Submit order listener
    document.getElementById('submit-order-btn').addEventListener('click', submitOrder);

    // Re-edit order listener
    document.getElementById('re-edit-order-btn').addEventListener('click', () => {
        showView('menuSelect');
    });

    // Copy links listeners
    document.getElementById('copy-link-btn').addEventListener('click', () => {
        const copyInput = document.getElementById('share-link-input');
        copyInput.select();
        navigator.clipboard.writeText(copyInput.value).then(() => {
            showToast('공유 링크가 클립보드에 복사되었습니다.', 'success');
        });
    });

    document.getElementById('copy-share-url-btn').addEventListener('click', () => {
        const baseUrl = window.location.href.split('#')[0];
        const shareLink = `${baseUrl}#room=${currentRoomId}`;
        navigator.clipboard.writeText(shareLink).then(() => {
            showToast('참가자 링크가 복사되었습니다.', 'success');
        });
    });

    // Back to Menu listener (for participants viewing dashboard)
    document.getElementById('go-back-to-menu-btn').addEventListener('click', () => {
        window.location.hash = `#room=${currentRoomId}`;
    });

    // View Live Dashboard listeners for participants
    document.getElementById('view-live-dashboard-btn').addEventListener('click', () => {
        window.location.hash = `#room=${currentRoomId}&view=dashboard`;
    });

    document.getElementById('view-live-dashboard-success-btn').addEventListener('click', () => {
        window.location.hash = `#room=${currentRoomId}&view=dashboard`;
    });

    // Ladder Game Listeners
    document.getElementById('toggle-ladder-btn').addEventListener('click', toggleLadderGame);
    document.getElementById('draw-ladder-btn').addEventListener('click', drawLadderGame);
    document.getElementById('run-ladder-btn').addEventListener('click', runLadderGame);
}

// Core SPA Hash Router
async function routePage() {
    const hash = window.location.hash;
    
    // Clear subscription if route changes
    if (window.currentSubscription) {
        window.currentSubscription.unsubscribe();
        window.currentSubscription = null;
    }

    if (!supabaseClient) {
        showToast('Supabase 클라이언트가 초기화되지 않았습니다. room.js 상단의 설정을 확인해 주세요.', 'danger');
        return;
    }

    // 1. Root Route -> Create Room View
    if (!hash || hash === '#') {
        showView('create');
        // Pre-fill json from localStorage if available (transferred from OCR page)
        // If we want it to seamlessly receive the json from the OCR app,
        // we can store parsed OCR items in local storage when exporting!
        const ocrJson = localStorage.getItem('last_ocr_menu');
        if (ocrJson) {
            document.getElementById('menu-json').value = ocrJson;
        }
        return;
    }

    // Parse Hash Parameters
    const params = new URLSearchParams(hash.substring(1));
    const roomId = params.get('room');
    const isOwner = params.get('owner') === 'true';
    const view = params.get('view');

    if (roomId) {
        currentRoomId = roomId;
        
        // Check if room exists and fetch status
        const isExist = await checkRoomExists(roomId);
        if (!isExist) {
            showToast('존재하지 않는 주문 방입니다.', 'danger');
            window.location.hash = '';
            return;
        }

        if (isOwner || view === 'dashboard') {
            // 2. Dashboard Route (Owner or Participant view)
            showView('dashboard');
            loadAndRenderDashboard(roomId);
            subscribeToOrders(roomId);
        } else {
            // 3. Participant Route
            const userName = sessionStorage.getItem(`room_${roomId}_user`);
            if (userName) {
                // Already typed in name, proceed to menu selection
                document.getElementById('display-user-name').textContent = userName;
                const success = await loadParticipantMenu(roomId);
                if (success) {
                    showView('menuSelect');
                }
            } else {
                // Must enter name first
                showView('entry');
                // Set room title in entry view
                const { data } = await supabaseClient.from('rooms').select('title').eq('id', roomId).single();
                document.getElementById('entry-room-title').textContent = data ? data.title : '주문방 입장';
            }
        }
    } else {
        // Fallback
        showView('create');
    }
}

// Check room existence in Database
async function checkRoomExists(roomId) {
    try {
        const { data, error } = await supabaseClient
            .from('rooms')
            .select('title, status')
            .eq('id', roomId)
            .single();

        if (error || !data) return false;
        
        isRoomClosed = data.status === 'closed';
        return true;
    } catch (e) {
        return false;
    }
}

// Create Room Action
async function createRoom() {
    const title = document.getElementById('room-title').value.trim();
    const jsonStr = document.getElementById('menu-json').value.trim();

    if (!title) {
        showToast('방 제목을 입력해 주세요.', 'warning');
        return;
    }

    let menuData = [];
    try {
        menuData = JSON.parse(jsonStr);
        if (!Array.isArray(menuData)) {
            throw new Error('JSON은 반드시 배열(Array) 형태여야 합니다.');
        }
        
        // Simple schema validation
        const isValid = menuData.every(item => item.menu_name && typeof item.price !== 'undefined');
        if (!isValid) {
            throw new Error('배열 내 각 오브젝트는 "menu_name"과 "price" 키를 가져야 합니다.');
        }
    } catch (e) {
        showToast('JSON 형식이 올바르지 않습니다: ' + e.message, 'danger');
        return;
    }

    document.getElementById('create-room-btn').disabled = true;
    showToast('주문 방을 생성하고 있습니다...');

    try {
        // 1. Insert Room
        const { data: room, error: roomError } = await supabaseClient
            .from('rooms')
            .insert({ title: title })
            .select()
            .single();

        if (roomError) throw roomError;

        // 2. Insert Menu Items
        const menuToInsert = menuData.map(item => ({
            room_id: room.id,
            name: item.menu_name,
            price: parseInt(item.price, 10) || 0
        }));

        const { error: menuError } = await supabaseClient
            .from('menu_items')
            .insert(menuToInsert);

        if (menuError) throw menuError;

        // 3. Display Share Link (no credentials needed in URL since they are hardcoded)
        const baseUrl = window.location.href.split('#')[0];
        const shareLink = `${baseUrl}#room=${room.id}`;
        document.getElementById('share-link-input').value = shareLink;
        document.getElementById('go-dashboard-btn').href = `${baseUrl}#room=${room.id}&owner=true`;

        showToast('주문 방이 성공적으로 생성되었습니다!', 'success');
        showView('share');
    } catch (e) {
        showToast('생성에 실패했습니다: ' + e.message, 'danger');
        console.error(e);
    } finally {
        document.getElementById('create-room-btn').disabled = false;
    }
}

// Join Room Action (Nickname Submission)
function joinRoom() {
    const name = document.getElementById('user-name-input').value.trim();
    if (!name || name.length < 2) {
        showToast('닉네임을 2글자 이상 입력해 주세요.', 'warning');
        return;
    }

    sessionStorage.setItem(`room_${currentRoomId}_user`, name);
    document.getElementById('display-user-name').textContent = name;
    
    loadParticipantMenu(currentRoomId).then((success) => {
        if (success) {
            showView('menuSelect');
            showToast(`${name}님, 주문방에 오신 것을 환영합니다!`);
        }
    });
}

// Fetch and Render Menu for Participant
async function loadParticipantMenu(roomId) {
    try {
        // Fetch Room Title
        const { data: room } = await supabaseClient.from('rooms').select('title').eq('id', roomId).single();
        document.getElementById('participant-welcome-title').textContent = room.title;
        document.getElementById('participant-room-subtitle').textContent = isRoomClosed ? '이 주문은 마감되었습니다' : '원하는 메뉴 수량을 골라 주문해 주세요.';

        // Disable submission button if closed
        const submitBtn = document.getElementById('submit-order-btn');
        if (isRoomClosed) {
            submitBtn.disabled = true;
            submitBtn.textContent = '주문 마감됨';
            submitBtn.className = 'w-full py-3.5 bg-slate-700 text-slate-400 rounded-xl font-bold cursor-not-allowed';
        } else {
            submitBtn.disabled = false;
            submitBtn.textContent = '내 주문 제출하기';
            submitBtn.className = 'w-full py-3.5 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white rounded-xl font-bold tracking-wider shadow-lg shadow-violet-600/35 transition hover:-translate-y-0.5 active:translate-y-0';
        }

        // Fetch Menu Items
        const { data: menuItems, error } = await supabaseClient
            .from('menu_items')
            .select('*')
            .eq('room_id', roomId)
            .order('id');

        if (error) throw error;
        currentMenu = menuItems;

        // Fetch Existing Orders for this User to prefill quantity selection (edit flow)
        const userName = sessionStorage.getItem(`room_${roomId}_user`);
        const { data: existingOrders } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('room_id', roomId)
            .eq('user_name', userName);

        // Reset selected quantities
        selectedQuantities = {};
        menuItems.forEach(item => {
            selectedQuantities[item.id] = 0;
        });

        if (existingOrders && existingOrders.length > 0) {
            existingOrders.forEach(ord => {
                selectedQuantities[ord.menu_item_id] = ord.quantity;
            });
        }

        renderParticipantMenuGrid();
        return true;
    } catch (e) {
        showToast('메뉴를 로딩하는 중 오류가 발생했습니다: ' + e.message, 'danger');
        return false;
    }
}

// Render Menu Cards
function renderParticipantMenuGrid() {
    const grid = document.getElementById('participant-menu-grid');
    grid.innerHTML = '';

    currentMenu.forEach(item => {
        const qty = selectedQuantities[item.id] || 0;
        const card = document.createElement('div');
        card.className = 'flex justify-between items-center p-3.5 bg-white border border-slate-200 hover:border-violet-500/30 rounded-xl shadow-sm transition';
        card.innerHTML = `
            <div>
                <h5 class="text-sm font-semibold text-slate-800">${escapeHtml(item.name)}</h5>
                <span class="text-xs font-bold text-pink-600">${item.price.toLocaleString()}원</span>
            </div>
            
            <div class="flex items-center gap-3">
                <button onclick="changeQty(${item.id}, -1)" ${isRoomClosed ? 'disabled' : ''} class="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-lg font-bold border border-slate-200 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed">-</button>
                <span id="qty-${item.id}" class="w-6 text-center text-sm font-bold text-slate-800 ${qty > 0 ? 'text-violet-700 font-extrabold' : ''}">${qty}</span>
                <button onclick="changeQty(${item.id}, 1)" ${isRoomClosed ? 'disabled' : ''} class="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-lg font-bold border border-slate-200 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed">+</button>
            </div>
        `;
        grid.appendChild(card);
    });

    updateParticipantPriceSum();
}

// Edit Item Quantity
window.changeQty = function(itemId, amount) {
    if (isRoomClosed) return;
    
    let currentQty = selectedQuantities[itemId] || 0;
    currentQty = Math.max(0, currentQty + amount);
    selectedQuantities[itemId] = currentQty;

    const qtySpan = document.getElementById(`qty-${itemId}`);
    if (qtySpan) {
        qtySpan.textContent = currentQty;
        if (currentQty > 0) {
            qtySpan.className = 'w-6 text-center text-sm font-extrabold text-violet-700';
        } else {
            qtySpan.className = 'w-6 text-center text-sm font-bold text-slate-800';
        }
    }

    updateParticipantPriceSum();
};

// Calculate total cost for current selection
function updateParticipantPriceSum() {
    let total = 0;
    currentMenu.forEach(item => {
        const qty = selectedQuantities[item.id] || 0;
        total += item.price * qty;
    });

    document.getElementById('participant-total-price').textContent = `${total.toLocaleString()}원`;
}

// Submit Orders to Database
async function submitOrder() {
    if (isRoomClosed) {
        showToast('이 방은 주문이 마감되었습니다.', 'warning');
        return;
    }

    const userName = sessionStorage.getItem(`room_${currentRoomId}_user`);
    if (!userName) {
        showToast('닉네임 정보가 없습니다. 다시 입장해 주세요.', 'danger');
        showView('entry');
        return;
    }
    
    // Filter selection
    const itemsToSubmit = [];
    for (const [itemId, qty] of Object.entries(selectedQuantities)) {
        if (qty > 0) {
            itemsToSubmit.push({
                room_id: currentRoomId,
                user_name: userName,
                menu_item_id: parseInt(itemId, 10),
                quantity: qty
            });
        }
    }

    if (itemsToSubmit.length === 0) {
        showToast('최소 한 개 이상의 메뉴를 골라주세요.', 'warning');
        return;
    }

    document.getElementById('submit-order-btn').disabled = true;

    try {
        // 1. Delete previous orders in this room for this user (to update or replace)
        const { error: deleteErr } = await supabaseClient
            .from('orders')
            .delete()
            .eq('room_id', currentRoomId)
            .eq('user_name', userName);

        if (deleteErr) throw deleteErr;

        // 2. Insert new selections
        const { error: insertErr } = await supabaseClient
            .from('orders')
            .insert(itemsToSubmit);

        if (insertErr) throw insertErr;

        showToast('주문이 정상적으로 제출되었습니다.', 'success');
        showView('success');

    } catch (e) {
        showToast('제출 실패: ' + e.message, 'danger');
    } finally {
        document.getElementById('submit-order-btn').disabled = false;
    }
}

// Load Dashboard Data & Calculate Aggregation
async function loadAndRenderDashboard(roomId) {
    try {
        // Parse hash params to detect view mode
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const isOwner = hashParams.get('owner') === 'true';

        // Toggle visibility of Owner vs Participant views
        const closeBtn = document.getElementById('close-room-btn');
        const goBackBtn = document.getElementById('go-back-to-menu-btn');

        if (isOwner) {
            closeBtn.style.display = 'block';
            goBackBtn.style.display = 'none';
        } else {
            closeBtn.style.display = 'none';
            goBackBtn.style.display = 'flex';
        }

        // 1. Load Room Details
        const { data: room } = await supabaseClient.from('rooms').select('title, status').eq('id', roomId).single();
        document.getElementById('dashboard-room-title').textContent = room.title;
        
        isRoomClosed = room.status === 'closed';
        
        if (isRoomClosed) {
            closeBtn.textContent = '주문 방 열기';
            closeBtn.className = 'px-4 py-2.5 bg-emerald-600/15 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white text-emerald-300 text-xs font-bold rounded-xl transition';
        } else {
            closeBtn.textContent = '주문 마감하기';
            closeBtn.className = 'px-4 py-2.5 bg-rose-600/15 border border-rose-500/30 hover:bg-rose-600 hover:text-white text-rose-700 text-xs font-bold rounded-xl transition';
        }

        // Close/Open Room listener
        closeBtn.onclick = () => toggleRoomStatus(roomId, room.status);

        // 2. Load all menu items to reference price/name
        const { data: menuItems, error: menuErr } = await supabaseClient.from('menu_items').select('*').eq('room_id', roomId);
        if (menuErr || !menuItems) throw menuErr || new Error('메뉴 데이터를 불러올 수 없습니다.');
        const menuLookup = {};
        menuItems.forEach(item => {
            menuLookup[item.id] = item;
        });

        // 3. Load all submitted orders
        const { data: orders, error: ordersErr } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('room_id', roomId);

        if (ordersErr) throw ordersErr;

        // Process Aggregation
        let totalItems = 0;
        let totalAmount = 0;
        const usersList = new Set();
        
        const itemSummaries = {}; // { itemId: { name, price, qty, total } }
        const participantBreakdowns = {}; // { userName: [{ name, qty }] }

        menuItems.forEach(item => {
            itemSummaries[item.id] = { name: item.name, price: item.price, qty: 0, total: 0 };
        });

        const safeOrders = orders || [];
        safeOrders.forEach(order => {
            const item = menuLookup[order.menu_item_id];
            if (!item) return; // Menu item mismatch safety
            
            totalItems += order.quantity;
            totalAmount += item.price * order.quantity;
            usersList.add(order.user_name);

            // Item Sum
            itemSummaries[order.menu_item_id].qty += order.quantity;
            itemSummaries[order.menu_item_id].total += item.price * order.quantity;

            // Participant Sum
            if (!participantBreakdowns[order.user_name]) {
                participantBreakdowns[order.user_name] = [];
            }
            participantBreakdowns[order.user_name].push({
                name: item.name,
                qty: order.quantity
            });
        });

        // Update Dashboard Stats cards
        document.getElementById('dashboard-total-qty').textContent = `${totalItems}개`;
        document.getElementById('dashboard-total-amount').textContent = `${totalAmount.toLocaleString()}원`;
        document.getElementById('dashboard-user-count').textContent = `${usersList.size}명`;

        // Keep track of participants globally for the ladder game
        window.currentParticipants = Array.from(usersList);
        
        // Update ladder button status based on participant count
        const toggleLadderBtn = document.getElementById('toggle-ladder-btn');
        if (toggleLadderBtn) {
            if (window.currentParticipants.length < 2) {
                toggleLadderBtn.disabled = true;
                toggleLadderBtn.textContent = '사다리게임 (참가자 대기 중)';
                toggleLadderBtn.className = 'px-4 py-2 bg-slate-200 text-slate-400 text-xs font-bold rounded-xl cursor-not-allowed';
                document.getElementById('ladder-workspace').classList.add('hidden');
            } else {
                toggleLadderBtn.disabled = false;
                const isWorkspaceHidden = document.getElementById('ladder-workspace').classList.contains('hidden');
                toggleLadderBtn.textContent = isWorkspaceHidden ? '사다리게임 시작하기' : '사다리게임 접기';
                toggleLadderBtn.className = 'px-4 py-2 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white text-xs font-bold rounded-xl transition shadow-md shadow-violet-600/20';
            }
        }

        // Render Aggregation Table (Ordered by quantity desc)
        const tableBody = document.getElementById('dashboard-agg-table');
        tableBody.innerHTML = '';
        
        const sortedItems = Object.values(itemSummaries)
            .filter(i => i.qty > 0)
            .sort((a, b) => b.qty - a.qty);

        if (sortedItems.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="3" class="py-10 text-center text-slate-500 text-sm">아직 제출된 주문 정보가 없습니다.</td></tr>`;
        } else {
            sortedItems.forEach(item => {
                const row = document.createElement('tr');
                row.className = 'border-b border-slate-100';
                row.innerHTML = `
                    <td class="py-3 font-semibold text-slate-800">${escapeHtml(item.name)}</td>
                    <td class="py-3 text-center font-extrabold text-violet-700">${item.qty}개</td>
                    <td class="py-3 text-right font-bold text-pink-600">${item.total.toLocaleString()}원</td>
                `;
                tableBody.appendChild(row);
            });
        }

        // Render Participant Breakdown List
        const detailList = document.getElementById('dashboard-detail-list');
        detailList.innerHTML = '';

        const participants = Object.keys(participantBreakdowns);
        if (participants.length === 0) {
            detailList.innerHTML = `<div class="text-center py-10 text-slate-500 text-sm">참가자 주문 현황 대기 중...</div>`;
        } else {
            participants.forEach(user => {
                const selections = participantBreakdowns[user];
                
                // Create a container of badges for a highly readable layout
                const badgesHtml = selections.map(s => `
                    <span class="inline-flex items-center gap-1.5 bg-violet-50/80 text-violet-700 px-2.5 py-1 rounded-lg text-xs font-semibold border border-violet-100/60 shadow-sm">
                        <span class="text-slate-800 font-medium">${escapeHtml(s.name)}</span>
                        <span class="font-extrabold text-violet-800 bg-violet-200/40 px-1.5 py-0.5 rounded text-[10px]">${s.qty}개</span>
                    </span>
                `).join('');
                
                const card = document.createElement('div');
                card.className = 'p-4 bg-white border border-slate-200/80 hover:border-violet-300 rounded-xl flex flex-col sm:flex-row sm:justify-between sm:items-center shadow-sm gap-3 transition-all duration-200';
                card.innerHTML = `
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-sm font-extrabold text-slate-900">${escapeHtml(user)}</span>
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            ${badgesHtml}
                        </div>
                    </div>
                    <div class="flex items-center self-start sm:self-center">
                        <span class="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-lg shadow-sm">완료</span>
                    </div>
                `;
                detailList.appendChild(card);
            });
        }

    } catch (e) {
        showToast('대시보드를 로딩하는 중 오류가 발생했습니다: ' + e.message, 'danger');
    }
}

// Toggle room status between active and closed
async function toggleRoomStatus(roomId, currentStatus) {
    const nextStatus = currentStatus === 'active' ? 'closed' : 'active';
    try {
        const { error } = await supabaseClient
            .from('rooms')
            .update({ status: nextStatus })
            .eq('id', roomId);

        if (error) throw error;
        
        showToast(nextStatus === 'closed' ? '주문을 마감했습니다.' : '주문 접수를 다시 시작합니다.', 'success');
        loadAndRenderDashboard(roomId);
    } catch (e) {
        showToast('상태 변경에 실패했습니다: ' + e.message, 'danger');
    }
}

// Setup Supabase Realtime Subscription
function subscribeToOrders(roomId) {
    if (window.currentSubscription) {
        window.currentSubscription.unsubscribe();
    }

    const sub = supabaseClient
        .channel(`room-orders-realtime-${roomId}`)
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `room_id=eq.${roomId}` },
            (payload) => {
                console.log('Realtime change event received:', payload);
                // Reload dashboard data instantly
                loadAndRenderDashboard(roomId);
                showToast('주문 정보가 업데이트되었습니다.', 'success');
            }
        )
        .subscribe((status) => {
            console.log('Supabase realtime channel status:', status);
        });

    window.currentSubscription = sub;
}

// Display View Panel Helper
function showView(viewKey) {
    // Hide all views
    for (const key in views) {
        if (views[key]) {
            views[key].style.display = 'none';
        }
    }
    // Show selected view
    if (views[viewKey]) {
        views[viewKey].style.display = viewKey === 'dashboard' ? 'grid' : 'block';
    }
}

// Escape HTML safety function
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Toast notification helper
function showToast(message, type = 'primary') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    const msg = document.getElementById('toast-message');

    // Reset styles
    toast.className = "fixed bottom-6 right-6 bg-slate-900/95 border shadow-2xl rounded-xl px-4 py-3 text-sm z-50 flex items-center gap-3 transform translate-y-24 opacity-0 transition duration-300 pointer-events-none";

    let iconHtml = '';
    if (type === 'success') {
        toast.classList.add('border-emerald-500/50', 'text-emerald-200');
        iconHtml = '<polyline points="20 6 9 17 4 12"></polyline>';
    } else if (type === 'warning') {
        toast.classList.add('border-amber-500/50', 'text-amber-200');
        iconHtml = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>';
    } else if (type === 'danger') {
        toast.classList.add('border-rose-500/50', 'text-rose-200');
        iconHtml = '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>';
    } else {
        toast.classList.add('border-violet-500/50', 'text-violet-200');
        iconHtml = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>';
    }

    icon.innerHTML = iconHtml;
    msg.textContent = message;

    // Show toast
    toast.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
    toast.classList.add('translate-y-0', 'opacity-100');

    // Auto close
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    window.toastTimeout = setTimeout(() => {
        toast.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none');
        toast.classList.remove('translate-y-0', 'opacity-100');
    }, 3000);
}

// ==========================================
// 🪜 GHOST LEG / LADDER GAME IMPLEMENTATION
// ==========================================
let ladderPlayers = [];
let ladderRungs = [];
let ladderOutcomes = [];
let ladderPaths = [];
let ladderXCoords = [];
let isLadderAnimating = false;
let ladderAnimFrameId = null;

function toggleLadderGame() {
    const workspace = document.getElementById('ladder-workspace');
    const toggleBtn = document.getElementById('toggle-ladder-btn');
    
    if (workspace.classList.contains('hidden')) {
        // Open
        if (!window.currentParticipants || window.currentParticipants.length < 2) {
            showToast('사다리게임을 하려면 최소 2명 이상의 참가자가 필요합니다.', 'warning');
            return;
        }
        workspace.classList.remove('hidden');
        toggleBtn.textContent = '사다리게임 접기';
        
        // Initialize Players & Outcomes
        ladderPlayers = [...window.currentParticipants];
        const container = document.getElementById('ladder-outcomes-container');
        container.innerHTML = '';
        
        ladderPlayers.forEach((player, idx) => {
            const div = document.createElement('div');
            div.className = 'flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-150 shadow-sm';
            
            // Set first item as "당첨 (전액 결제! 💸)", others as "통과"
            const defaultValue = (idx === 0) ? '전액 결제 💸' : '통과';
            
            div.innerHTML = `
                <span class="text-xs font-bold text-slate-700 w-16 truncate text-right">${escapeHtml(player)}</span>
                <span class="text-slate-300 text-xs">➔</span>
                <input type="text" value="${defaultValue}" id="ladder-outcome-input-${idx}" class="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-xs text-slate-850 focus:outline-none focus:border-violet-500 transition font-semibold">
            `;
            container.appendChild(div);
        });
        
        // Disable Run button until ladder is drawn
        document.getElementById('run-ladder-btn').disabled = true;
        document.getElementById('ladder-result-board').classList.add('hidden');
        
        // Setup initial canvas
        initLadderCanvas();
    } else {
        // Close
        workspace.classList.add('hidden');
        toggleBtn.textContent = '사다리게임 시작하기';
        
        if (isLadderAnimating) {
            cancelAnimationFrame(ladderAnimFrameId);
            isLadderAnimating = false;
        }
    }
}

function initLadderCanvas() {
    const canvas = document.getElementById('ladder-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw initial state message
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('사다리 다시 그리기 버튼을 눌러 라인을 생성해 주세요.', canvas.width / 2, canvas.height / 2);
}

function drawLadderGame() {
    if (isLadderAnimating) return;
    
    // Read outcomes
    ladderOutcomes = [];
    for (let i = 0; i < ladderPlayers.length; i++) {
        const val = document.getElementById(`ladder-outcome-input-${i}`).value.trim() || '통과';
        ladderOutcomes.push(val);
    }
    
    // Generate Random Rungs
    ladderRungs = generateLadderRungs(ladderPlayers.length);
    
    // Precompute Paths
    const computed = computeLadderPaths(ladderPlayers, ladderRungs);
    ladderPaths = computed.paths;
    ladderXCoords = computed.xCoords;
    
    // Draw static ladder
    drawLadderOnCanvas(0.0); // 0.0 progress = start of path
    
    // Enable Run Button
    document.getElementById('run-ladder-btn').disabled = false;
    document.getElementById('ladder-result-board').classList.add('hidden');
    document.getElementById('ladder-status-msg').className = 'p-3 bg-emerald-50 border border-emerald-200/50 rounded-xl text-xs text-emerald-700 leading-normal';
    document.getElementById('ladder-status-msg').textContent = '사다리 준비 완료! [사다리 타기!]를 누르세요.';
}

function generateLadderRungs(numPlayers) {
    const rungs = [];
    const numLevels = 10;
    const Y_START = 60;
    const Y_END = 295;
    const step = (Y_END - Y_START) / numLevels;
    
    for (let l = 0; l < numLevels; l++) {
        const y = Y_START + l * step + (Math.random() * 0.4 + 0.3) * step;
        // Randomly insert rungs
        for (let col = 0; col < numPlayers - 1; col++) {
            if (Math.random() < 0.6) {
                // Ensure no direct conflict at the same height
                const hasConflict = rungs.some(r => Math.abs(r.y - y) < 10 && (r.fromCol === col - 1 || r.fromCol === col + 1 || r.fromCol === col));
                if (!hasConflict) {
                    rungs.push({ y, fromCol: col, toCol: col + 1 });
                }
            }
        }
    }
    rungs.sort((a, b) => a.y - b.y);
    return rungs;
}

function computeLadderPaths(players, rungs) {
    const numPlayers = players.length;
    const Y_START = 50;
    const Y_END = 300;
    const canvasWidth = 600;
    
    const padding = numPlayers > 8 ? 25 : (numPlayers > 5 ? 45 : 75);
    const spacing = (canvasWidth - 2 * padding) / (numPlayers - 1);
    
    const xCoords = [];
    for (let i = 0; i < numPlayers; i++) {
        xCoords.push(padding + i * spacing);
    }
    
    const paths = [];
    for (let startCol = 0; startCol < numPlayers; startCol++) {
        const path = [];
        let currCol = startCol;
        let currY = Y_START;
        path.push({ x: xCoords[currCol], y: currY });
        
        for (let r = 0; r < rungs.length; r++) {
            const rung = rungs[r];
            if (rung.y >= currY && (rung.fromCol === currCol || rung.toCol === currCol)) {
                // Move down to the rung level
                path.push({ x: xCoords[currCol], y: rung.y });
                
                // Cross horizontally
                if (rung.fromCol === currCol) {
                    currCol = rung.toCol;
                } else {
                    currCol = rung.fromCol;
                }
                path.push({ x: xCoords[currCol], y: rung.y });
                currY = rung.y;
            }
        }
        path.push({ x: xCoords[currCol], y: Y_END });
        paths.push({
            name: players[startCol],
            startIndex: startCol,
            endCol: currCol,
            points: path
        });
    }
    
    return { paths, xCoords };
}

function getLadderPathLengths(points) {
    const lengths = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i-1].x;
        const dy = points[i].y - points[i-1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        total += dist;
        lengths.push(total);
    }
    return { lengths, total };
}

function getLadderPointAtProgress(points, lengths, total, progress) {
    const targetLength = progress * total;
    if (targetLength <= 0) return points[0];
    if (targetLength >= total) return points[points.length - 1];
    
    for (let i = 1; i < points.length; i++) {
        if (lengths[i] >= targetLength) {
            const segLength = lengths[i] - lengths[i-1];
            const segProgress = (targetLength - lengths[i-1]) / segLength;
            const p0 = points[i-1];
            const p1 = points[i];
            return {
                x: p0.x + (p1.x - p0.x) * segProgress,
                y: p0.y + (p1.y - p0.y) * segProgress
            };
        }
    }
    return points[points.length - 1];
}

function drawLadderOnCanvas(progress = 0) {
    const canvas = document.getElementById('ladder-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const numPlayers = ladderPlayers.length;
    const Y_START = 50;
    const Y_END = 300;
    
    // Draw static vertical rails and names
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    
    // Draw rungs
    ladderRungs.forEach(rung => {
        ctx.beginPath();
        ctx.moveTo(ladderXCoords[rung.fromCol], rung.y);
        ctx.lineTo(ladderXCoords[rung.toCol], rung.y);
        ctx.stroke();
    });
    
    // Draw vertical rails
    for (let i = 0; i < numPlayers; i++) {
        ctx.beginPath();
        ctx.moveTo(ladderXCoords[i], Y_START);
        ctx.lineTo(ladderXCoords[i], Y_END);
        ctx.stroke();
        
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        
        let displayName = ladderPlayers[i];
        if (displayName.length > 5) displayName = displayName.substring(0, 4) + '..';
        ctx.fillText(displayName, ladderXCoords[i], Y_START - 15);
    }
    
    // Draw outcomes
    for (let i = 0; i < numPlayers; i++) {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        
        let text = '❓';
        if (progress >= 1.0) {
            text = ladderOutcomes[i] || '통과';
            if (text.length > 6) text = text.substring(0, 5) + '..';
        }
        ctx.fillText(text, ladderXCoords[i], Y_END + 20);
    }
    
    // Color Palette
    const colors = ['#7c3aed', '#db2777', '#059669', '#ea580c', '#0284c7', '#d97706', '#2563eb', '#4f46e5', '#db2777', '#0891b2'];
    
    // Draw running trace paths
    ladderPaths.forEach((pathInfo, idx) => {
        const color = colors[idx % colors.length];
        const pathData = getLadderPathLengths(pathInfo.points);
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        
        const currentPoint = getLadderPointAtProgress(pathInfo.points, pathData.lengths, pathData.total, progress);
        
        ctx.moveTo(pathInfo.points[0].x, pathInfo.points[0].y);
        
        let lengthCovered = progress * pathData.total;
        let i = 1;
        while (i < pathInfo.points.length && pathData.lengths[i] <= lengthCovered) {
            ctx.lineTo(pathInfo.points[i].x, pathInfo.points[i].y);
            i++;
        }
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
        
        // Draw avatar dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(currentPoint.x, currentPoint.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });
}

function runLadderGame() {
    if (isLadderAnimating) return;
    
    isLadderAnimating = true;
    document.getElementById('draw-ladder-btn').disabled = true;
    document.getElementById('run-ladder-btn').disabled = true;
    document.getElementById('ladder-result-board').classList.add('hidden');
    document.getElementById('ladder-status-msg').className = 'p-3 bg-violet-50 border border-violet-100 rounded-xl text-xs text-violet-700 leading-normal animate-pulse';
    document.getElementById('ladder-status-msg').textContent = '사다리가 내려가는 중... 잠시만 대기해 주세요!';
    
    const startTime = performance.now();
    const duration = 3500; // 3.5 seconds
    
    function frame(time) {
        const elapsed = time - startTime;
        const progress = Math.min(1.0, elapsed / duration);
        
        drawLadderOnCanvas(progress);
        
        if (progress < 1.0) {
            ladderAnimFrameId = requestAnimationFrame(frame);
        } else {
            isLadderAnimating = false;
            document.getElementById('draw-ladder-btn').disabled = false;
            document.getElementById('run-ladder-btn').disabled = false;
            document.getElementById('ladder-status-msg').className = 'p-3 bg-emerald-50 border border-emerald-200/50 rounded-xl text-xs text-emerald-700 leading-normal';
            document.getElementById('ladder-status-msg').textContent = '내기 완료! 아래에서 각 결과를 확인해 주세요!';
            
            showLadderResults();
        }
    }
    
    ladderAnimFrameId = requestAnimationFrame(frame);
}

function showLadderResults() {
    const grid = document.getElementById('ladder-result-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    ladderPaths.forEach(path => {
        const outcome = ladderOutcomes[path.endCol] || '통과';
        const card = document.createElement('div');
        card.className = 'p-3 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col items-center justify-center text-center';
        
        let styleClass = 'text-slate-500 font-semibold bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-lg';
        if (outcome.includes('당첨') || outcome.includes('결제') || outcome.includes('독박')) {
            styleClass = 'text-pink-700 font-extrabold bg-pink-50 border border-pink-100 px-2 py-0.5 rounded-lg';
        }
        
        card.innerHTML = `
            <span class="text-xs font-bold text-slate-400 mb-1">${escapeHtml(path.name)}</span>
            <span class="text-xs ${styleClass}">${escapeHtml(outcome)}</span>
        `;
        grid.appendChild(card);
    });
    
    document.getElementById('ladder-result-board').classList.remove('hidden');
}
