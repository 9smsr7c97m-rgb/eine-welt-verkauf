(() => {
  'use strict';

  const APP_VERSION = '2.0.0';
  const STORAGE_KEY = 'ewv2_state';
  const MAX_STOCK = 999;
  const PRODUCTS = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
  const INVENTUR = window.INVENTUR || {};
  const CATEGORIES = [...new Set(PRODUCTS.map(product => product.cat))];
  const PAGES = ['scan', 'inventory', 'products', 'orders', 'history'];

  const DEFAULT_STATE = {
    schemaVersion: 2,
    appVersion: APP_VERSION,
    stock: {},
    history: [],
    inventories: [],
    activeInventoryId: null
  };

  let state = structuredCloneSafe(DEFAULT_STATE);
  let currentProduct = null;
  let currentProductSource = 'manual';
  let modalProductId = null;
  let modalSource = 'inventory';
  let activeInventoryCategory = '';
  let activeProductCategory = '';
  let activeInventoryStatus = 'all';
  let toastTimer = null;

  let scanning = false;
  let detectedHandler = null;
  let scanCandidate = { code: '', count: 0, lastAt: 0 };
  let lastAcceptedScanAt = 0;

  const byId = new Map(PRODUCTS.map(product => [product.id, product]));
  const byBarcode = new Map(PRODUCTS.filter(product => product.barcode).map(product => [product.barcode, product]));

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function createId(prefix = 'id') {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state = {
        ...structuredCloneSafe(DEFAULT_STATE),
        ...parsed,
        stock: parsed.stock && typeof parsed.stock === 'object' ? parsed.stock : {},
        history: Array.isArray(parsed.history) ? parsed.history : [],
        inventories: Array.isArray(parsed.inventories) ? parsed.inventories : []
      };
      state.schemaVersion = 2;
      state.appVersion = APP_VERSION;
      if (state.activeInventoryId && !state.inventories.some(item => item.id === state.activeInventoryId && item.status === 'active')) {
        state.activeInventoryId = null;
      }
      saveState();
    } catch (error) {
      console.error('Gespeicherter Zustand konnte nicht geladen werden:', error);
      state = structuredCloneSafe(DEFAULT_STATE);
    }
  }

  function saveState() {
    state.schemaVersion = 2;
    state.appVersion = APP_VERSION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Zustand konnte nicht gespeichert werden:', error);
      showToast('Speichern im Browser nicht möglich.');
    }
  }

  function initializeStockIfNeeded() {
    if (Object.keys(state.stock).length > 0) return;
    const now = new Date().toISOString();
    state.stock = { ...INVENTUR };
    state.inventories.push({
      id: createId('inventory-import'),
      name: 'Startinventur',
      startedAt: now,
      completedAt: now,
      status: 'completed',
      entries: Object.fromEntries(
        Object.entries(INVENTUR).map(([id, qty]) => [id, {
          id, old: 0, qty, source: 'import', ts: now
        }])
      )
    });
    saveState();
  }

  function getStock(id) {
    const value = Number(state.stock[id]);
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  function getActiveInventory() {
    if (!state.activeInventoryId) return null;
    return state.inventories.find(item => item.id === state.activeInventoryId && item.status === 'active') || null;
  }

  function startInventory({ silent = false } = {}) {
    const existing = getActiveInventory();
    if (existing) return existing;

    const now = new Date();
    const inventory = {
      id: createId('inventory'),
      name: `Inventur ${now.toLocaleDateString('de-DE')}`,
      startedAt: now.toISOString(),
      completedAt: null,
      status: 'active',
      entries: {}
    };
    state.inventories.unshift(inventory);
    state.activeInventoryId = inventory.id;
    saveState();
    renderAllInventoryState();
    if (!silent) showToast('Neue Inventur gestartet.');
    return inventory;
  }

  function completeInventory() {
    const inventory = getActiveInventory();
    if (!inventory) {
      showToast('Keine aktive Inventur.');
      return;
    }

    const counted = Object.keys(inventory.entries || {}).length;
    const open = Math.max(0, PRODUCTS.length - counted);
    const message = open > 0
      ? `Es sind noch ${open} von ${PRODUCTS.length} Produkten nicht gezählt. Inventur trotzdem abschließen?`
      : 'Inventur abschließen?';
    if (!window.confirm(message)) return;

    inventory.status = 'completed';
    activeInventoryStatus = 'all';
    inventory.completedAt = new Date().toISOString();
    state.activeInventoryId = null;
    saveState();
    renderAllInventoryState();
    showToast('Inventur abgeschlossen.');
  }

  function isCounted(id) {
    const inventory = getActiveInventory();
    return Boolean(inventory?.entries?.[id]);
  }

  function validateQuantity(rawValue) {
    const text = String(rawValue ?? '').trim();
    if (text === '') return { ok: false, message: 'Bitte einen Bestand eingeben.' };
    const number = Number(text);
    if (!Number.isInteger(number)) return { ok: false, message: 'Der Bestand muss eine ganze Zahl sein.' };
    if (number < 0) return { ok: false, message: 'Der Bestand darf nicht negativ sein.' };
    if (number > MAX_STOCK) return { ok: false, message: `Der Bestand darf höchstens ${MAX_STOCK} betragen.` };
    return { ok: true, value: number };
  }

  function recordStock(id, quantity, source) {
    const product = byId.get(id);
    if (!product) throw new Error('Unbekanntes Produkt');

    const inventory = startInventory({ silent: true });
    const current = getStock(id);
    const previousEntry = inventory.entries?.[id];
    const original = previousEntry ? previousEntry.old : current;
    const now = new Date().toISOString();

    state.stock[id] = quantity;
    inventory.entries[id] = {
      id,
      old: original,
      qty: quantity,
      source,
      ts: now
    };

    if (current !== quantity) {
      state.history.unshift({
        id,
        name: product.name,
        old: current,
        qty: quantity,
        ts: now,
        source,
        inventoryId: inventory.id
      });
      if (state.history.length > 500) state.history = state.history.slice(0, 500);
    }

    saveState();
    return { old: current, qty: quantity, changed: current !== quantity };
  }

  function showPage(name) {
    if (!PAGES.includes(name)) return;
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    $(`page-${name}`).classList.add('active');
    document.querySelectorAll('nav button[data-page]').forEach(button => {
      button.classList.toggle('active', button.dataset.page === name);
    });
    if (name === 'inventory') renderInventory();
    if (name === 'products') renderProducts();
    if (name === 'orders') renderOrders();
    if (name === 'history') renderHistory();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderSessionCard(containerId) {
    const container = $(containerId);
    const inventory = getActiveInventory();
    if (!inventory) {
      container.innerHTML = `
        <div class="inventory-session inactive">
          <div class="session-top">
            <div class="session-copy">
              <div class="session-title">Keine aktive Inventur</div>
              <div class="session-meta">Starte für den monatlichen Verkauf eine neue Inventur. Beim ersten gespeicherten Produkt wird sie andernfalls automatisch gestartet.</div>
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-primary" type="button" data-action="start-inventory">Neue Inventur starten</button>
          </div>
        </div>`;
      return;
    }

    const counted = Object.keys(inventory.entries || {}).length;
    const open = Math.max(0, PRODUCTS.length - counted);
    const percent = PRODUCTS.length ? Math.round((counted / PRODUCTS.length) * 100) : 0;
    container.innerHTML = `
      <div class="inventory-session">
        <div class="session-top">
          <div class="session-copy">
            <div class="session-title">${escapeHTML(inventory.name)}</div>
            <div class="session-meta">Gestartet: ${escapeHTML(formatDateTime(inventory.startedAt))}</div>
          </div>
          <span class="count-marker counted">aktiv</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="progress-label"><span>${counted} von ${PRODUCTS.length} gezählt</span><span>${open} offen</span></div>
        <div class="session-actions">
          <button class="btn btn-ghost" type="button" data-action="show-open-products">Offene Produkte</button>
          <button class="btn btn-primary" type="button" data-action="complete-inventory">Inventur abschließen</button>
        </div>
      </div>`;
  }

  function renderAllInventoryState() {
    renderSessionCard('scan-session-card');
    renderSessionCard('inventory-session-card');
    renderInventory();
    updateFoundProductCountStatus();
  }

  function handleSessionAction(action) {
    if (action === 'start-inventory') startInventory();
    if (action === 'complete-inventory') completeInventory();
    if (action === 'show-open-products') {
      activeInventoryStatus = 'open';
      showPage('inventory');
      renderInventoryStatusFilter();
      renderInventory();
    }
  }

  function lookupBarcode() {
    const value = $('barcode-field').value.trim();
    if (!value) {
      showNotFound('Bitte zuerst einen Barcode oder eine Artikelnummer eingeben.');
      return;
    }
    const product = byBarcode.get(value) || byId.get(value) || PRODUCTS.find(item => item.id.toLowerCase() === value.toLowerCase());
    if (!product) {
      showNotFound(`Kein hinterlegtes Produkt für „${value}“ gefunden.`);
      return;
    }
    openScanStockEditor(product, 'manual-code');
  }

  function showNotFound(message) {
    $('not-found-text').textContent = `⚠️ ${message}`;
    $('not-found').style.display = 'block';
    $('found-product').style.display = 'none';
  }

  function openScanStockEditor(product, source) {
    currentProduct = product;
    currentProductSource = source;
    $('not-found').style.display = 'none';
    $('fp-name').textContent = product.name;
    $('fp-meta').textContent = `${product.cat} · ${product.unit} · EK brutto: ${formatMoney(product.buyGross)} € · VK: ${formatMoney(product.sell)} €`;
    $('fp-stock').textContent = getStock(product.id);
    $('new-qty').value = getStock(product.id);
    $('found-product').style.display = 'block';
    hideValidation('scan-validation');
    updateQuantityDifference('new-qty', 'scan-stock-difference', product.id);
    updateFoundProductCountStatus();
    $('found-product').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateFoundProductCountStatus() {
    if (!currentProduct || $('found-product').style.display === 'none') return;
    const countedText = isCounted(currentProduct.id) ? ' · in dieser Inventur bereits gezählt' : ' · in dieser Inventur noch offen';
    const base = `${currentProduct.cat} · ${currentProduct.unit} · EK brutto: ${formatMoney(currentProduct.buyGross)} € · VK: ${formatMoney(currentProduct.sell)} €`;
    $('fp-meta').textContent = base + countedText;
  }

  function clearScan() {
    currentProduct = null;
    currentProductSource = 'manual';
    $('barcode-field').value = '';
    $('found-product').style.display = 'none';
    $('not-found').style.display = 'none';
    hideValidation('scan-validation');
  }

  function changeQuantity(inputId, delta) {
    const input = $(inputId);
    const parsed = validateQuantity(input.value);
    const current = parsed.ok ? parsed.value : 0;
    input.value = Math.max(0, Math.min(MAX_STOCK, current + delta));
    if (inputId === 'new-qty' && currentProduct) updateQuantityDifference(inputId, 'scan-stock-difference', currentProduct.id);
    if (inputId === 'modal-qty' && modalProductId) updateQuantityDifference(inputId, 'modal-stock-difference', modalProductId);
  }

  function updateQuantityDifference(inputId, outputId, productId) {
    const result = validateQuantity($(inputId).value);
    const output = $(outputId);
    if (!result.ok) {
      output.textContent = '';
      return;
    }
    const old = getStock(productId);
    const difference = result.value - old;
    if (difference === 0) {
      output.innerHTML = 'Keine Bestandsänderung – das Produkt wird trotzdem als gezählt markiert.';
      return;
    }
    const className = difference < 0 ? 'negative' : 'positive';
    const sign = difference > 0 ? '+' : '';
    output.innerHTML = `Änderung gegenüber bisher: <strong class="${className}">${sign}${difference}</strong>`;
  }

  function showValidation(id, message) {
    const element = $(id);
    element.textContent = message;
    element.classList.add('show');
  }

  function hideValidation(id) {
    const element = $(id);
    element.textContent = '';
    element.classList.remove('show');
  }

  function saveScanStock() {
    if (!currentProduct) return;
    const validation = validateQuantity($('new-qty').value);
    if (!validation.ok) {
      showValidation('scan-validation', validation.message);
      return;
    }
    hideValidation('scan-validation');
    const result = recordStock(currentProduct.id, validation.value, currentProductSource);
    const suffix = result.changed ? `${result.old} → ${result.qty}` : `${result.qty}, unverändert`;
    showToast(`✓ ${currentProduct.name}: ${suffix}`);
    clearScan();
    renderAllInventoryState();
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('de-DE');
  }

  function searchProducts(value) {
    const query = normalizeSearch(value);
    if (!query) return [];
    return PRODUCTS.filter(product => {
      const haystack = [product.name, product.id, product.barcode, product.cat, product.unit]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('de-DE');
      return haystack.includes(query);
    }).slice(0, 10);
  }

  function renderScanSearchResults() {
    const query = $('scan-product-search').value;
    const container = $('scan-search-results');
    if (!query.trim()) {
      container.classList.remove('show');
      container.innerHTML = '';
      return;
    }
    const results = searchProducts(query);
    container.classList.add('show');
    if (!results.length) {
      container.innerHTML = '<div class="search-no-result">Kein Produkt gefunden.</div>';
      return;
    }
    container.innerHTML = results.map(product => `
      <button class="search-result" type="button" data-product-id="${escapeHTML(product.id)}">
        <span class="cat-dot cat-${escapeHTML(product.cat)}"></span>
        <span class="sr-main">
          <span class="sr-name">${escapeHTML(product.name)}</span>
          <span class="sr-meta">${escapeHTML(product.id)} · ${escapeHTML(product.unit)}${product.barcode ? ` · ${escapeHTML(product.barcode)}` : ' · kein Barcode hinterlegt'}</span>
        </span>
        <span class="sr-stock">${getStock(product.id)}</span>
      </button>`).join('');
  }

  function resetScanConsensus() {
    scanCandidate = { code: '', count: 0, lastAt: 0 };
    lastAcceptedScanAt = 0;
  }

  function startScan() {
    if (scanning) return;
    $('scanner-overlay').classList.add('open');
    setScanStatus('Kamera wird gestartet …');
    resetScanConsensus();

    if (!window.Quagga) {
      setScanStatus('Scannerbibliothek konnte nicht geladen werden. Prüfe die Internetverbindung und lade die Seite neu.', 'error');
      return;
    }

    scanning = true;
    const viewport = $('scanner-viewport');
    viewport.querySelectorAll('video, canvas').forEach(element => element.remove());

    detectedHandler = result => {
      if (!scanning) return;
      const code = String(result?.codeResult?.code || '').trim();
      if (!code || code.length < 8) return;

      const now = Date.now();
      const product = byBarcode.get(code);
      if (!product) {
        scanCandidate = { code: '', count: 0, lastAt: now };
        setScanStatus(`Barcode ${code} ist nicht hinterlegt. Die Kamera scannt weiter.`, 'error');
        return;
      }

      if (scanCandidate.code === code && now - scanCandidate.lastAt < 1800) {
        scanCandidate.count += 1;
      } else {
        scanCandidate = { code, count: 1, lastAt: now };
      }
      scanCandidate.lastAt = now;

      setScanStatus(`${product.name} erkannt (${scanCandidate.count}/3) …`, 'success');
      if (scanCandidate.count < 3 || now - lastAcceptedScanAt < 1500) return;
      lastAcceptedScanAt = now;
      stopScan();
      $('barcode-field').value = code;
      openScanStockEditor(product, 'scan');
    };

    const config = {
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: viewport,
        constraints: {
          facingMode: { ideal: 'environment' },
          width: { min: 640, ideal: 1280 },
          height: { min: 480, ideal: 720 },
          aspectRatio: { min: 1, max: 2 }
        },
        area: { top: '25%', right: '5%', left: '5%', bottom: '25%' }
      },
      locator: { patchSize: 'medium', halfSample: true },
      numOfWorkers: 0,
      frequency: 10,
      decoder: { readers: ['ean_reader'], multiple: false },
      locate: true
    };

    window.Quagga.init(config, error => {
      if (error) {
        console.error('Scanner konnte nicht gestartet werden:', error);
        scanning = false;
        setScanStatus(cameraErrorMessage(error), 'error');
        return;
      }
      if (!scanning) return;
      window.Quagga.onDetected(detectedHandler);
      window.Quagga.start();
      setScanStatus('Kamera bereit. Barcode ruhig in den Rahmen halten.');
    });
  }

  function cameraErrorMessage(error) {
    const text = String(error?.name || error?.message || error || '');
    if (/NotAllowed|Permission|denied/i.test(text)) return 'Kamerazugriff wurde nicht erlaubt. Erlaube Safari den Kamerazugriff oder nutze die manuelle Suche.';
    if (/NotFound|DevicesNotFound/i.test(text)) return 'Auf diesem Gerät wurde keine geeignete Kamera gefunden.';
    if (/NotReadable|TrackStart/i.test(text)) return 'Die Kamera wird möglicherweise bereits von einer anderen App verwendet.';
    return 'Kamera konnte nicht gestartet werden. Bitte Seite neu laden oder das Produkt manuell suchen.';
  }

  function setScanStatus(message, type = '') {
    const element = $('scan-status');
    element.textContent = message;
    element.classList.remove('error', 'success');
    if (type) element.classList.add(type);
  }

  function stopScan() {
    scanning = false;
    if (window.Quagga && detectedHandler) {
      try { window.Quagga.offDetected(detectedHandler); } catch (error) { console.debug(error); }
    }
    detectedHandler = null;
    if (window.Quagga) {
      try { window.Quagga.stop(); } catch (error) { console.debug(error); }
      try { window.Quagga.CameraAccess?.release?.(); } catch (error) { console.debug(error); }
    }
    $('scanner-viewport').querySelectorAll('video, canvas').forEach(element => element.remove());
    $('scanner-overlay').classList.remove('open');
    resetScanConsensus();
  }

  function buildCategoryFilter(containerId, selected, onChange) {
    const container = $(containerId);
    container.innerHTML = '';
    const options = ['', ...CATEGORIES];
    options.forEach(category => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-pill';
      button.textContent = category || 'Alle';
      button.classList.toggle('active', category === selected);
      button.addEventListener('click', () => onChange(category));
      container.appendChild(button);
    });
  }

  function renderInventoryStatusFilter() {
    const container = $('status-filter-inv');
    const options = [
      ['all', 'Alle Status'],
      ['open', 'Noch offen'],
      ['counted', 'Gezählt']
    ];
    container.innerHTML = '';
    options.forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-pill';
      button.textContent = label;
      button.classList.toggle('active', activeInventoryStatus === value);
      button.addEventListener('click', () => {
        activeInventoryStatus = value;
        renderInventoryStatusFilter();
        renderInventory();
      });
      container.appendChild(button);
    });
  }

  function renderInventory() {
    if (!$('inventory-list')) return;
    const search = normalizeSearch($('inv-search')?.value);
    const inventory = getActiveInventory();
    const products = PRODUCTS.filter(product => {
      if (activeInventoryCategory && product.cat !== activeInventoryCategory) return false;
      if (search) {
        const haystack = [product.name, product.id, product.barcode, product.cat].filter(Boolean).join(' ').toLocaleLowerCase('de-DE');
        if (!haystack.includes(search)) return false;
      }
      if (inventory && activeInventoryStatus === 'open' && isCounted(product.id)) return false;
      if (inventory && activeInventoryStatus === 'counted' && !isCounted(product.id)) return false;
      return true;
    });

    const list = $('inventory-list');
    if (!products.length) {
      list.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Keine passenden Produkte.</p></div>';
    } else {
      list.innerHTML = products.map(product => {
        const stock = getStock(product.id);
        const stockClass = stock === 0 ? 'stock-empty' : stock < product.min ? 'stock-low' : 'stock-ok';
        const marker = inventory
          ? `<span class="count-marker ${isCounted(product.id) ? 'counted' : 'uncounted'}">${isCounted(product.id) ? 'gezählt' : 'offen'}</span>`
          : '';
        return `<div class="product-row" data-product-id="${escapeHTML(product.id)}">
          <span class="cat-dot cat-${escapeHTML(product.cat)}"></span>
          <div class="name">${escapeHTML(product.name)}<br><span class="unit">${escapeHTML(product.unit)}</span></div>
          ${marker}
          <span class="stock-badge ${stockClass}">${stock}</span>
        </div>`;
      }).join('');
    }

    const profit = PRODUCTS.reduce((sum, product) => sum + getStock(product.id) * (product.sell - product.buyGross), 0);
    $('profit-amount').textContent = `€${formatMoney(profit)}`;
  }

  function openModal(id, source = 'inventory') {
    const product = byId.get(id);
    if (!product) return;
    modalProductId = id;
    modalSource = source;
    const stock = getStock(id);
    $('modal-name').textContent = product.name;
    $('modal-meta').textContent = `${product.cat} · ${product.unit} · VK: ${formatMoney(product.sell)} € · Mindestbestand: ${product.min}${isCounted(id) ? ' · bereits gezählt' : ''}`;
    $('modal-stock').textContent = stock;
    $('modal-qty').value = stock;
    hideValidation('modal-validation');
    updateQuantityDifference('modal-qty', 'modal-stock-difference', id);
    $('modal-overlay').classList.add('open');
  }

  function closeModal() {
    $('modal-overlay').classList.remove('open');
    modalProductId = null;
  }

  function saveModalStock() {
    if (!modalProductId) return;
    const validation = validateQuantity($('modal-qty').value);
    if (!validation.ok) {
      showValidation('modal-validation', validation.message);
      return;
    }
    const product = byId.get(modalProductId);
    const result = recordStock(modalProductId, validation.value, modalSource);
    closeModal();
    showToast(result.changed ? `✓ ${product.name}: ${result.old} → ${result.qty}` : `✓ ${product.name} als gezählt markiert`);
    renderAllInventoryState();
  }

  function renderProducts() {
    const search = normalizeSearch($('prod-search')?.value);
    const grouped = {};
    PRODUCTS.forEach(product => {
      if (activeProductCategory && product.cat !== activeProductCategory) return;
      if (search) {
        const haystack = [product.name, product.id, product.barcode, product.cat].filter(Boolean).join(' ').toLocaleLowerCase('de-DE');
        if (!haystack.includes(search)) return;
      }
      grouped[product.cat] ||= [];
      grouped[product.cat].push(product);
    });

    const categories = Object.keys(grouped);
    if (!categories.length) {
      $('products-list').innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Keine Produkte gefunden.</p></div>';
      return;
    }

    $('products-list').innerHTML = categories.map(category => `
      <div class="card" style="overflow:hidden; margin-bottom:10px;">
        <div class="cat-header">
          <span class="cat-dot cat-${escapeHTML(category)}"></span>
          ${escapeHTML(category)} <span class="count">${grouped[category].length}</span>
        </div>
        ${grouped[category].map(product => `
          <div class="product-detail-row" data-product-id="${escapeHTML(product.id)}">
            <div style="flex:1; min-width:0;">
              <div class="pname">${escapeHTML(product.name)}</div>
              <div class="pid">${escapeHTML(product.id)}${product.barcode ? ` · ${escapeHTML(product.barcode)}` : ' · kein Barcode'}</div>
            </div>
            <div class="price-tag">
              <div class="sell">${formatMoney(product.sell)} €</div>
              <div class="buy">EK ${formatMoney(product.buyGross)} €</div>
            </div>
          </div>`).join('')}
      </div>`).join('');
  }

  function openDetail(id) {
    const product = byId.get(id);
    if (!product) return;
    const margin = product.sell - product.buyGross;
    const marginPercent = product.buyGross ? (margin / product.buyGross) * 100 : 0;
    $('dp-name').textContent = product.name;
    $('dp-body').innerHTML = `
      <div class="profit-margin">
        <div class="pm-label">Gewinn pro Stück</div>
        <div class="pm-value">+${formatMoney(margin)} € <span style="font-size:13px; font-weight:600">(${marginPercent.toFixed(0)}%)</span></div>
      </div>
      ${product.barcode ? `<div class="barcode-display"><div class="bc-num">${escapeHTML(product.barcode)}</div><div class="bc-label">EAN-13-Barcode</div></div>` : '<div class="barcode-display"><div class="bc-label">Kein Barcode hinterlegt – manuelle Suche verwenden</div></div>'}
      <div class="card card-pad" style="margin-top:0;">
        <div class="detail-row"><span class="dlabel">Produktname</span><span class="dvalue">${escapeHTML(product.name)}</span></div>
        <div class="detail-row"><span class="dlabel">Artikelnummer</span><span class="dvalue">${escapeHTML(product.id)}</span></div>
        <div class="detail-row"><span class="dlabel">Kategorie</span><span class="dvalue">${escapeHTML(product.cat)}</span></div>
        <div class="detail-row"><span class="dlabel">Inhalt / Einheit</span><span class="dvalue">${escapeHTML(product.unit)}</span></div>
        <div class="detail-row"><span class="dlabel">Einkaufspreis netto</span><span class="dvalue">${formatMoney(product.buyNet)} €</span></div>
        <div class="detail-row"><span class="dlabel">MwSt.-Satz</span><span class="dvalue">${product.vat} %</span></div>
        <div class="detail-row"><span class="dlabel">Einkaufspreis brutto</span><span class="dvalue">${formatMoney(product.buyGross)} €</span></div>
        <div class="detail-row"><span class="dlabel">Verkaufspreis</span><span class="dvalue highlight">${formatMoney(product.sell)} €</span></div>
        <div class="detail-row"><span class="dlabel">Mindestbestand</span><span class="dvalue">${product.min}</span></div>
        <div class="detail-row"><span class="dlabel">Standard-Bestellmenge</span><span class="dvalue">${product.order}</span></div>
        <div class="detail-row"><span class="dlabel">Aktueller Bestand</span><span class="dvalue ${getStock(product.id) < product.min ? 'red' : ''}">${getStock(product.id)} Stück</span></div>
        <div class="detail-row"><span class="dlabel">Aktuelle Inventur</span><span class="dvalue">${getActiveInventory() ? (isCounted(product.id) ? 'gezählt' : 'noch offen') : 'keine aktiv'}</span></div>
      </div>
      <button class="btn btn-primary btn-full" type="button" data-action="edit-detail-stock" data-product-id="${escapeHTML(product.id)}">✏️ Bestand erfassen</button>`;
    $('detail-panel').classList.add('open');
  }

  function closeDetail() {
    $('detail-panel').classList.remove('open');
  }

  function renderOrders() {
    const items = PRODUCTS.filter(product => getStock(product.id) < product.min);
    if (!items.length) {
      $('order-list').innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>Alles ausreichend auf Lager.</p></div>';
      return;
    }
    $('order-list').innerHTML = items.map(product => `
      <div class="order-item">
        <div style="flex:1;">
          <div class="name">${escapeHTML(product.name)}</div>
          <div class="sub">${escapeHTML(product.unit)} · Bestand: ${getStock(product.id)} / Mindestbestand: ${product.min}</div>
        </div>
        <span class="order-qty">${product.order}×</span>
      </div>`).join('');
  }

  async function copyOrderList() {
    const items = PRODUCTS.filter(product => getStock(product.id) < product.min);
    if (!items.length) {
      showToast('Nichts zu bestellen.');
      return;
    }
    const text = `🌍 Eine Welt Verkauf – Bestellliste\n${new Date().toLocaleDateString('de-DE')}\n\n` +
      items.map(product => `• ${product.name} (${product.unit}) – ${product.order}× [Bestand: ${getStock(product.id)}]`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 Bestellliste kopiert.');
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast('📋 Bestellliste kopiert.');
    }
  }

  function sourceLabel(source) {
    const labels = {
      scan: 'Scan',
      'manual-code': 'Code',
      search: 'Suche',
      inventory: 'Bestand',
      product: 'Produkt',
      import: 'Import'
    };
    return labels[source] || 'Manuell';
  }

  function renderHistory() {
    if (!state.history.length) {
      $('history-list').innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Noch keine Bestandsänderungen.</p></div>';
      return;
    }
    $('history-list').innerHTML = state.history.map(entry => {
      const difference = Number(entry.qty) - Number(entry.old);
      const sign = difference > 0 ? '+' : '';
      const changeClass = difference < 0 ? 'change-neg' : 'change-set';
      const icon = difference < 0 ? '📉' : '📈';
      return `<div class="history-entry">
        <span class="history-icon">${icon}</span>
        <div style="min-width:0;">
          <div class="hname">${escapeHTML(entry.name || byId.get(entry.id)?.name || entry.id)} <span class="history-source">${escapeHTML(sourceLabel(entry.source))}</span></div>
          <div class="hwhen">${escapeHTML(formatDateTime(entry.ts))} · vorher: ${entry.old}</div>
        </div>
        <span class="change ${changeClass}">${sign}${difference} → ${entry.qty}</span>
      </div>`;
    }).join('');
  }

  function clearHistory() {
    if (!window.confirm('Bestandsverlauf wirklich löschen? Die aktuellen Bestände bleiben erhalten.')) return;
    state.history = [];
    saveState();
    renderHistory();
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isInStandaloneMode() {
    return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  }

  function setupInstallBanner() {
    if (isIOS() && !isInStandaloneMode()) $('install-banner').classList.add('show');
  }

  function bindEvents() {
    document.querySelectorAll('nav button[data-page]').forEach(button => {
      button.addEventListener('click', () => showPage(button.dataset.page));
    });

    $('install-banner-close').addEventListener('click', () => $('install-banner').classList.remove('show'));
    $('barcode-lookup-btn').addEventListener('click', lookupBarcode);
    $('barcode-field').addEventListener('keydown', event => {
      if (event.key === 'Enter') lookupBarcode();
    });
    $('camera-start-btn').addEventListener('click', startScan);
    $('scanner-close-btn').addEventListener('click', stopScan);
    $('scan-qty-minus').addEventListener('click', () => changeQuantity('new-qty', -1));
    $('scan-qty-plus').addEventListener('click', () => changeQuantity('new-qty', 1));
    $('new-qty').addEventListener('input', () => currentProduct && updateQuantityDifference('new-qty', 'scan-stock-difference', currentProduct.id));
    $('scan-save-btn').addEventListener('click', saveScanStock);
    $('scan-cancel-btn').addEventListener('click', clearScan);
    $('scan-product-search').addEventListener('input', renderScanSearchResults);
    $('scan-search-results').addEventListener('click', event => {
      const button = event.target.closest('[data-product-id]');
      if (!button) return;
      const product = byId.get(button.dataset.productId);
      if (!product) return;
      $('scan-product-search').value = '';
      renderScanSearchResults();
      openScanStockEditor(product, 'search');
    });

    ['scan-session-card', 'inventory-session-card'].forEach(id => {
      $(id).addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button) handleSessionAction(button.dataset.action);
      });
    });

    $('inv-search').addEventListener('input', renderInventory);
    $('inventory-list').addEventListener('click', event => {
      const row = event.target.closest('[data-product-id]');
      if (row) openModal(row.dataset.productId, 'inventory');
    });

    $('prod-search').addEventListener('input', renderProducts);
    $('products-list').addEventListener('click', event => {
      const row = event.target.closest('[data-product-id]');
      if (row) openDetail(row.dataset.productId);
    });

    $('modal-overlay').addEventListener('click', event => {
      if (event.target === $('modal-overlay')) closeModal();
    });
    $('modal-qty-minus').addEventListener('click', () => changeQuantity('modal-qty', -1));
    $('modal-qty-plus').addEventListener('click', () => changeQuantity('modal-qty', 1));
    $('modal-qty').addEventListener('input', () => modalProductId && updateQuantityDifference('modal-qty', 'modal-stock-difference', modalProductId));
    $('modal-save-btn').addEventListener('click', saveModalStock);
    $('modal-cancel-btn').addEventListener('click', closeModal);

    $('detail-close-btn').addEventListener('click', closeDetail);
    $('dp-body').addEventListener('click', event => {
      const button = event.target.closest('[data-action="edit-detail-stock"]');
      if (!button) return;
      const id = button.dataset.productId;
      closeDetail();
      window.setTimeout(() => openModal(id, 'product'), 260);
    });

    $('copy-order-btn').addEventListener('click', copyOrderList);
    $('clear-history-btn').addEventListener('click', clearHistory);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && scanning) stopScan();
    });
    window.addEventListener('pagehide', () => {
      if (scanning) stopScan();
    });
  }

  function initializeFilters() {
    buildCategoryFilter('cat-filter-inv', activeInventoryCategory, category => {
      activeInventoryCategory = category;
      initializeFilters();
      renderInventory();
    });
    buildCategoryFilter('cat-filter-prod', activeProductCategory, category => {
      activeProductCategory = category;
      initializeFilters();
      renderProducts();
    });
    renderInventoryStatusFilter();
  }

  function init() {
    if (!PRODUCTS.length) {
      document.body.innerHTML = '<p style="padding:20px">Produktdaten konnten nicht geladen werden.</p>';
      return;
    }
    loadState();
    initializeStockIfNeeded();
    bindEvents();
    initializeFilters();
    setupInstallBanner();
    renderSessionCard('scan-session-card');
    renderSessionCard('inventory-session-card');
    renderInventory();
    renderProducts();
    renderOrders();
    renderHistory();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
