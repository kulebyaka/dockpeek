export const DEFAULT_COLUMN_ORDER = ['name', 'stack', 'server', 'ports', 'traefik', 'image', 'tags', 'ram', 'disk', 'logs', 'status'];

export const state = {
  allContainersData: [],
  allServersData: [],
  serverStatusCache: {
    data: null,
    timestamp: 0,
    ttl: 30000
  },
  filteredAndSortedContainers: [],
  swarmServers: [],
  pruneInfoCache: null,
  currentSortColumn: "name",
  currentSortDirection: "asc",
  currentServerFilter: "all",
  isDataLoaded: false,
  isCheckingForUpdates: false,
  updateCheckController: null,
  columnOrder: [...DEFAULT_COLUMN_ORDER],
  columnVisibility: {
    name: true,
    server: true,
    stack: true,
    image: true,
    tags: true,
    status: true,
    ports: true,
    traefik: true,
    ram: true,
    disk: true,
    logs: true
  }
};
