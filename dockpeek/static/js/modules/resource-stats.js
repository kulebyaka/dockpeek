import { apiUrl } from './config.js';
import { formatBytes } from './cell-renderer.js';

const statsCache = new Map();
const CACHE_DURATION = 60000; // 60 seconds

export async function fetchContainerStats(serverName, containerName) {
  const key = `${serverName}:${containerName}`;

  // Check cache
  const cached = statsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    const response = await fetch(apiUrl('/container-stats'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        server_name: serverName,
        container_name: containerName
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Cache the result
    statsCache.set(key, {
      data,
      timestamp: Date.now()
    });

    return data;
  } catch (error) {
    console.error(`Error fetching stats for ${key}:`, error);
    return null;
  }
}

export async function updateCellStats(cell, serverName, containerName, type) {
  const stats = await fetchContainerStats(serverName, containerName);

  if (!stats) {
    cell.innerHTML = '<span class="text-gray-400 text-sm">N/A</span>';
    return;
  }

  if (stats.status === 'not_running') {
    cell.innerHTML = '<span class="text-gray-400 text-sm">-</span>';
    return;
  }

  if (type === 'ram') {
    const ramUsage = formatBytes(stats.ram);
    const ramLimit = stats.ram_limit ? formatBytes(stats.ram_limit) : null;

    if (ramLimit && stats.ram_limit > 0) {
      const percent = ((stats.ram / stats.ram_limit) * 100).toFixed(1);
      cell.innerHTML = `<span class="text-sm">${ramUsage} / ${ramLimit}</span><br><span class="text-xs text-gray-500">${percent}%</span>`;
    } else {
      cell.innerHTML = `<span class="text-sm">${ramUsage}</span>`;
    }
  } else if (type === 'disk') {
    const diskUsage = formatBytes(stats.disk);
    cell.innerHTML = `<span class="text-sm">${diskUsage}</span>`;
  }
}

export async function loadAllContainerStats() {
  const ramCells = document.querySelectorAll('.table-cell-ram');
  const diskCells = document.querySelectorAll('.table-cell-disk');

  // Create an array of all fetch promises with rate limiting
  const CONCURRENT_REQUESTS = 5;
  const allFetches = [];

  // Process RAM cells
  for (const cell of ramCells) {
    const serverName = cell.getAttribute('data-server');
    const containerName = cell.getAttribute('data-container');

    if (serverName && containerName) {
      allFetches.push({
        cell,
        serverName,
        containerName,
        type: 'ram'
      });
    }
  }

  // Process Disk cells
  for (const cell of diskCells) {
    const serverName = cell.getAttribute('data-server');
    const containerName = cell.getAttribute('data-container');

    if (serverName && containerName) {
      allFetches.push({
        cell,
        serverName,
        containerName,
        type: 'disk'
      });
    }
  }

  // Process requests in batches
  for (let i = 0; i < allFetches.length; i += CONCURRENT_REQUESTS) {
    const batch = allFetches.slice(i, i + CONCURRENT_REQUESTS);
    await Promise.all(
      batch.map(({ cell, serverName, containerName, type }) =>
        updateCellStats(cell, serverName, containerName, type)
      )
    );
  }
}

export function clearStatsCache() {
  statsCache.clear();
}
