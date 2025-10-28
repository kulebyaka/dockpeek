"""
Webdock API Client for fetching VPS server metrics.

This module provides a client for interacting with the Webdock API
to retrieve server information and real-time metrics (RAM, disk, CPU, etc.).

API Documentation: https://api.webdock.io/v1
"""

import logging
import requests
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


@dataclass
class WebdockServerMetrics:
    """Server metrics from Webdock API"""
    server_slug: str
    server_name: str

    # Memory metrics (in MiB)
    memory_used: Optional[int] = None
    memory_total: Optional[int] = None
    memory_percent: Optional[float] = None

    # Disk metrics (in MiB)
    disk_used: Optional[int] = None
    disk_total: Optional[int] = None
    disk_percent: Optional[float] = None

    # CPU metrics
    cpu_cores: Optional[int] = None
    cpu_threads: Optional[int] = None
    cpu_usage_seconds: Optional[int] = None

    # Network metrics (in GiB)
    network_used: Optional[int] = None
    network_allowed: Optional[int] = None

    # Process count
    processes: Optional[int] = None

    # Server status
    status: str = "unknown"
    ipv4: Optional[str] = None
    location: Optional[str] = None

    # Timestamp
    timestamp: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'server_slug': self.server_slug,
            'server_name': self.server_name,
            'memory_used': self.memory_used,
            'memory_total': self.memory_total,
            'memory_percent': self.memory_percent,
            'disk_used': self.disk_used,
            'disk_total': self.disk_total,
            'disk_percent': self.disk_percent,
            'cpu_cores': self.cpu_cores,
            'cpu_threads': self.cpu_threads,
            'cpu_usage_seconds': self.cpu_usage_seconds,
            'network_used': self.network_used,
            'network_allowed': self.network_allowed,
            'processes': self.processes,
            'status': self.status,
            'ipv4': self.ipv4,
            'location': self.location,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None
        }


class WebdockAPIClient:
    """
    Client for Webdock API v1.

    Usage:
        client = WebdockAPIClient(api_token="your-token-here")
        servers = client.get_servers()
        metrics = client.get_server_metrics("my-server-slug")
    """

    BASE_URL = "https://api.webdock.io/v1"

    def __init__(self, api_token: str, timeout: float = 10.0):
        """
        Initialize Webdock API client.

        Args:
            api_token: Your Webdock API token
            timeout: Request timeout in seconds
        """
        self.api_token = api_token
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json',
            'X-Application': 'Dockpeek/v1.0'
        })

        # Rate limit tracking (5000 requests per hour)
        self._rate_limit_remaining = 5000
        self._rate_limit_reset = None

    def _make_request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict]:
        """
        Make a request to the Webdock API.

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., '/servers')
            **kwargs: Additional arguments for requests

        Returns:
            Response JSON or None if error
        """
        url = f"{self.BASE_URL}{endpoint}"

        try:
            response = self.session.request(
                method=method,
                url=url,
                timeout=self.timeout,
                **kwargs
            )

            # Update rate limit info from headers
            if 'X-RateLimit-Remaining' in response.headers:
                self._rate_limit_remaining = int(response.headers['X-RateLimit-Remaining'])
            if 'X-RateLimit-Reset' in response.headers:
                self._rate_limit_reset = datetime.fromtimestamp(
                    int(response.headers['X-RateLimit-Reset'])
                )

            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            logger.error(f"Webdock API HTTP error: {e}")
            if hasattr(e.response, 'text'):
                logger.debug(f"Response body: {e.response.text}")
            return None
        except requests.exceptions.RequestException as e:
            logger.error(f"Webdock API request error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error calling Webdock API: {e}")
            return None

    def ping(self) -> bool:
        """
        Test API connectivity and authentication.

        Returns:
            True if ping successful, False otherwise
        """
        result = self._make_request('GET', '/ping')
        return result is not None and result.get('webdock') == 'rocks'

    def get_servers(self, status: str = 'active') -> List[Dict]:
        """
        Get list of servers in your Webdock account.

        Args:
            status: Filter by status ('all', 'active', 'suspended')

        Returns:
            List of server dictionaries
        """
        result = self._make_request('GET', '/servers', params={'status': status})
        return result if result else []

    def get_server(self, server_slug: str) -> Optional[Dict]:
        """
        Get details for a specific server.

        Args:
            server_slug: Server slug (shortname)

        Returns:
            Server details or None if not found
        """
        return self._make_request('GET', f'/servers/{server_slug}')

    def get_server_profile(self, profile_slug: str) -> Optional[Dict]:
        """
        Get server hardware profile information.

        Args:
            profile_slug: Profile slug

        Returns:
            Profile details including RAM and disk totals
        """
        result = self._make_request('GET', '/profiles', params={'profileSlug': profile_slug})
        return result if result and len(result) > 0 else None

    def get_instant_metrics(self, server_slug: str) -> Optional[Dict]:
        """
        Get instant (real-time) metrics for a server.

        Args:
            server_slug: Server slug (shortname)

        Returns:
            Metrics including memory, disk, CPU, network, processes
        """
        return self._make_request('GET', f'/servers/{server_slug}/metrics/now')

    def get_server_metrics(self, server_slug: str) -> Optional[WebdockServerMetrics]:
        """
        Get complete server metrics including profile info.

        This method combines data from multiple endpoints:
        - Server details (/servers/{slug})
        - Server profile (/profiles)
        - Instant metrics (/servers/{slug}/metrics/now)

        Args:
            server_slug: Server slug (shortname)

        Returns:
            WebdockServerMetrics object or None if error
        """
        # Get server details
        server = self.get_server(server_slug)
        if not server:
            logger.warning(f"Could not fetch server details for {server_slug}")
            return None

        # Get profile to get total RAM/disk
        profile = None
        if server.get('profile'):
            profile = self.get_server_profile(server['profile'])

        # Get instant metrics
        instant = self.get_instant_metrics(server_slug)

        # Create metrics object
        metrics = WebdockServerMetrics(
            server_slug=server_slug,
            server_name=server.get('name', server_slug),
            status=server.get('status', 'unknown'),
            ipv4=server.get('ipv4'),
            location=server.get('location'),
            timestamp=datetime.now()
        )

        # Add profile data (totals)
        if profile:
            metrics.memory_total = profile.get('ram')  # in MiB
            metrics.disk_total = profile.get('disk')  # in MiB
            cpu_info = profile.get('cpu', {})
            metrics.cpu_cores = cpu_info.get('cores')
            metrics.cpu_threads = cpu_info.get('threads')

        # Add instant metrics (usage)
        if instant:
            # Memory
            memory = instant.get('memory', {})
            memory_sampling = memory.get('latestUsageSampling', {})
            if memory_sampling:
                metrics.memory_used = memory_sampling.get('amount')  # in MiB
                if metrics.memory_total and metrics.memory_used:
                    metrics.memory_percent = (metrics.memory_used / metrics.memory_total) * 100

            # Disk
            disk = instant.get('disk', {})
            metrics.disk_total = disk.get('allowed')  # in MiB (overrides profile if available)
            disk_sampling = disk.get('lastSamplings', {})
            if disk_sampling:
                metrics.disk_used = disk_sampling.get('amount')  # in MiB
                if metrics.disk_total and metrics.disk_used:
                    metrics.disk_percent = (metrics.disk_used / metrics.disk_total) * 100

            # CPU
            cpu = instant.get('cpu', {})
            cpu_sampling = cpu.get('latestUsageSampling', {})
            if cpu_sampling:
                metrics.cpu_usage_seconds = cpu_sampling.get('amount')

            # Network
            network = instant.get('network', {})
            metrics.network_used = network.get('total')  # in GiB
            metrics.network_allowed = network.get('allowed')  # in GiB

            # Processes
            processes = instant.get('processes', {})
            processes_sampling = processes.get('latestProcessesSampling', {})
            if processes_sampling:
                metrics.processes = processes_sampling.get('amount')

        return metrics

    def get_all_server_metrics(self) -> List[WebdockServerMetrics]:
        """
        Get metrics for all active servers.

        Returns:
            List of WebdockServerMetrics objects
        """
        servers = self.get_servers(status='active')
        metrics_list = []

        for server in servers:
            slug = server.get('slug')
            if slug:
                metrics = self.get_server_metrics(slug)
                if metrics:
                    metrics_list.append(metrics)

        return metrics_list

    def get_rate_limit_info(self) -> Dict[str, Any]:
        """
        Get current rate limit information.

        Returns:
            Dictionary with remaining requests and reset time
        """
        return {
            'remaining': self._rate_limit_remaining,
            'reset': self._rate_limit_reset.isoformat() if self._rate_limit_reset else None,
            'limit': 5000
        }

    def __del__(self):
        """Close session on cleanup"""
        if hasattr(self, 'session'):
            self.session.close()
