# Webdock VPS Integration - Proof of Concept

This proof-of-concept demonstrates integrating **Webdock VPS monitoring** into Dockpeek, enabling you to monitor both Docker containers AND the underlying VPS infrastructure from a single dashboard.

## What's Included

### 1. Core Implementation Files

| File | Purpose |
|------|---------|
| `dockpeek/webdock_client.py` | Full-featured Webdock API v1 client |
| `dockpeek/server_stats.py` | Unified stats collector (Docker + Webdock) |
| `dockpeek/main.py` | New `/server-stats` API endpoint |

### 2. Configuration & Examples

| File | Purpose |
|------|---------|
| `docker-compose-webdock-integration.yml` | Example Docker Compose configuration |
| `demo_webdock_integration.py` | Interactive demo script |
| `WEBDOCK_INTEGRATION_README.md` | This file |

### 3. Documentation

| File | Purpose |
|------|---------|
| `FOOTER_STATS_FEASIBILITY.md` | Complete feasibility analysis + Webdock addendum |
| `requirements.txt` | Updated with `requests` and `psutil` |

## Quick Start

### 1. Install Dependencies

```bash
pip install requests psutil
```

### 2. Get Your Webdock API Token

1. Go to https://app.webdock.io/account/access-tokens
2. Create a new token with `read:servers` permission
3. Copy the token and your server slug

### 3. Run the Demo

```bash
# Set environment variables
export WEBDOCK_API_TOKEN_1=your_api_token_here
export WEBDOCK_SERVER_SLUG_1=your-server-slug

# Run the demo script
python demo_webdock_integration.py --combined
```

## What the Demo Shows

The demo script demonstrates:

1. **API Connection Test** - Verifies authentication
2. **Server List** - Shows all servers in your account
3. **Server Details** - Name, status, IP, location, profile
4. **Hardware Profile** - RAM, disk, CPU specs
5. **Instant Metrics** - Real-time usage data
6. **Combined Stats** - Normalized format for display
7. **JSON Format** - Ready for API consumption

## Configuration for Production

### Using Docker Compose

```yaml
services:
  dockpeek:
    image: dockpeek/dockpeek:latest
    environment:
      - SECRET_KEY=your_secret_key
      - USERNAME=admin
      - PASSWORD=admin

      # Enable server stats
      - SHOW_SERVER_STATS=true

      # Webdock VPS Integration
      - WEBDOCK_API_TOKEN_1=your_api_token
      - WEBDOCK_SERVER_SLUG_1=prod-server

      # Optional: Monitor additional Webdock servers
      - WEBDOCK_API_TOKEN_2=another_token
      - WEBDOCK_SERVER_SLUG_2=staging-server

    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "3420:8000"
```

## API Endpoint

### GET `/server-stats`

Returns system resource statistics for all configured servers.

**Response Format:**

```json
{
  "stats": [
    {
      "server_name": "Main Docker Host",
      "source_type": "docker-host",
      "memory": {
        "used_gb": 18.5,
        "total_gb": 32.0,
        "percent": 57.8
      },
      "disk": {
        "used_gb": 450.2,
        "total_gb": 1000.0,
        "percent": 45.0
      },
      "cpu": {
        "count": 16,
        "percent": 23.4
      },
      "status": "active"
    },
    {
      "server_name": "production-vps",
      "source_type": "webdock-vps",
      "memory": {
        "used_gb": 3.2,
        "total_gb": 4.0,
        "percent": 80.0
      },
      "disk": {
        "used_gb": 28.5,
        "total_gb": 80.0,
        "percent": 35.6
      },
      "cpu": {
        "count": 2
      },
      "status": "running"
    }
  ],
  "timestamp": "2025-10-28T10:30:00Z",
  "count": 2
}
```

## Features

### ✅ Implemented

- [x] Webdock API client with full error handling
- [x] Unified stats collection (Docker + Webdock)
- [x] 30-second caching to minimize API calls
- [x] Rate limit tracking and management
- [x] Graceful fallback if psutil unavailable
- [x] Normalized data format (bytes, percentages)
- [x] Production-ready error handling
- [x] Environment-based configuration
- [x] Demo script for testing

### 🔄 Frontend Integration Needed

- [ ] Display stats in footer UI
- [ ] Color-coded usage indicators (green/yellow/red)
- [ ] Real-time updates (polling every 30s)
- [ ] Toggle to show/hide stats
- [ ] Hover tooltips with details

## Architecture

```
┌─────────────────┐
│  Frontend (JS)  │
│   - Footer UI   │
│   - Stats       │
│   - Graphs      │
└────────┬────────┘
         │
         │ GET /server-stats
         ↓
┌─────────────────────────────────┐
│  Backend (main.py)              │
│  - /server-stats endpoint       │
│  - Authentication               │
│  - Response formatting          │
└────────┬────────────────────────┘
         │
         ↓
┌─────────────────────────────────┐
│  ServerStatsCollector           │
│  - Unified stats collection     │
│  - 30s caching                  │
│  - Multi-source support         │
└─────┬─────────────────┬─────────┘
      │                 │
      ↓                 ↓
┌─────────────┐   ┌───────────────┐
│   psutil    │   │ WebdockAPI    │
│ (optional)  │   │    Client     │
│             │   │               │
│ Local sys   │   │ Webdock API   │
│ metrics     │   │ metrics       │
└─────────────┘   └───────────────┘
```

## Performance

### Caching

- Stats are cached for 30 seconds
- Reduces API calls from 120/min to 2/min per server
- Cache is shared across all requests
- Thread-safe implementation

### API Rate Limits

- Webdock: 5000 requests/hour per account
- With 30s cache: ~120 requests/hour per server
- Comfortably supports 40+ servers

### Dependencies Size

- `requests`: ~350 KB
- `psutil`: ~1.5 MB
- Total overhead: ~2 MB

## Security

### Best Practices

1. **Never commit API tokens**
   ```bash
   # Use environment variables
   export WEBDOCK_API_TOKEN_1=your_token

   # Or use .env file (add to .gitignore)
   echo "WEBDOCK_API_TOKEN_1=your_token" >> .env
   ```

2. **Limit token permissions**
   - Only grant `read:servers` permission
   - Create separate tokens for different environments

3. **Use Docker secrets in production**
   ```bash
   echo "your_token" | docker secret create webdock_token -
   docker service create \
     --secret webdock_token \
     --env WEBDOCK_API_TOKEN_1_FILE=/run/secrets/webdock_token \
     dockpeek/dockpeek
   ```

## Troubleshooting

### API Connection Issues

```bash
# Test API connectivity
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.webdock.io/v1/ping
```

Expected response: `{"webdock":"rocks"}`

### Rate Limit Errors

If you see rate limit errors:
1. Check current limit: `X-RateLimit-Remaining` header
2. Wait until: `X-RateLimit-Reset` timestamp
3. Increase cache TTL to 60s

### Missing Metrics

If metrics are not showing:
1. Verify token has `read:servers` permission
2. Check server slug is correct
3. Ensure server is in "running" status
4. Review logs for API errors

## Example Output

Running the demo script with valid credentials:

```
================================================================================
WEBDOCK API CLIENT DEMO
================================================================================

1. Testing API connection...
   ✓ API connection successful!

2. Fetching all servers...
   Found 2 server(s):
     - Production Server (prod-app) - running
     - Staging Server (staging-app) - running

3. Fetching details for server 'prod-app'...
   Server: Production Server
   Status: running
   IPv4: 203.0.113.10
   Location: ams1
   Profile: 4gb-2cpu-80gb-ssd
   Image: ubuntu-22.04-x86_64-lts

4. Fetching profile details...
   Profile: 4 GB / 2 CPU / 80 GB SSD
   RAM: 4096 MiB (4.0 GB)
   Disk: 81920 MiB (80.0 GB)
   CPU: 2 cores / 2 threads

5. Fetching instant metrics...

   MEMORY:
     Used: 3276 MiB (3.20 GB)

   DISK:
     Used: 29184 MiB (28.5 GB)
     Total: 81920 MiB (80.0 GB)
     Usage: 35.6%

   NETWORK:
     Used this month: 42 GiB
     Allowed: 1000 GiB

   PROCESSES:
     Count: 127

6. Fetching combined metrics (all-in-one)...

   Server: Production Server (prod-app)
   Status: running

   Memory: 3.20 GB / 4.00 GB (80.0%)
   Disk: 28.50 GB / 80.00 GB (35.6%)
   CPU: 2 cores

   Timestamp: 2025-10-28 10:30:00

7. Rate limit info:
   Remaining: 4992/5000
   Resets at: 2025-10-28T11:00:00Z
```

## Next Steps

To integrate this into the Dockpeek UI:

1. **Backend** (Already complete ✅)
   - API endpoint ready at `/server-stats`
   - Supports both Docker and Webdock sources
   - Proper caching and error handling

2. **Frontend** (Needs implementation)
   - Add footer section for stats display
   - Poll `/server-stats` every 30 seconds
   - Color-code based on usage thresholds
   - Add toggle to show/hide stats

3. **Testing**
   - Unit tests for API client
   - Integration tests with mock API
   - Load testing with multiple servers

4. **Documentation**
   - Update main README
   - Add setup guide
   - Create troubleshooting section

## Support

For issues or questions:

1. Check the Webdock API docs: https://api.webdock.io/v1
2. Review `FOOTER_STATS_FEASIBILITY.md` for detailed analysis
3. Run the demo script to verify setup
4. Check Dockpeek logs for error messages

## License

This integration follows Dockpeek's license. The Webdock API client is open source and can be used independently in other projects.
