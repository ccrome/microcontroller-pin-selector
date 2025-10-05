(function() {
  'use strict';

  /**
   * State
   */
  let pinsData = null; // { [instance]: { [port]: [ [pad, alt], ... ] } }
  let activeInstance = null;
  const selectionByInstance = new Map(); // instance -> { [port]: { pad, alt } }
  let teensyPadsSet = null; // Set of pads available on Teensy 4.1
  let padToPinsMap = null;  // Map pad -> [boardPinNumbers]
  const STORAGE_KEY = 'pinSelectorState.v1';

  function saveState() {
    try {
      const selectionsObj = {};
      selectionByInstance.forEach(function(portMap, inst){ selectionsObj[inst] = portMap; });
      const state = {
        boardId: (document.getElementById('boardSelect') || {}).value || '',
        cpuId: (document.getElementById('cpuSelect') || {}).value || '',
        activeInstance: activeInstance || '',
        selections: selectionsObj
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  /**
   * DOM
   */
  const btnAutoLoad = document.getElementById('btnAutoLoad');
  const fileInput = document.getElementById('fileInput');
  const loadMsg = document.getElementById('loadMsg') || { textContent:'', className:'' };
  const instanceSelect = document.getElementById('instanceSelect');
  const portsContainer = document.getElementById('portsContainer');
  const summaryTable = document.getElementById('summaryTable');
  const summaryTbody = document.getElementById('summaryTbody');
  const usedPinsTable = document.getElementById('usedPinsTable');
  const usedPinsTbody = document.getElementById('usedPinsTbody');
  const btnCopy = document.getElementById('btnCopy');
  const btnDownload = document.getElementById('btnDownload');
  const filterMsg = document.getElementById('filterMsg') || { textContent:'', className:'' };
  const btnDownloadCsv = document.getElementById('btnDownloadCsv');
  const csvUpload = document.getElementById('csvUpload');
  const csvMsg = document.getElementById('csvMsg');
  const boardSelect = document.getElementById('boardSelect');
  const cpuSelect = document.getElementById('cpuSelect');
  const btnClear = document.getElementById('btnClear');

  /**
   * Helpers
   */
  function setLoadMessage(text, kind) {
    loadMsg.textContent = text;
    loadMsg.className = kind === 'error' ? 'error' : (kind === 'success' ? 'success' : 'help');
  }

  function setFilterMessage(text, kind) {
    filterMsg.textContent = text;
    filterMsg.className = kind === 'error' ? 'error' : (kind === 'success' ? 'success' : 'help');
  }

  // Indexes of available boards and CPUs (populated at runtime)
  let boardsIndex = [];
  let cpusIndex = [];

  function findCpuById(cpuId) {
    return cpusIndex.find(function(c){ return c.id === cpuId; }) || null;
  }

  function option(value, label) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    return opt;
  }

  async function loadIndexes() {
    try {
      const [boardsResp, cpusResp] = await Promise.all([
        fetch('boards/index.json', { cache: 'no-store' }),
        fetch('cpus/index.json', { cache: 'no-store' })
      ]);
      const boardFiles = boardsResp.ok ? (await boardsResp.json()).files || [] : [];
      cpusIndex = cpusResp.ok ? (await cpusResp.json()).cpus || [] : [];

      // Fetch each board file to gather metadata
      const boardMetas = [];
      for (let i = 0; i < boardFiles.length; i++) {
        const path = boardFiles[i];
        try {
          const r = await fetch(path, { cache: 'no-store' });
          if (!r.ok) continue;
          const b = await r.json();
          const id = (b && (b.id || b.board || path)) || path;
          const name = (b && (b.board || b.name || id)) || id;
          const cpu = b && b.cpu || '';
          boardMetas.push({ id: String(id), name: String(name), cpu: String(cpu), file: path });
        } catch (e) {
          // skip bad board file
        }
      }
      boardsIndex = boardMetas;

      // Populate selects
      boardSelect.innerHTML = '';
      boardSelect.appendChild(option('', '(No board)'));
      boardsIndex.forEach(function(b){ boardSelect.appendChild(option(b.id, b.name || b.id)); });

      cpuSelect.innerHTML = '';
      cpuSelect.appendChild(option('', '(Select CPU)'));
      cpusIndex.forEach(function(c){ cpuSelect.appendChild(option(c.id, c.name || c.id)); });

      // Ensure CPU select enabled by default when no board selected
      cpuSelect.disabled = false;
      setFilterMessage('Select a board to filter pads, or leave empty.');
    } catch (e) {
      // If indexes fail, keep selects minimal
      boardSelect.innerHTML = '';
      boardSelect.appendChild(option('', '(No board)'));
      cpuSelect.innerHTML = '';
      cpuSelect.appendChild(option('', '(Select CPU)'));
      setFilterMessage('Indexes not found. You can still load files manually.', 'error');
    }
  }

  function clearBoardFilter() {
    teensyPadsSet = null;
    padToPinsMap = null;
    setFilterMessage('No board filter active. Showing all pads.');
    renderPorts();
  }

  async function applyBoardSelection() {
    const boardId = boardSelect.value;
    if (!boardId) {
      // No board selected: enable free CPU selection, clear filter
      cpuSelect.disabled = false;
      clearBoardFilter();
      return;
    }
    // Find board in index
    const boardMeta = boardsIndex.find(function(b){ return b.id === boardId; });
    if (!boardMeta || !boardMeta.file) { setFilterMessage('Board metadata missing.'); return; }
    try {
      const resp = await fetch(boardMeta.file, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      // Build pad filter from board pins
      const pads = new Set();
      const p2p = new Map();
      if (Array.isArray(data.pins)) {
        data.pins.forEach(function(p) {
          if (!p || typeof p.pad !== 'string') return;
          pads.add(p.pad);
          if (typeof p.pin === 'number') {
            if (!p2p.has(p.pad)) p2p.set(p.pad, []);
            p2p.get(p.pad).push(p.pin);
          }
        });
      }
      teensyPadsSet = pads;
      padToPinsMap = p2p;
      setFilterMessage((data.board ? (data.board + ' filter active') : 'Board filter active') + ' (' + pads.size + ' pads).', 'success');
      renderPorts();

      // Set CPU from board definition and lock the CPU selector
      var boardCpu = data.cpu || (boardMeta.cpu || '');
      if (boardCpu) {
        cpuSelect.value = boardCpu;
        cpuSelect.disabled = true;
        await loadPinsForCpu(boardCpu);
      } else {
        cpuSelect.disabled = false;
      }
      saveState();
    } catch (e) {
      setFilterMessage('Failed to load board: ' + e.message, 'error');
      cpuSelect.disabled = false;
    }
  }

  async function loadPinsForCpu(cpuId) {
    if (!cpuId) return;
    const meta = findCpuById(cpuId);
    if (!meta || !meta.file) { setLoadMessage('Unknown CPU id: ' + cpuId, 'error'); return; }
    try {
      setLoadMessage('Loading CPU: ' + (meta.name || cpuId) + ' ...');
      const resp = await fetch(meta.file, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      onPinsDataLoaded(data, 'Loaded CPU pins: ' + (meta.name || cpuId));
    } catch (e) {
      setLoadMessage('Failed to load CPU pins: ' + e.message, 'error');
    }
  }

  async function fetchFirstJson(paths) {
    for (let i = 0; i < paths.length; i++) {
      try {
        const resp = await fetch(paths[i], { cache: 'no-store' });
        if (resp.ok) {
          const data = await resp.json();
          return { data: data, path: paths[i] };
        }
      } catch (e) {
        // ignore and try next
      }
    }
    throw new Error('Not found in: ' + paths.join(', '));
  }

  async function autoLoadJson() {
    try {
      // Prefer current selection; otherwise fallback to legacy search
      const chosenCpu = cpuSelect && cpuSelect.value ? cpuSelect.value : '';
      if (chosenCpu) {
        await loadPinsForCpu(chosenCpu);
        return;
      }
      setLoadMessage('Searching for default CPU pins ...');
      const found = await fetchFirstJson(['cpus/i.mxrt1062.pins.json', 'i.mxrt1062.pins.json']);
      onPinsDataLoaded(found.data, 'Auto-loaded default: ' + found.path);
    } catch (err) {
      setLoadMessage('Auto-load failed. Use file picker. (' + err.message + ')', 'error');
    }
  }

  function readUploadedJson(file) {
    const reader = new FileReader();
    reader.onerror = () => setLoadMessage('Failed to read file.', 'error');
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        onPinsDataLoaded(data, 'Loaded from file: ' + file.name);
      } catch (e) {
        setLoadMessage('Invalid JSON: ' + e.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // Removed legacy auto-load of a specific board filter; board selection drives filter now

  function validateStructure(data) {
    if (typeof data !== 'object' || !data) return false;
    const instances = Object.keys(data);
    if (instances.length === 0) return false;
    // Spot-check first instance/port structure
    const firstInstance = data[instances[0]];
    if (typeof firstInstance !== 'object' || !firstInstance) return false;
    const ports = Object.keys(firstInstance);
    if (ports.length === 0) return false;
    const combos = firstInstance[ports[0]];
    if (!Array.isArray(combos)) return false;
    if (!Array.isArray(combos[0]) || combos[0].length < 1) return false;
    return true;
  }

  function onPinsDataLoaded(data, successText) {
    if (!validateStructure(data)) {
      setLoadMessage('JSON structure not recognized. Expected { [instance]: { [port]: [ [pad, alt], ... ] } }', 'error');
      return;
    }
    pinsData = data;
    setLoadMessage(successText, 'success');
    populateInstances();
    instanceSelect.disabled = false;
    // Select first instance by default
    if (!activeInstance) {
      activeInstance = instanceSelect.value;
    }
    renderPorts();
    updateSummary();
    tryHydrateSelections();
  }

  function populateInstances() {
    instanceSelect.innerHTML = '';
    const frag = document.createDocumentFragment();
    Object.keys(pinsData).forEach(function(instanceKey) {
      const opt = document.createElement('option');
      opt.value = instanceKey;
      opt.textContent = instanceKey;
      frag.appendChild(opt);
      if (!selectionByInstance.has(instanceKey)) selectionByInstance.set(instanceKey, {});
    });
    instanceSelect.appendChild(frag);
    // Preserve active if exists
    if (activeInstance && pinsData[activeInstance]) {
      instanceSelect.value = activeInstance;
    } else {
      activeInstance = instanceSelect.value;
    }
  }

  function renderPorts() {
    portsContainer.innerHTML = '';
    if (!activeInstance || !pinsData || !pinsData[activeInstance]) return;
    const ports = pinsData[activeInstance];
    const sortedPortKeys = Object.keys(ports).sort();
    const frag = document.createDocumentFragment();

    const unavailable = [];

    sortedPortKeys.forEach(function(portKey) {
      const allCombos = Array.isArray(ports[portKey]) ? ports[portKey] : [];
      const filteredCombos = teensyPadsSet ? allCombos.filter(function(tuple){ return teensyPadsSet.has(tuple[0]); }) : allCombos;

      if (filteredCombos.length === 0) {
        unavailable.push(portKey);
        return; // skip rendering selectable card
      }

      const portEl = document.createElement('div');
      portEl.className = 'port';

      const header = document.createElement('div');
      header.className = 'port-header';
      const title = document.createElement('div');
      title.className = 'port-title';
      title.textContent = portKey;
      const info = document.createElement('div');
      info.innerHTML = '<span class="pill">' + filteredCombos.length + ' option' + (filteredCombos.length === 1 ? '' : 's') + '</span>';
      header.appendChild(title);
      header.appendChild(info);
      portEl.appendChild(header);

      const combosEl = document.createElement('div');
      combosEl.className = 'combos';

      const currentSelection = (selectionByInstance.get(activeInstance) || {})[portKey];

      // Build a set of currently used teensy pins across all instances (exclude current port's existing selection to allow switching)
      const usedPins = new Set();
      selectionByInstance.forEach(function(portMap, instKey) {
        Object.keys(portMap).forEach(function(pKey) {
          if (instKey === activeInstance && pKey === portKey) return; // allow replacing selection for this port
          const sel = portMap[pKey];
          const pins = sel && sel.pad && padToPinsMap && padToPinsMap.has(sel.pad) ? padToPinsMap.get(sel.pad) : [];
          pins.forEach(function(pin){ usedPins.add(pin); });
        });
      });

      filteredCombos.forEach(function(tuple, idx) {
        const pad = tuple[0];
        const alt = tuple.length > 1 ? tuple[1] : '-';
        const pins = padToPinsMap && padToPinsMap.has(pad) ? padToPinsMap.get(pad) : [];
        const hasConflict = pins.some(function(pin){ return usedPins.has(pin); });

        const comboEl = document.createElement('label');
        comboEl.className = 'combo' + (hasConflict ? ' disabled' : '');

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'sel:' + portKey;
        radio.value = pad + '|' + alt;
        radio.checked = !!currentSelection && currentSelection.pad === pad && currentSelection.alt === alt;
        radio.disabled = hasConflict;
        // Enable deselect on radios: clicking the already-checked option (label) clears the selection
        comboEl.addEventListener('pointerdown', function() {
          comboEl.dataset.wasChecked = radio.checked ? '1' : '';
        });
        comboEl.addEventListener('click', function(e) {
          if (comboEl.dataset.wasChecked === '1' && !radio.disabled) {
            // prevent default label activation keeping the radio checked
            e.preventDefault();
            radio.checked = false;
            delete comboEl.dataset.wasChecked;
            const map = selectionByInstance.get(activeInstance) || {};
            delete map[portKey];
            selectionByInstance.set(activeInstance, map);
            updateSummary();
            saveState();
          }
        });
        radio.addEventListener('change', function() {
          if (radio.disabled) return;
          const map = selectionByInstance.get(activeInstance) || {};
          map[portKey] = { pad: pad, alt: alt };
          selectionByInstance.set(activeInstance, map);
          updateSummary();
          saveState();
        });

        const padEl = document.createElement('div');
        padEl.className = 'combo-pad';
        padEl.textContent = pad;

        const altEl = document.createElement('div');
        altEl.className = 'combo-mode';
        altEl.textContent = 'Mode: ' + alt;

        comboEl.appendChild(radio);
        comboEl.appendChild(padEl);
        comboEl.appendChild(altEl);
        const pinEl = document.createElement('div');
        if (pins && pins.length) {
          const conflict = hasConflict ? ' pill-danger' : '';
          pinEl.innerHTML = '<span class="pill' + conflict + '">Pin' + (pins.length > 1 ? 's ' : ' ') + pins.join(',') + (hasConflict ? ' (in use)' : '') + '</span>';
        } else {
          pinEl.innerHTML = '<span class="pill">No pin</span>';
        }
        comboEl.appendChild(pinEl);
        combosEl.appendChild(comboEl);
      });

      portEl.appendChild(combosEl);
      frag.appendChild(portEl);
    });

    portsContainer.appendChild(frag);

    if (unavailable.length > 0) {
      const block = document.createElement('div');
      block.className = 'port';
      const header = document.createElement('div');
      header.className = 'port-header';
      const title = document.createElement('div');
      title.className = 'port-title';
      title.textContent = 'Unavailable ports';
      const info = document.createElement('div');
      info.innerHTML = '<span class="pill">' + unavailable.length + '</span>';
      header.appendChild(title);
      header.appendChild(info);
      block.appendChild(header);

      const list = document.createElement('div');
      list.className = 'unavail-list';
      unavailable.forEach(function(portKey){
        const item = document.createElement('div');
        item.className = 'unavail-item';
        const name = document.createElement('div');
        name.textContent = portKey;
        const tag = document.createElement('div');
        tag.innerHTML = '<span class="pill">Not available on Teensy 4.1</span>';
        item.appendChild(name);
        item.appendChild(tag);
        list.appendChild(item);
      });
      block.appendChild(list);
      portsContainer.appendChild(block);
    }
  }

  function getSelectionSummary() {
    const result = {
      instance: activeInstance || null,
      selection: {}
    };
    if (!activeInstance) return result;
    const map = selectionByInstance.get(activeInstance) || {};
    Object.keys(map).sort().forEach(function(portKey) {
      const sel = map[portKey];
      const pins = sel && sel.pad && padToPinsMap && padToPinsMap.has(sel.pad) ? padToPinsMap.get(sel.pad) : [];
      result.selection[portKey] = { pad: sel.pad, alt: sel.alt, pins: pins };
    });
    return result;
  }

  function getAllUsedPins() {
    // Build a flat list of all pin usages across all instances
    const rows = [];
    selectionByInstance.forEach(function(portMap, instanceKey) {
      Object.keys(portMap).forEach(function(portKey) {
        const sel = portMap[portKey];
        const pins = sel && sel.pad && padToPinsMap && padToPinsMap.has(sel.pad) ? padToPinsMap.get(sel.pad) : [];
        if (pins.length === 0) {
          rows.push({ pin: null, pad: sel.pad, alt: sel.alt, instance: instanceKey, port: portKey });
        } else {
          pins.forEach(function(pinNum) {
            rows.push({ pin: pinNum, pad: sel.pad, alt: sel.alt, instance: instanceKey, port: portKey });
          });
        }
      });
    });
    // sort by pin asc, nulls last
    rows.sort(function(a, b){
      if (a.pin == null && b.pin == null) return 0;
      if (a.pin == null) return 1;
      if (b.pin == null) return -1;
      return a.pin - b.pin;
    });
    return rows;
  }

  function updateSummary() {
    const summary = getSelectionSummary();
    const rows = Object.keys(summary.selection);
    summaryTbody.innerHTML = '';
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'help';
      td.textContent = 'No selection.';
      tr.appendChild(td);
      summaryTbody.appendChild(tr);
    } else {
      rows.sort().forEach(function(portKey) {
        const sel = summary.selection[portKey];
        const tr = document.createElement('tr');
        const tdInst = document.createElement('td');
        tdInst.textContent = summary.instance || '-';
        const tdPort = document.createElement('td');
        tdPort.textContent = portKey;
        const tdPad = document.createElement('td');
        tdPad.className = 'mono';
        tdPad.textContent = sel.pad;
        const tdAlt = document.createElement('td');
        tdAlt.textContent = sel.alt;
        const tdPins = document.createElement('td');
        tdPins.textContent = (sel.pins && sel.pins.length) ? sel.pins.join(',') : '-';
        tr.appendChild(tdInst);
        tr.appendChild(tdPort);
        tr.appendChild(tdPad);
        tr.appendChild(tdAlt);
        tr.appendChild(tdPins);
        summaryTbody.appendChild(tr);
      });
    }

    // Update global used pins table
    const usedRows = getAllUsedPins();
    usedPinsTbody.innerHTML = '';
    if (usedRows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'help';
      td.textContent = 'No pins selected.';
      tr.appendChild(td);
      usedPinsTbody.appendChild(tr);
    } else {
      usedRows.forEach(function(row) {
        const tr = document.createElement('tr');
        const tdInst = document.createElement('td');
        tdInst.textContent = row.instance;
        const tdPort = document.createElement('td');
        tdPort.textContent = row.port;
        const tdPad = document.createElement('td');
        tdPad.className = 'mono';
        tdPad.textContent = row.pad;
        const tdAlt = document.createElement('td');
        tdAlt.textContent = row.alt || '-';
        const tdPin = document.createElement('td');
        tdPin.textContent = row.pin == null ? '-' : String(row.pin);
        tr.appendChild(tdInst);
        tr.appendChild(tdPort);
        tr.appendChild(tdPad);
        tr.appendChild(tdAlt);
        tr.appendChild(tdPin);
        usedPinsTbody.appendChild(tr);
      });
    }
  }

  function copySummaryToClipboard() {
    const text = JSON.stringify(getSelectionSummary(), null, 2);
    navigator.clipboard.writeText(text).then(function(){
      setLoadMessage('Summary copied to clipboard.', 'success');
    }, function(){
      setLoadMessage('Failed to copy. You can select text manually.', 'error');
    });
  }

  function downloadSelectionJson() {
    const data = getSelectionSummary();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = (activeInstance || 'selection') + '.pins.selection.json';
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
  }

  function selectionsToCsvRows() {
    const rows = [['instance','port','pad','alt','pins']];
    selectionByInstance.forEach(function(portMap, instanceKey) {
      Object.keys(portMap).sort().forEach(function(portKey) {
        const sel = portMap[portKey];
        const pins = sel && sel.pad && padToPinsMap && padToPinsMap.has(sel.pad) ? padToPinsMap.get(sel.pad) : [];
        rows.push([instanceKey, portKey, sel.pad, sel.alt || '-', pins.join(' ')]);
      });
    });
    return rows;
  }

  function downloadCsv() {
    const rows = selectionsToCsvRows();
    const csv = rows.map(function(cols) {
      return cols.map(function(cell) {
        const s = String(cell == null ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = 'pins.selection.csv';
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
  }

  function applyCsv(text) {
    csvMsg.textContent = '';
    const lines = text.split(/\r?\n/).filter(function(l){ return l.trim().length > 0; });
    if (lines.length === 0) { csvMsg.textContent = 'Empty CSV.'; return; }
    const header = lines[0].split(',').map(function(s){ return s.trim().toLowerCase(); });
    const idxInstance = header.indexOf('instance');
    const idxPort = header.indexOf('port');
    const idxPad = header.indexOf('pad');
    const idxAlt = header.indexOf('alt');
    if (idxInstance < 0 || idxPort < 0 || idxPad < 0) { csvMsg.textContent = 'CSV must include columns: instance, port, pad, [alt]'; return; }
    // Build target selections keyed by instance->port
    const desired = new Map();
    for (let i=1;i<lines.length;i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;
      // naive CSV parse for common cases (handles quoted with "," escapes)
      const cols = [];
      let cur = '';
      let inQ = false;
      for (let j=0;j<raw.length;j++) {
        const ch = raw[j];
        if (inQ) {
          if (ch === '"') {
            if (raw[j+1] === '"') { cur += '"'; j++; }
            else { inQ = false; }
          } else cur += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === ',') { cols.push(cur); cur=''; }
          else cur += ch;
        }
      }
      cols.push(cur);
      const inst = (cols[idxInstance] || '').trim();
      const port = (cols[idxPort] || '').trim();
      const pad = (cols[idxPad] || '').trim();
      const alt = idxAlt >= 0 ? (cols[idxAlt] || '').trim() : '-';
      if (!inst || !port || !pad) continue;
      if (!desired.has(inst)) desired.set(inst, {});
      desired.get(inst)[port] = { pad: pad, alt: alt };
    }
    // Apply selections with conflict checks
    let applied = 0, skipped = 0;
    desired.forEach(function(portMap, instKey) {
      Object.keys(portMap).forEach(function(portKey){
        const sel = portMap[portKey];
        // validate pad exists for that port in that instance
        const combos = pinsData && pinsData[instKey] && pinsData[instKey][portKey];
        if (!Array.isArray(combos)) { skipped++; return; }
        const exists = combos.some(function(tuple){ return tuple[0] === sel.pad && (tuple[1] || '-') === (sel.alt || '-'); });
        if (!exists) { skipped++; return; }
        // check conflicts
        const pins = padToPinsMap && padToPinsMap.has(sel.pad) ? padToPinsMap.get(sel.pad) : [];
        const usedPins = new Set();
        selectionByInstance.forEach(function(pm, ik){ Object.keys(pm).forEach(function(pk){ const s = pm[pk]; const ps = padToPinsMap && s && padToPinsMap.get(s.pad) || []; ps.forEach(function(p){ usedPins.add(p); }); }); });
        const hasConflict = pins.some(function(p){ return usedPins.has(p); });
        if (hasConflict) { skipped++; return; }
        // apply
        if (!selectionByInstance.has(instKey)) selectionByInstance.set(instKey, {});
        const map = selectionByInstance.get(instKey);
        map[portKey] = { pad: sel.pad, alt: sel.alt };
        selectionByInstance.set(instKey, map);
        applied++;
      });
    });
    csvMsg.textContent = 'Applied ' + applied + ' selections.' + (skipped ? (' Skipped ' + skipped + ' (invalid or conflicts).') : '');
    // refresh UI
    populateInstances();
    renderPorts();
    updateSummary();
    saveState();
  }

  /**
   * Events
   */
  if (btnAutoLoad) btnAutoLoad.addEventListener('click', function() { autoLoadJson(); });
  boardSelect.addEventListener('change', function(){ applyBoardSelection(); saveState(); });
  cpuSelect.addEventListener('change', function(){ if (!cpuSelect.disabled) { loadPinsForCpu(cpuSelect.value); saveState(); } });
  if (fileInput) fileInput.addEventListener('change', function(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (file) readUploadedJson(file);
  });
  instanceSelect.addEventListener('change', function() {
    activeInstance = instanceSelect.value;
    renderPorts();
    updateSummary();
    saveState();
  });
  btnCopy.addEventListener('click', function(){ copySummaryToClipboard(); });
  btnDownload.addEventListener('click', function(){ downloadSelectionJson(); });
  btnDownloadCsv.addEventListener('click', function(){ downloadCsv(); });
  if (btnClear) btnClear.addEventListener('click', function(){
    // clear selections across all instances
    selectionByInstance.forEach(function(portMap, inst){ Object.keys(portMap).forEach(function(p){ delete portMap[p]; }); });
    renderPorts();
    updateSummary();
    saveState();
  });
  csvUpload.addEventListener('change', function(ev){
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = function(){ csvMsg.textContent = 'Failed to read CSV.'; };
    reader.onload = function(){ applyCsv(String(reader.result || '')); };
    reader.readAsText(file);
    // reset input to allow re-uploading the same file later
    ev.target.value = '';
  });

  // Initialize indexes on first paint and restore state
  let pendingHydration = null;
  function tryHydrateSelections() {
    if (!pendingHydration || !pinsData) return;
    const s = pendingHydration;
    pendingHydration = null;
    // restore selections across instances
    if (s.selections && typeof s.selections === 'object') {
      Object.keys(s.selections).forEach(function(inst){
        const map = s.selections[inst];
        if (!selectionByInstance.has(inst)) selectionByInstance.set(inst, {});
        const cur = selectionByInstance.get(inst);
        Object.keys(map || {}).forEach(function(port){
          const sel = map[port];
          cur[port] = { pad: sel.pad, alt: sel.alt };
        });
        selectionByInstance.set(inst, cur);
      });
    }
    // restore active instance
    if (s.activeInstance && pinsData[s.activeInstance]) {
      activeInstance = s.activeInstance;
      if (instanceSelect) instanceSelect.value = s.activeInstance;
    }
    renderPorts();
    updateSummary();
  }

  setTimeout(function(){
    loadIndexes().then(function(){
      const s = loadState();
      if (!s) return;
      // set board first (locks CPU if provided by board)
      if (boardSelect && s.boardId && Array.from(boardSelect.options).some(function(o){ return o.value === s.boardId; })) {
        boardSelect.value = s.boardId;
        applyBoardSelection();
      }
      // if CPU not locked by board, restore CPU
      if (s.cpuId && cpuSelect && !cpuSelect.disabled && Array.from(cpuSelect.options).some(function(o){ return o.value === s.cpuId; })) {
        cpuSelect.value = s.cpuId;
        loadPinsForCpu(s.cpuId);
      }
      // defer selection hydration until pins are loaded
      pendingHydration = s;
    });
  }, 0);
})();


