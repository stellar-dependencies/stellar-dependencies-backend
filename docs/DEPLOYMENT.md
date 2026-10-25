# Deployment Guide

This document describes how to deploy the **DependencyLens API** as a standalone service. The project uses a split architecture: the API (this repository) runs independently from the frontend, which is hosted separately. This guide is written so a new operator can deploy the API from this document alone.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Quickstart: Docker](#quickstart-docker)
4. [Quickstart: Without Docker](#quickstart-without-docker)
5. [Environment Variables](#environment-variables)
6. [CORS Configuration](#cors-configuration)
7. [Proxy Settings](#proxy-settings)
8. [Rate Limiting](#rate-limiting)
9. [TLS Termination & Reverse Proxy](#tls-termination--reverse-proxy)
10. [Frontend Hosting](#frontend-hosting)
11. [Docker Build Notes](#docker-build-notes)
12. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The application is split into two independently deployable pieces:

- **API (this repository)** — a Node.js service that exposes the HTTP API. It can be deployed on any host that runs Node.js or Docker.
- **Frontend (separate repository)** — a static/SPA client served from its own origin. It calls the API over HTTP(S) using the API's public base URL.

Because the frontend and API are served from **different origins**, the API must be configured to accept cross-origin requests from the frontend's origin (see [CORS Configuration](#cors-configuration)). TLS is typically terminated at a reverse proxy in front of the API (see [TLS Termination & Reverse Proxy](#tls-termination--reverse-proxy)).

---

## Prerequisites

- **Docker path:** Docker Engine 20.10+ (or any recent Docker Desktop).
- **Non-Docker path:** Node.js 18+ and npm.
- Network access to GitHub's API if you enable authenticated GitHub requests (see `GITHUB_TOKEN`).
- A domain name and TLS certificate (or a proxy like Caddy that provisions certificates automatically) for production.

---

## Quickstart: Docker

Build the image from the repository root:

```bash
docker build -t dependencylens-backend .
```

Run the container, binding the API to all interfaces inside the container and exposing port `3000`:

```bash
docker run -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  dependencylens-backend
```

The API is now reachable at `http://localhost:3000`.

To pass additional configuration (CORS origins, GitHub token, proxy and rate-limit settings), add more `-e` flags or use an env file:

```bash
docker run -p 3000:3000 \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  dependencylens-backend
```

> **Note:** Inside a container you must set `HOST=0.0.0.0` so the process listens on all interfaces. Binding to `127.0.0.1` inside the container makes the service unreachable from outside the container.

---

## Quickstart: Without Docker

Install dependencies and start the service:

```bash
npm install
HOST=0.0.0.0 PORT=3000 npm start
```

Or export the variables first:

```bash
export HOST=0.0.0.0
export PORT=3000
npm start
```

For production, run the process under a supervisor (systemd, pm2, etc.) so it restarts on failure, and put a reverse proxy in front of it for TLS (see below).

---

## Environment Variables

The following variables are read by the API. They mirror the entries in `.env.example`; copy that file to `.env` and adjust as needed.

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface the HTTP server binds to. Use `0.0.0.0` in containers or when a reverse proxy on another host/interface must reach it. |
| `PORT` | `3000` | TCP port the HTTP server listens on. |
| `GITHUB_TOKEN` | _(unset)_ | Optional GitHub personal access token used to authenticate outbound GitHub API requests. Raises rate limits and enables access to private data where permitted. Leave unset for anonymous access. |
| `CORS_ORIGINS` | _(unset)_ | Comma-separated list of allowed frontend origins, e.g. `https://app.example.com,https://staging.example.com`. When unset, cross-origin browser requests are rejected. See [CORS Configuration](#cors-configuration). |
| `TRUST_PROXY` | `false` | Whether to trust `X-Forwarded-*` headers from a reverse proxy. Set to `true` (or a hop count / subnet list, depending on your proxy setup) when running behind nginx, Caddy, or a cloud load balancer. See [Proxy Settings](#proxy-settings). |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Length of the rate-limit window in milliseconds. |
| `RATE_LIMIT_MAX` | `100` | Maximum number of requests allowed per client per window. |
| `RATE_LIMIT_ENABLED` | `true` | Enable or disable rate limiting (`true`/`false`). |

> **Tip:** Keep secrets such as `GITHUB_TOKEN` out of source control. Provide them via your platform's secret manager or an env file that is not committed.

---

## CORS Configuration

Since the frontend is served from a **different origin** than the API, browsers will send cross-origin requests that the API must explicitly allow.

Set `CORS_ORIGINS` to the exact origin(s) of your deployed frontend(s), including scheme and (if non-default) port. Origins are comma-separated:

```bash
CORS_ORIGINS=https://app.example.com,https://staging.example.com
```

Guidance:

- Use the **origin only** (scheme + host + port) — do **not** include a path or trailing slash.
- `https://app.example.com` and `http://app.example.com` are different origins; list each one you need.
- For local development, add your dev server origin, e.g. `http://localhost:5173`.
- If `CORS_ORIGINS` is unset, cross-origin browser requests will be rejected. Same-origin requests (e.g. from `curl` or server-to-server) are unaffected.
- Avoid wildcards in production; enumerate the exact origins.

---

## Proxy Settings

When the API runs behind a reverse proxy or load balancer, the client's real IP and protocol arrive in forwarded headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`). Set `TRUST_PROXY` so the API reads them correctly — this matters for accurate client IPs in rate limiting and for generating correct absolute URLs.

```bash
TRUST_PROXY=true
```

- Set `TRUST_PROXY=true` when exactly one trusted proxy sits in front of the API (the common case).
- If your proxy setup has multiple hops, or you want to restrict trust to specific addresses, set `TRUST_PROXY` to a hop count or a comma-separated list of trusted subnets, depending on your platform's conventions.
- Leave `TRUST_PROXY` unset/`false` when the API is directly exposed to the internet, so clients cannot spoof their IP via forwarded headers.

Make sure your reverse proxy actually sets these headers (see the examples below).

---

## Rate Limiting

Rate limiting is enabled by default and applies per client (per IP, resolved using the proxy settings above). Configure it with:

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_ENABLED` | `true` | Set to `false` to disable rate limiting entirely. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window length in milliseconds (default: one minute). |
| `RATE_LIMIT_MAX` | `100` | Max requests per client per window. |

Example — allow 300 requests per client per 5 minutes:

```bash
RATE_LIMIT_WINDOW_MS=300000
RATE_LIMIT_MAX=300
```

Notes:

- If you terminate TLS at a proxy, ensure `TRUST_PROXY` is set so rate limiting keys on the real client IP rather than the proxy's IP.
- If you also rate-limit at the proxy or CDN layer, keep the API limits as a backstop.

---

## TLS Termination & Reverse Proxy

In production, terminate TLS at a reverse proxy in front of the API and forward plain HTTP to the API on `HOST`/`PORT`. The proxy must set the forwarded headers so the API can determine the client IP and original scheme.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;
    }
}

# Optional: redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

With this setup, run the API with `TRUST_PROXY=true` and `HOST=127.0.0.1` (or `0.0.0.0` if nginx is in a separate container/host).

### Caddy

Caddy provisions and renews TLS certificates automatically:

```caddyfile
api.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host  {host}
    }
}
```

Caddy sets `X-Forwarded-For` and `X-Forwarded-Proto` by default; the explicit `header_up` lines above make the intent clear. Run the API with `TRUST_PROXY=true`.

### General guidance

- Terminate TLS at the proxy; keep the API on plain HTTP behind it.
- Always forward `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host`, and set `TRUST_PROXY` accordingly.
- Keep the API port (`3000` by default) bound to a private interface or localhost so it is not directly reachable from the internet.
- Use HSTS and modern TLS settings at the proxy where appropriate.

---

## Frontend Hosting

The frontend is deployed separately from the API. For instructions on building and hosting the frontend, and for configuring it to point at this API's public URL, see the hosting notes in the frontend repository:

- **stellar-dependencies-frontend** — see its `docs/HOSTING.md` (hosting notes) in the [stellar-dependencies-frontend](https://github.com/stellar-dependencies/stellar-dependencies-frontend) repository.

When you deploy the frontend, make sure:

1. The frontend is configured with this API's public base URL (e.g. `https://api.example.com`).
2. The frontend's origin is listed in this API's `CORS_ORIGINS`.

---

## Docker Build Notes

- The image is built with `docker build -t dependencylens-backend .` from the repository root.
- `.dockerignore` excludes `docs/` and `test/` from the build context, keeping the image small and the build fast. Documentation and test files are therefore **not** present inside the image — this is expected.
- Set `HOST=0.0.0.0` when running in a container so the service is reachable from outside the container.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Browser requests blocked with a CORS error | Frontend origin not in `CORS_ORIGINS` | Add the exact frontend origin (scheme + host + port) to `CORS_ORIGINS`. |
| Rate limiting triggers for all clients at once | `TRUST_PROXY` not set behind a proxy | Set `TRUST_PROXY=true` and ensure the proxy forwards `X-Forwarded-For`. |
| API unreachable from outside the container | Bound to `127.0.0.1` inside the container | Set `HOST=0.0.0.0`. |
| Wrong scheme/IP in logs or generated URLs | Forwarded headers not set or not trusted | Configure the proxy to send `X-Forwarded-*` and set `TRUST_PROXY`. |
| GitHub requests rate-limited | No `GITHUB_TOKEN` | Provide a `GITHUB_TOKEN` to raise limits. |