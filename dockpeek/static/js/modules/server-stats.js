// modules/server-stats.js
import { apiUrl } from './config.js';

let serverStatsInterval = null;
let isStatsVisible = true;

/**
 * Fetch server stats from the API
 */
export async function fetchServerStats() {
  try {
    const response = await fetch(apiUrl('/server-stats'));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch server stats:', error);
    return null;
  }
}

/**
 * Get color class based on usage percentage
 */
function getUsageColor(percent) {
  if (percent >= 90) return 'usage-critical';
  if (percent >= 75) return 'usage-warning';
  return 'usage-good';
}

/**
 * Format bytes to GB with 1 decimal place
 */
function formatGB(gb) {
  return gb.toFixed(1);
}

/**
 * Create a resource bar (memory or disk)
 */
function createResourceBar(resource, label, icon) {
  const percent = resource.percent || 0;
  const colorClass = getUsageColor(percent);
  const usedGB = formatGB(resource.used_gb || 0);
  const totalGB = formatGB(resource.total_gb || 0);

  return `
    <div class="resource-bar">
      <div class="resource-header">
        <span class="resource-label">
          ${icon}
          <span>${label}</span>
        </span>
        <span class="resource-value ${colorClass}">${usedGB} / ${totalGB} GB</span>
      </div>
      <div class="resource-progress">
        <div class="resource-progress-fill ${colorClass}" style="width: ${percent}%"></div>
      </div>
      <div class="resource-percent ${colorClass}">${percent.toFixed(1)}%</div>
    </div>
  `;
}

/**
 * Create CPU info display
 */
function createCPUInfo(cpu) {
  const cores = cpu.count || 0;
  const percent = cpu.percent;

  let cpuContent = `<span class="cpu-cores">${cores} core${cores !== 1 ? 's' : ''}</span>`;

  if (percent !== undefined && percent !== null) {
    const colorClass = getUsageColor(percent);
    cpuContent += ` <span class="cpu-usage ${colorClass}">${percent.toFixed(1)}%</span>`;
  }

  return `
    <div class="resource-info">
      <span class="resource-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
          <rect x="9" y="9" width="6" height="6"></rect>
          <line x1="9" y1="1" x2="9" y2="4"></line>
          <line x1="15" y1="1" x2="15" y2="4"></line>
          <line x1="9" y1="20" x2="9" y2="23"></line>
          <line x1="15" y1="20" x2="15" y2="23"></line>
          <line x1="20" y1="9" x2="23" y2="9"></line>
          <line x1="20" y1="14" x2="23" y2="14"></line>
          <line x1="1" y1="9" x2="4" y2="9"></line>
          <line x1="1" y1="14" x2="4" y2="14"></line>
        </svg>
        <span>CPU</span>
      </span>
      <span class="resource-value">${cpuContent}</span>
    </div>
  `;
}

/**
 * Create a server card
 */
function createServerCard(stat) {
  const sourceLabel = stat.source_type === 'docker-host' ? 'Docker Host' : 'VPS';
  const statusClass = stat.status === 'active' || stat.status === 'running' ? 'status-active' : 'status-inactive';

  const memoryIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
  </svg>`;

  const diskIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
  </svg>`;

  return `
    <div class="server-card">
      <div class="server-card-header">
        <span class="server-name" title="${stat.server_name}">${stat.server_name}</span>
        <span class="server-type">${sourceLabel}</span>
        <span class="server-status ${statusClass}"></span>
      </div>
      <div class="server-card-body">
        ${createResourceBar(stat.memory, 'Memory', memoryIcon)}
        ${createResourceBar(stat.disk, 'Disk', diskIcon)}
        ${createCPUInfo(stat.cpu)}
      </div>
    </div>
  `;
}

/**
 * Update the server stats display
 */
export function updateServerStatsDisplay(data) {
  const container = document.getElementById('server-stats-container');
  if (!container) return;

  if (!data || !data.stats || data.stats.length === 0) {
    container.innerHTML = '<div class="server-stats-empty">No server statistics available</div>';
    return;
  }

  const cards = data.stats.map(stat => createServerCard(stat)).join('');
  const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : '';

  container.innerHTML = `
    <div class="server-stats-grid">
      ${cards}
    </div>
    ${timestamp ? `<div class="server-stats-updated">Last updated: ${timestamp}</div>` : ''}
  `;
}

/**
 * Refresh server stats
 */
export async function refreshServerStats() {
  const data = await fetchServerStats();
  updateServerStatsDisplay(data);
}

/**
 * Initialize server stats polling
 */
export function initServerStats() {
  // Load saved visibility state
  const savedState = localStorage.getItem('serverStatsVisible');
  if (savedState !== null) {
    isStatsVisible = JSON.parse(savedState);
  }

  const statsSection = document.getElementById('server-stats-section');
  const toggleButton = document.getElementById('server-stats-toggle');

  if (statsSection && toggleButton) {
    // Apply saved state
    if (!isStatsVisible) {
      statsSection.classList.add('hidden');
      toggleButton.classList.add('collapsed');
    }

    // Setup toggle button
    toggleButton.addEventListener('click', toggleServerStats);
  }

  // Initial fetch
  refreshServerStats();

  // Poll every 30 seconds
  if (serverStatsInterval) {
    clearInterval(serverStatsInterval);
  }
  serverStatsInterval = setInterval(refreshServerStats, 30000);
}

/**
 * Toggle server stats visibility
 */
export function toggleServerStats() {
  isStatsVisible = !isStatsVisible;
  localStorage.setItem('serverStatsVisible', JSON.stringify(isStatsVisible));

  const statsSection = document.getElementById('server-stats-section');
  const toggleButton = document.getElementById('server-stats-toggle');

  if (statsSection && toggleButton) {
    if (isStatsVisible) {
      statsSection.classList.remove('hidden');
      toggleButton.classList.remove('collapsed');
    } else {
      statsSection.classList.add('hidden');
      toggleButton.classList.add('collapsed');
    }
  }
}

/**
 * Stop polling
 */
export function stopServerStatsPolling() {
  if (serverStatsInterval) {
    clearInterval(serverStatsInterval);
    serverStatsInterval = null;
  }
}
