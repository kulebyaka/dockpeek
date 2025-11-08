import { apiUrl } from './config.js';
import { state } from './state.js';

const usageCache = new Map();
const keyInfoMap = new Map();
const pendingKeys = new Set();
let fetchInProgress = false;
let fetchScheduled = false;
let fetchTimeoutId = null;

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

function setUsageValue(cell, usage, limit, type, error) {
  if (typeof usage !== 'number') {
    const reason = error || 'Usage information not available';
    setUnavailable(cell, reason);
    return;
  }

  const usageText = formatBytes(usage) || `${usage} B`;
  let tooltip = '';

  if (typeof limit === 'number' && limit > 0) {
    const limitText = formatBytes(limit) || `${limit} B`;
    const percent = limit ? ((usage / limit) * 100).toFixed(1) : null;
    if (type === 'ram') {
      tooltip = percent ? `RAM: ${usageText} / ${limitText} (${percent}%)` : `RAM: ${usageText} / ${limitText}`;
    } else {
      tooltip = percent ? `Disk: ${usageText} / ${limitText} (${percent}%)` : `Disk: ${usageText} / ${limitText}`;
    }
  } else if (type === 'ram') {
    tooltip = `RAM: ${usageText}`;
  } else {
    tooltip = `Disk: ${usageText}`;
  }

  cell.innerHTML = `<span class="usage-value">${usageText}</span>`;
  if (tooltip) {
    cell.setAttribute('data-tooltip', tooltip);
  } else {
    cell.removeAttribute('data-tooltip');
  }
}

function updateCellsForKey(key, usage) {
  const selectorKey = escapeForSelector(key);
  document.querySelectorAll(`[data-usage-key="${selectorKey}"]`).forEach(cell => {
    const type = cell.dataset.usageType;
    if (!type) return;
    if (type === 'ram') {
      setUsageValue(cell, usage.memory_usage, usage.memory_limit, type, usage.memory_error || usage.error);
    } else if (type === 'disk') {
      setUsageValue(cell, usage.disk_usage, usage.disk_total, type, usage.disk_error || usage.error);
    }
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
  }
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
      updateCellsForKey(key, fallback);
    });
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
    updateCellsForKey(key, cached);
    return;
  }

  const hasInitialMemory = typeof container.memory_usage === 'number';
  const hasInitialDisk = typeof container.disk_usage === 'number';

  if (hasInitialMemory || hasInitialDisk) {
    const initialUsage = {
      memory_usage: hasInitialMemory ? container.memory_usage : null,
      memory_limit: typeof container.memory_limit === 'number' ? container.memory_limit : null,
      disk_usage: hasInitialDisk ? container.disk_usage : null,
      disk_total: typeof container.disk_total === 'number' ? container.disk_total : null,
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
