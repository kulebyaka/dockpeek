# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dockpeek is a lightweight, self-hosted Docker dashboard built with Flask. It provides quick access to Docker containers with features like one-click web access, automatic port mapping, live logs, Traefik integration, multi-host management, and image update checks. The application supports both standalone Docker and Docker Swarm deployments.

## Architecture

### Application Structure

- **Flask Application Factory Pattern**: The app is initialized in `dockpeek/__init__.py` using `create_app()` function
- **Blueprints**: Two main blueprints - `auth_bp` (authentication) and `main_bp` (core functionality)
- **Entry Point**: `run.py` creates the app instance and handles proxy configuration via ProxyFix
- **Server**: Production deployment uses Gunicorn with gevent workers (configured in `gunicorn.conf.py`)

### Core Modules

#### `docker_utils.py` - Docker Client Management
- **DockerClientDiscovery**: Multi-threaded discovery of Docker hosts with connection pooling and 30s caching
- **DockerClientFactory**: Creates Docker clients with configurable timeouts (short for listing, long for operations)
- **HostnameExtractor**: Intelligently extracts usable hostnames from Docker API URLs
- **LinkHostnameResolver**: Resolves the correct hostname for generating container port links
- **ContainerStatusExtractor**: Gets container status with health checks and exit codes with timeout protection

#### `get_data.py` - Data Processing Engine
- **Multi-host Processing**: Uses ThreadPoolExecutor to process multiple Docker hosts in parallel (30s timeout per host)
- **Container vs Swarm**: Automatically detects Swarm mode and switches between container and service APIs
- **Port Handling**: Extracts published ports, custom ports (from `dockpeek.ports` label), and generates clickable links with HTTP/HTTPS detection
- **Traefik Integration**: Parses Traefik router labels to extract service URLs with TLS detection
- **Update Checking**: Integrates with update cache to show available updates without re-checking

#### `main.py` - API Routes
- **Data Endpoints**: `/data` returns all container/service info, `/health` for health checks
- **Update Operations**: `/check-updates` (bulk), `/check-single-update`, `/cancel-updates`, `/update-container`
- **Image Pruning**: `/get-prune-info`, `/prune-images` to clean unused images (skips pending updates)
- **Log Streaming**: `/get-container-logs` (one-time), `/stream-container-logs` (SSE streaming with gevent)
- **Export**: `/export/json` for container data export
- **Authentication**: Uses `conditional_login_required` decorator that respects `DISABLE_AUTH` setting

#### `update_manager.py` & `update.py`
- **Update Checking**: Compares local vs remote image digests to detect updates
- **Floating Tags**: Supports checking `latest`, `major`, or `minor` version tags (e.g., `8.2.2` → `8` or `8.2`)
- **Update Process**: Pulls new image, recreates container with same config (env vars, volumes, networks, etc.)
- **Swarm Handling**: Update checks are disabled for Swarm services (returns `False`)

#### `logs_manager.py`
- Handles both container logs (`get_container_logs`, `stream_container_logs`) and Swarm service logs
- Streaming uses generators for real-time log delivery

#### `auth.py`
- Simple username/password authentication using Flask-Login
- Session-based auth with 14-day persistent sessions
- Can be disabled globally with `DISABLE_AUTH=true`

### Frontend

- **Single Page Application**: `templates/index.html` contains all UI logic with vanilla JavaScript
- **Styling**: TailwindCSS v4 compiled from `static/css/styles.css` to `static/css/tailwindcss.css`
- **Real-time Updates**: Polls `/data` endpoint periodically to refresh container states
- **Search Features**: Container search, port search (`:8080`), and free port finder (`:free` or `:free 3420`)

## Development Workflow

### Build CSS
```bash
npm run build:css
```
This compiles TailwindCSS. **Never edit `tailwindcss.css` directly** - always edit `styles.css` and rebuild.

### Run Locally with Docker Compose
```bash
cd deploy
docker-compose up -d --build
```
Access at `http://localhost:3420` (default credentials: `admin/admin`)

### Update and Rebuild
```bash
git pull origin main  # or 'develop' for development branch
npm install           # update dependencies if needed
npm run build:css
cd deploy
docker-compose up -d --build
```

### Environment Configuration
Required variables:
- `SECRET_KEY` - Always required for Flask session security
- `USERNAME` and `PASSWORD` - Required unless `DISABLE_AUTH=true`

Optional variables (see README.md for full list):
- `PORT` (default: 8000)
- `DOCKER_HOST` - Primary Docker connection
- `DOCKER_HOST_NAME` - Display name (auto-detected from Docker API if not set)
- `DOCKER_HOST_N_URL` / `DOCKER_HOST_N_NAME` - For multi-host setups (N = 1, 2, 3, ...)
- `DOCKER_CONNECTION_TIMEOUT` (default: 0.5s)
- `UPDATE_FLOATING_TAGS` - `latest`, `major`, `minor`, or `disabled` (default)
- `TRAEFIK_LABELS` (default: true)
- `TAGS` (default: true)
- `PORT_RANGE_GROUPING` (default: true)
- `PORT_RANGE_THRESHOLD` (default: 5)
- `TRUST_PROXY_HEADERS` (default: false)
- `LOG_LEVEL` (default: INFO)

## Key Implementation Details

### Multi-Host Discovery
- Env vars parsed by `EnvironmentConfigParser` (`DOCKER_HOST`, `DOCKER_HOST_N_URL`)
- Parallel connection testing with ThreadPoolExecutor (10s discovery timeout)
- Results cached for 30s in `DockerClientDiscovery`
- Inactive hosts shown in UI but don't block other hosts

### Port Range Grouping
- Consecutive ports (e.g., 601-606) are grouped if count ≥ `PORT_RANGE_THRESHOLD`
- Global setting via `PORT_RANGE_GROUPING` env var
- Per-container override via `dockpeek.port-range-grouping` label

### Update Checking
- Uses image digest comparison (not just tags)
- Caching mechanism to avoid redundant registry queries
- Can be cancelled mid-operation via `/cancel-updates`
- Swarm services return `False` (updates not supported)

### Log Streaming
- Uses gevent for async I/O with SSE (Server-Sent Events)
- 20-second heartbeat to keep connection alive
- Handles both container and Swarm service logs
- Automatically cleans up streaming client on disconnect

### Traefik Label Parsing
- Extracts `Host()` rules from `traefik.http.routers.*.rule` labels
- Detects HTTPS via TLS labels or entrypoint names (websecure, https, 443, ssl, tls)
- Supports `PathPrefix()` for subpath routing

## Container Labels Reference

Dockpeek recognizes these labels:
- `dockpeek.ports` - Add custom ports (comma-separated)
- `dockpeek.https` - Force HTTPS for specific ports
- `dockpeek.link` - Custom clickable link for container name
- `dockpeek.tags` - Organize containers with tags
- `dockpeek.port-range-grouping` - Override global port grouping setting (`true`/`false`)

Standard labels used:
- `com.docker.compose.project` / `com.docker.stack.namespace` - Stack name
- `org.opencontainers.image.source` / `org.opencontainers.image.url` - Source URL
- `traefik.enable`, `traefik.http.routers.*` - Traefik routing

## Common Patterns

### Adding a New API Endpoint
1. Add route to `dockpeek/main.py` in `main_bp` blueprint
2. Use `@conditional_login_required` decorator for protected endpoints
3. Return JSON via `jsonify()` with appropriate status code
4. Use `current_app.logger` for logging
5. Handle exceptions and return error JSON with 4xx/5xx status

### Working with Docker Clients
- Always get clients via `discover_docker_clients()` to use cached connections
- Use `client.containers.list(all=True)` for all containers (not just running)
- Check if Swarm mode is active: `info.get('Swarm', {}).get('LocalNodeState', '').lower() == 'active'`
- For long operations (update, prune), create a new client with longer timeout via `DockerClientFactory`

### Handling Multi-Host Operations
- Filter by `server_name` when provided, otherwise iterate all active servers
- Always check `status == 'active'` before using a client
- Use ThreadPoolExecutor for parallel processing across hosts
- Set reasonable timeouts (typically 30s per host, 10s for discovery)

## Testing Considerations

When testing Dockpeek:
- Ensure Docker socket is accessible (`/var/run/docker.sock`)
- Test with both standalone Docker and Swarm mode
- Test multi-host with socket proxies (tecnativa/docker-socket-proxy or linuxserver/socket-proxy)
- Verify Traefik label parsing with various router configurations
- Test update flow with containers using different tagging strategies (latest, semver, alpine variants)
- Test port range grouping with containers exposing many consecutive ports
