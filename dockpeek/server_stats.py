"""
Unified Server Statistics Collection

This module collects system resource statistics from multiple sources:
- Docker hosts (via psutil for local system metrics)
- Webdock VPS instances (via Webdock API)
- Future: Other VPS providers

The stats are normalized to a common format for display in the UI.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
import time

logger = logging.getLogger(__name__)


@dataclass
class ServerStats:
    """Normalized server statistics"""
    server_name: str
    source_type: str  # 'docker-host', 'webdock-vps', etc.

    # Memory (in bytes)
    memory_used: Optional[int] = None
    memory_total: Optional[int] = None
    memory_percent: Optional[float] = None

    # Disk (in bytes)
    disk_used: Optional[int] = None
    disk_total: Optional[int] = None
    disk_percent: Optional[float] = None

    # CPU
    cpu_count: Optional[int] = None
    cpu_percent: Optional[float] = None

    # Additional info
    status: str = "unknown"
    error: Optional[str] = None
    timestamp: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON response"""
        return {
            'server_name': self.server_name,
            'source_type': self.source_type,
            'memory': {
                'used': self.memory_used,
                'total': self.memory_total,
                'percent': round(self.memory_percent, 2) if self.memory_percent else None,
                'used_gb': round(self.memory_used / (1024**3), 2) if self.memory_used else None,
                'total_gb': round(self.memory_total / (1024**3), 2) if self.memory_total else None
            },
            'disk': {
                'used': self.disk_used,
                'total': self.disk_total,
                'percent': round(self.disk_percent, 2) if self.disk_percent else None,
                'used_gb': round(self.disk_used / (1024**3), 2) if self.disk_used else None,
                'total_gb': round(self.disk_total / (1024**3), 2) if self.disk_total else None
            },
            'cpu': {
                'count': self.cpu_count,
                'percent': round(self.cpu_percent, 2) if self.cpu_percent else None
            },
            'status': self.status,
            'error': self.error,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None
        }


class ServerStatsCollector:
    """
    Unified stats collector for different server types.

    Supports:
    - Docker hosts (using psutil)
    - Webdock VPS instances (using Webdock API)
    """

    def __init__(self, cache_ttl: int = 30):
        """
        Initialize stats collector.

        Args:
            cache_ttl: Cache time-to-live in seconds (default: 30)
        """
        self.cache_ttl = cache_ttl
        self._cache = {}
        self._cache_timestamps = {}
        self._lock = Lock()

        # Check if psutil is available
        self.psutil_available = False
        try:
            import psutil
            self.psutil_available = True
            logger.debug("psutil is available for system metrics")
        except ImportError:
            logger.info("psutil not available - Docker host stats will be limited")

    def _is_cache_valid(self, key: str) -> bool:
        """Check if cached data is still valid"""
        if key not in self._cache_timestamps:
            return False
        age = time.time() - self._cache_timestamps[key]
        return age < self.cache_ttl

    def _get_cached(self, key: str) -> Optional[ServerStats]:
        """Get cached stats if valid"""
        with self._lock:
            if self._is_cache_valid(key):
                return self._cache.get(key)
        return None

    def _set_cache(self, key: str, stats: ServerStats):
        """Cache stats"""
        with self._lock:
            self._cache[key] = stats
            self._cache_timestamps[key] = time.time()

    def get_docker_host_stats(self, server_name: str) -> ServerStats:
        """
        Get system stats for a Docker host.

        Uses psutil if available, otherwise returns limited info.

        Args:
            server_name: Name of the Docker host

        Returns:
            ServerStats object
        """
        cache_key = f"docker:{server_name}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        stats = ServerStats(
            server_name=server_name,
            source_type='docker-host',
            timestamp=datetime.now(),
            status='active'
        )

        if self.psutil_available:
            try:
                import psutil

                # Memory
                mem = psutil.virtual_memory()
                stats.memory_total = mem.total
                stats.memory_used = mem.used
                stats.memory_percent = mem.percent

                # Disk (root partition)
                disk = psutil.disk_usage('/')
                stats.disk_total = disk.total
                stats.disk_used = disk.used
                stats.disk_percent = disk.percent

                # CPU
                stats.cpu_count = psutil.cpu_count()
                stats.cpu_percent = psutil.cpu_percent(interval=0.1)

            except Exception as e:
                logger.error(f"Error collecting psutil stats for {server_name}: {e}")
                stats.error = str(e)
                stats.status = 'error'
        else:
            stats.error = "psutil not available"
            stats.status = 'limited'

        self._set_cache(cache_key, stats)
        return stats

    def get_webdock_vps_stats(self, server_slug: str, api_token: str) -> ServerStats:
        """
        Get stats for a Webdock VPS instance.

        Args:
            server_slug: Webdock server slug
            api_token: Webdock API token

        Returns:
            ServerStats object
        """
        cache_key = f"webdock:{server_slug}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        stats = ServerStats(
            server_name=server_slug,
            source_type='webdock-vps',
            timestamp=datetime.now()
        )

        try:
            from .webdock_client import WebdockAPIClient

            client = WebdockAPIClient(api_token)
            webdock_metrics = client.get_server_metrics(server_slug)

            if webdock_metrics:
                # Convert MiB to bytes
                MIB_TO_BYTES = 1024 * 1024

                # Memory
                if webdock_metrics.memory_used is not None:
                    stats.memory_used = webdock_metrics.memory_used * MIB_TO_BYTES
                if webdock_metrics.memory_total is not None:
                    stats.memory_total = webdock_metrics.memory_total * MIB_TO_BYTES
                stats.memory_percent = webdock_metrics.memory_percent

                # Disk
                if webdock_metrics.disk_used is not None:
                    stats.disk_used = webdock_metrics.disk_used * MIB_TO_BYTES
                if webdock_metrics.disk_total is not None:
                    stats.disk_total = webdock_metrics.disk_total * MIB_TO_BYTES
                stats.disk_percent = webdock_metrics.disk_percent

                # CPU
                stats.cpu_count = webdock_metrics.cpu_cores or webdock_metrics.cpu_threads

                # Status
                stats.status = webdock_metrics.status
            else:
                stats.error = "Failed to fetch Webdock metrics"
                stats.status = 'error'

        except Exception as e:
            logger.error(f"Error collecting Webdock stats for {server_slug}: {e}")
            stats.error = str(e)
            stats.status = 'error'

        self._set_cache(cache_key, stats)
        return stats

    def get_all_server_stats(self, docker_hosts: List[str],
                            webdock_servers: List[Dict[str, str]]) -> List[ServerStats]:
        """
        Get stats for all configured servers.

        Args:
            docker_hosts: List of Docker host names
            webdock_servers: List of dicts with 'slug' and 'api_token' keys

        Returns:
            List of ServerStats objects
        """
        all_stats = []

        # Collect Docker host stats
        for host_name in docker_hosts:
            try:
                stats = self.get_docker_host_stats(host_name)
                all_stats.append(stats)
            except Exception as e:
                logger.error(f"Failed to collect stats for Docker host {host_name}: {e}")

        # Collect Webdock VPS stats
        for server in webdock_servers:
            try:
                slug = server.get('slug')
                token = server.get('api_token')
                if slug and token:
                    stats = self.get_webdock_vps_stats(slug, token)
                    all_stats.append(stats)
            except Exception as e:
                logger.error(f"Failed to collect stats for Webdock server: {e}")

        return all_stats

    def invalidate_cache(self, server_name: Optional[str] = None):
        """
        Invalidate cache for a specific server or all servers.

        Args:
            server_name: Server to invalidate, or None for all
        """
        with self._lock:
            if server_name:
                # Invalidate specific server
                for key in list(self._cache.keys()):
                    if server_name in key:
                        del self._cache[key]
                        del self._cache_timestamps[key]
            else:
                # Invalidate all
                self._cache.clear()
                self._cache_timestamps.clear()


# Global instance (can be configured in app init)
_stats_collector = None


def get_stats_collector(cache_ttl: int = 30) -> ServerStatsCollector:
    """
    Get or create the global stats collector instance.

    Args:
        cache_ttl: Cache TTL in seconds

    Returns:
        ServerStatsCollector instance
    """
    global _stats_collector
    if _stats_collector is None:
        _stats_collector = ServerStatsCollector(cache_ttl=cache_ttl)
    return _stats_collector


def parse_webdock_config_from_env() -> List[Dict[str, str]]:
    """
    Parse Webdock server configuration from environment variables.

    Expected format:
    - WEBDOCK_API_TOKEN_1=token1
    - WEBDOCK_SERVER_SLUG_1=server1

    - WEBDOCK_API_TOKEN_2=token2
    - WEBDOCK_SERVER_SLUG_2=server2

    Returns:
        List of dicts with 'slug' and 'api_token' keys
    """
    webdock_servers = []
    index = 1

    while True:
        token = os.environ.get(f'WEBDOCK_API_TOKEN_{index}')
        slug = os.environ.get(f'WEBDOCK_SERVER_SLUG_{index}')

        if not token or not slug:
            break

        webdock_servers.append({
            'slug': slug,
            'api_token': token
        })
        index += 1

    if webdock_servers:
        logger.info(f"Loaded {len(webdock_servers)} Webdock server(s) from environment")

    return webdock_servers
