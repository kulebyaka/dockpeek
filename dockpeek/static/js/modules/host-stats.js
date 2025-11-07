// modules/host-stats.js

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function updateHostStats() {
  fetch('/host-stats')
    .then(response => {
      if (!response.ok) throw new Error('Failed to fetch host stats');
      return response.json();
    })
    .then(data => {
      displayHostStats(data);
    })
    .catch(error => {
      console.error('Error fetching host stats:', error);
    });
}

function displayHostStats(data) {
  const container = document.getElementById('host-stats');
  if (!container) return;

  const cpuPercent = data.cpu.percent;
  const memPercent = data.memory.percent;
  const diskPercent = data.disk.percent;

  const memUsed = formatBytes(data.memory.used);
  const memTotal = formatBytes(data.memory.total);
  const diskUsed = formatBytes(data.disk.used);
  const diskTotal = formatBytes(data.disk.total);

  const html = `
    <div class="host-stats">
      <div class="host-stat-item" data-tooltip="CPU usage">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
          <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
          <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
          <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
        </svg>
        <span class="host-stat-label">CPU</span>
        <span class="host-stat-value">${cpuPercent}%</span>
      </div>

      <div class="host-stat-item" data-tooltip="Memory: ${memUsed} / ${memTotal}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="5" width="20" height="14" rx="2" ry="2"/>
          <line x1="7" y1="2" x2="7" y2="5"/><line x1="17" y1="2" x2="17" y2="5"/>
          <line x1="7" y1="19" x2="7" y2="22"/><line x1="17" y1="19" x2="17" y2="22"/>
        </svg>
        <span class="host-stat-label">RAM</span>
        <span class="host-stat-value">${memPercent}%</span>
      </div>

      <div class="host-stat-item" data-tooltip="Disk: ${diskUsed} / ${diskTotal}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="host-stat-label">Disk</span>
        <span class="host-stat-value">${diskPercent}%</span>
      </div>
    </div>
  `;

  container.innerHTML = html;
  container.classList.remove('hidden');
}

// Auto-refresh every 5 seconds
let hostStatsInterval = null;

export function startHostStatsRefresh() {
  updateHostStats(); // Initial fetch
  if (hostStatsInterval) clearInterval(hostStatsInterval);
  hostStatsInterval = setInterval(updateHostStats, 5000);
}

export function stopHostStatsRefresh() {
  if (hostStatsInterval) {
    clearInterval(hostStatsInterval);
    hostStatsInterval = null;
  }
}
