import { apiUrl } from './config.js';
import { state } from './state.js';

const usageCache = new Map();
const keyInfoMap = new Map();
const pendingKeys = new Set();
let fetchInProgress = false;
let fetchScheduled = false;
let fetchTimeoutId = null;

const defaultTotalsConfig = {
  row: null,
  ramCell: null,
  diskCell: null,
  getContainers: null
};

let totalsConfig = { ...defaultTotalsConfig };
let totalsUpdateScheduled = false;

function createUsageKey(server, identifier) {
  return `${server}:${identifier}`;
}

function escapeForSelector(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/"/g, '\\"').replace(/:/g, '\\:');
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return null;
  }
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(value >= 100 || value < 10 ? 1 : 2)} ${sizes[i]}`;
}

function setLoading(cell) {
  cell.innerHTML = '<span class="usage-placeholder"></span>';
  cell.removeAttribute('data-tooltip');
}

function setUnavailable(cell, reason) {
  cell.innerHTML = '<span class="usage-unavailable">n/a</span>';
  if (reason) {
    cell.setAttribute('data-tooltip', reason);
  } else {
    cell.removeAttribute('data-tooltip');
  }
}

function isValidNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}

function setUsageValue(cell, { usage, limit, type, error, display }) {
  const displayValue = isValidNumber(display)
    ? display
    : isValidNumber(usage)
      ? usage
      : null;

  if (!isValidNumber(displayValue)) {
    const reason = error || 'Usage information not available';
    setUnavailable(cell, reason);
    return;
  }

  const usageValue = isValidNumber(usage) ? usage : null;
  const limitValue = isValidNumber(limit) ? limit : null;

  const displayText = formatBytes(displayValue) || `${displayValue} B`;
  const usageText = usageValue !== null ? (formatBytes(usageValue) || `${usageValue} B`) : null;
  let tooltip = '';

  if (usageText && limitValue !== null && limitValue > 0) {
    const limitText = formatBytes(limitValue) || `${limitValue} B`;
    const percent = limitValue ? ((usageValue / limitValue) * 100).toFixed(1) : null;
    if (type === 'ram') {
      tooltip = percent ? `RAM: ${usageText} / ${limitText} (${percent}%)` : `RAM: ${usageText} / ${limitText}`;
    } else {
      tooltip = percent ? `Disk: ${usageText} / ${limitText} (${percent}%)` : `Disk: ${usageText} / ${limitText}`;
    }
  } else if (usageText) {
    tooltip = type === 'ram' ? `RAM: ${usageText}` : `Disk: ${usageText}`;
  } else if (limitValue !== null) {
    const limitText = formatBytes(limitValue) || `${limitValue} B`;
    tooltip = type === 'ram' ? `RAM: ${limitText}` : `Disk: ${limitText}`;
  }

  cell.innerHTML = `<span class="usage-value">${displayText}</span>`;
  if (tooltip) {
    cell.setAttribute('data-tooltip', tooltip);
  } else {
    cell.removeAttribute('data-tooltip');
  }
}

function updateUsageCell(cell, usage) {
  if (!cell) return;

  const type = cell.dataset.usageType;
  if (!type) return;

  if (type === 'ram') {
    setUsageValue(cell, {
      usage: usage.memory_usage,
      limit: usage.memory_limit,
      type,
      error: usage.memory_error || usage.error
    });
  } else if (type === 'disk') {
    setUsageValue(cell, {
      usage: usage.disk_usage,
      limit: usage.disk_total,
      type,
      error: usage.disk_error || usage.error,
      display: usage.disk_total
    });
  }
}

function updateCellsForKey(key, usage) {
  const selectorKey = escapeForSelector(key);
  document.querySelectorAll(`[data-usage-key="${selectorKey}"]`).forEach(cell => {
    updateUsageCell(cell, usage);
  });
}

function updateCellsForRow(rowElement, usage) {
  if (!rowElement) return;
  rowElement.querySelectorAll('[data-usage-key]').forEach(cell => {
    updateUsageCell(cell, usage);
  });
}

function updateStateUsage(key, usage) {
  const info = keyInfoMap.get(key);
  if (!info) return;

  const match = state.allContainersData.find(container => {
    if (container.server !== info.server) return false;
    if (info.containerId && (container.container_id_full === info.containerId || container.container_id === info.containerId)) {
      return true;
    }
    return container.name === info.containerName;
  });

  if (match) {
    match.memory_usage = typeof usage.memory_usage === 'number' ? usage.memory_usage : null;
    match.memory_limit = typeof usage.memory_limit === 'number' ? usage.memory_limit : null;
    match.disk_usage = typeof usage.disk_usage === 'number' ? usage.disk_usage : null;
    match.disk_total = typeof usage.disk_total === 'number' ? usage.disk_total : null;
    match.memory_error = usage.memory_error || usage.error || null;
    match.disk_error = usage.disk_error || usage.error || null;
  }

  scheduleTotalsUpdate();
}

function buildPayload(keys) {
  const payload = [];
  keys.forEach(key => {
    const info = keyInfoMap.get(key);
    if (!info) return;
    payload.push({
      server: info.server,
      container_id: info.containerId,
      container_name: info.containerName
    });
  });
  return payload;
}

async function executeFetch() {
  if (fetchInProgress || pendingKeys.size === 0) {
    return;
  }

  fetchInProgress = true;
  const keysToFetch = Array.from(pendingKeys);
  pendingKeys.clear();

  const payload = buildPayload(keysToFetch);
  if (!payload.length) {
    fetchInProgress = false;
    return;
  }

  try {
    const response = await fetch(apiUrl('/container-stats'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containers: payload })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch container stats (${response.status})`);
    }

    const data = await response.json();
    const stats = data.stats || {};

    keysToFetch.forEach(key => {
      const usage = stats[key] || {
        memory_usage: null,
        memory_limit: null,
        memory_error: 'No data',
        disk_usage: null,
        disk_total: null,
        disk_error: 'No data',
        error: 'No data'
      };

      usageCache.set(key, usage);
      updateStateUsage(key, usage);
      updateCellsForKey(key, usage);
    });
    scheduleTotalsUpdate();
  } catch (error) {
    console.error('Error fetching container usage:', error);
    keysToFetch.forEach(key => {
      const fallback = {
        memory_usage: null,
        memory_limit: null,
        memory_error: error.message,
        disk_usage: null,
        disk_total: null,
        disk_error: error.message,
        error: error.message
      };
      usageCache.set(key, fallback);
      updateStateUsage(key, fallback);
      updateCellsForKey(key, fallback);
    });
    scheduleTotalsUpdate();
  } finally {
    fetchInProgress = false;
    if (pendingKeys.size > 0) {
      scheduleFetch();
    }
  }
}

function scheduleFetch() {
  if (fetchScheduled || fetchInProgress || pendingKeys.size === 0) {
    return;
  }

  fetchScheduled = true;
  fetchTimeoutId = setTimeout(() => {
    fetchScheduled = false;
    fetchTimeoutId = null;
    executeFetch();
  }, 100);
}

function hasCachedUsage(key) {
  return usageCache.has(key);
}

function getCachedUsage(key) {
  return usageCache.get(key);
}

export function registerUsageCells(rowElement, container) {
  const server = container.server;
  if (!server) return;

  const identifier = container.container_id_full || container.container_id || container.name;
  if (!identifier) return;

  const key = createUsageKey(server, identifier);
  const isSwarm = Boolean(container.is_swarm);

  const info = {
    server,
    containerId: container.container_id_full || container.container_id,
    containerName: container.name
  };
  keyInfoMap.set(key, info);

  const ramCell = rowElement.querySelector('[data-content="ram"]');
  const diskCell = rowElement.querySelector('[data-content="disk"]');

  if (ramCell) {
    ramCell.dataset.usageKey = key;
    ramCell.dataset.usageType = 'ram';
  }

  if (diskCell) {
    diskCell.dataset.usageKey = key;
    diskCell.dataset.usageType = 'disk';
  }

  if (isSwarm) {
    if (ramCell) setUnavailable(ramCell, 'Usage not available for Swarm services');
    if (diskCell) setUnavailable(diskCell, 'Usage not available for Swarm services');
    return;
  }

  const cached = hasCachedUsage(key) ? getCachedUsage(key) : null;
  if (cached) {
    updateCellsForRow(rowElement, cached);
    updateCellsForKey(key, cached);
    return;
  }

  const hasInitialMemory = typeof container.memory_usage === 'number';
  const hasInitialDiskUsage = typeof container.disk_usage === 'number';
  const hasInitialDiskTotal = typeof container.disk_total === 'number';
  const hasInitialDisk = hasInitialDiskUsage || hasInitialDiskTotal;

  if (hasInitialMemory || hasInitialDisk) {
    const initialUsage = {
      memory_usage: hasInitialMemory ? container.memory_usage : null,
      memory_limit: typeof container.memory_limit === 'number' ? container.memory_limit : null,
      disk_usage: hasInitialDiskUsage ? container.disk_usage : null,
      disk_total: hasInitialDiskTotal ? container.disk_total : null,
      memory_error: null,
      disk_error: null,
      error: null
    };
    usageCache.set(key, initialUsage);
    updateCellsForKey(key, initialUsage);
    return;
  }

  if (ramCell) setLoading(ramCell);
  if (diskCell) setLoading(diskCell);

  pendingKeys.add(key);
}

export function requestPendingUsage() {
  scheduleFetch();
}

export function resetUsageCache() {
  usageCache.clear();
  keyInfoMap.clear();
  pendingKeys.clear();
  if (fetchTimeoutId) {
    clearTimeout(fetchTimeoutId);
    fetchTimeoutId = null;
  }
  fetchScheduled = false;
  fetchInProgress = false;
}

function computeTotals(containers) {
  const totals = {
    containerCount: containers.length,
    ram: { total: 0, count: 0, expected: 0, errors: 0 },
    disk: { total: 0, count: 0, expected: 0, errors: 0 }
  };

  containers.forEach(container => {
    if (!container || container.is_swarm) {
      return;
    }

    totals.ram.expected += 1;
    totals.disk.expected += 1;

    const memoryValue = typeof container.memory_usage === 'number' ? container.memory_usage : null;
    const diskValue = typeof container.disk_total === 'number'
      ? container.disk_total
      : (typeof container.disk_usage === 'number' ? container.disk_usage : null);

    if (memoryValue !== null) {
      totals.ram.total += memoryValue;
      totals.ram.count += 1;
    } else if (container.memory_error) {
      totals.ram.errors += 1;
    }

    if (diskValue !== null) {
      totals.disk.total += diskValue;
      totals.disk.count += 1;
    } else if (container.disk_error) {
      totals.disk.errors += 1;
    }
  });

  return totals;
}

function setTotalsCellUnavailable(cell, message) {
  if (!cell) return;
  cell.innerHTML = '<span class="usage-unavailable">n/a</span>';
  if (message) {
    cell.setAttribute('data-tooltip', message);
  } else {
    cell.removeAttribute('data-tooltip');
  }
}

function setTotalsCellLoading(cell, message) {
  if (!cell) return;
  cell.innerHTML = '<span class="usage-placeholder"></span>';
  if (message) {
    cell.setAttribute('data-tooltip', message);
  } else {
    cell.removeAttribute('data-tooltip');
  }
}

function setTotalsCellValue(cell, bytes, count, expected, label) {
  if (!cell) return;
  const formatted = formatBytes(bytes) || `${bytes} B`;
  const tooltipParts = [`${label}: ${formatted}`];
  if (expected > 0 && count < expected) {
    tooltipParts.push(`Includes ${count} of ${expected} containers`);
  }
  cell.innerHTML = `<span class="usage-value table-total-value">${formatted}</span>`;
  cell.setAttribute('data-tooltip', tooltipParts.join(' • '));
}

function updateTotalsDisplay() {
  if (!totalsConfig.row || typeof totalsConfig.getContainers !== 'function') {
    return;
  }

  const containers = totalsConfig.getContainers() || [];
  const { ram, disk, containerCount } = computeTotals(containers);

  const ramCell = totalsConfig.ramCell;
  const diskCell = totalsConfig.diskCell;

  if (containerCount === 0) {
    setTotalsCellValue(ramCell, 0, 0, 0, 'RAM');
    setTotalsCellValue(diskCell, 0, 0, 0, 'Disk');
    return;
  }

  if (ram.expected === 0) {
    setTotalsCellUnavailable(ramCell, 'RAM totals are not available for the selected containers');
  } else if (ram.count === 0) {
    if (ram.errors === ram.expected) {
      setTotalsCellUnavailable(ramCell, 'RAM totals could not be determined');
    } else {
      setTotalsCellLoading(ramCell, 'Loading RAM totals…');
    }
  } else {
    setTotalsCellValue(ramCell, ram.total, ram.count, ram.expected, 'RAM');
  }

  if (disk.expected === 0) {
    setTotalsCellUnavailable(diskCell, 'Disk totals are not available for the selected containers');
  } else if (disk.count === 0) {
    if (disk.errors === disk.expected) {
      setTotalsCellUnavailable(diskCell, 'Disk totals could not be determined');
    } else {
      setTotalsCellLoading(diskCell, 'Loading disk totals…');
    }
  } else {
    setTotalsCellValue(diskCell, disk.total, disk.count, disk.expected, 'Disk');
  }
}

function scheduleTotalsUpdate() {
  if (!totalsConfig.row || totalsUpdateScheduled) {
    return;
  }

  totalsUpdateScheduled = true;
  const scheduler = window.requestAnimationFrame || (callback => setTimeout(callback, 16));
  scheduler(() => {
    totalsUpdateScheduled = false;
    updateTotalsDisplay();
  });
}

export function registerTotalsRow(rowElement, getContainers) {
  totalsConfig = {
    row: rowElement,
    ramCell: rowElement?.querySelector('[data-total="ram"]') || null,
    diskCell: rowElement?.querySelector('[data-total="disk"]') || null,
    getContainers: typeof getContainers === 'function' ? getContainers : null
  };

  totalsUpdateScheduled = false;
  updateTotalsDisplay();
}

export function clearTotalsRow() {
  totalsConfig = { ...defaultTotalsConfig };
  totalsUpdateScheduled = false;
}
