# Deployment

Nothing is deployed automatically. Choose **A (Linux VM)** or **B (Docker Compose)**.

## Checklist (both options)
- [ ] PostgreSQL 14+ with a dedicated user and database
- [ ] `AUTH_SECRET` — new random value (`openssl rand -base64 48`); never reuse the development value
- [ ] `SEED_ADMIN_PASSWORD` — strong; change it again after first login
- [ ] HTTPS in front of the app (Nginx/Caddy/load balancer) and `COOKIE_SECURE=true`
- [ ] `UPLOAD_DIR` on persistent, backed-up storage
- [ ] Daily `npm run backup` + off-server copy (see DATABASE.md)
- [ ] `SEED_DEMO=false` for a real company (no demo data)
- [ ] Optional SMTP settings for emailing invoices

## A. Linux VM (Node + systemd)
```bash
# 1. Install Node 22, PostgreSQL 16 client tools, build the app
sudo mkdir -p /opt/waste-erp && sudo chown $USER /opt/waste-erp
git clone <your-repo> /opt/waste-erp && cd /opt/waste-erp
npm ci
cp .env.example .env && nano .env          # production values
npx prisma migrate deploy                  # database migration
SEED_DEMO=false npm run db:seed            # database seed (base configuration + admin user)
npm run build                              # build
# 2. Start (production start command)
npm start                                  # production start command (PORT env var, default 3000)
```
systemd unit `/etc/systemd/system/waste-erp.service`:
```ini
[Unit]
Description=Waste ERP
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/waste-erp
EnvironmentFile=/opt/waste-erp/.env
ExecStart=/usr/bin/npm start
Restart=always
User=erp

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now waste-erp
```
Nginx reverse proxy (TLS via certbot):
```nginx
server {
  server_name erp.example.com;
  client_max_body_size 12m;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

### Updating
```bash
cd /opt/waste-erp && npm run backup && git pull && npm ci && npx prisma migrate deploy && npm run build && sudo systemctl restart waste-erp
```

## B. Docker Compose
```bash
cp .env.example .env            # set POSTGRES_PASSWORD, AUTH_SECRET, SEED_ADMIN_PASSWORD, COOKIE_SECURE=true
docker compose up -d --build
docker compose run --rm app npx prisma migrate deploy
docker compose run --rm -e SEED_DEMO=false app npx tsx prisma/seed.ts
```
The app listens on port 3000; put a TLS proxy in front. Volumes: `pgdata` (database) and `uploads` (documents). Backups:
```bash
docker compose exec db pg_dump -U erp -Fc waste_erp > backups/waste_erp_$(date +%F).dump
docker run --rm -v waste-erp_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads_$(date +%F).tar.gz -C /u .
```

## Health & monitoring
- `GET /api/health` → 200 when the database is reachable (use for load-balancer health checks).
- Application errors are logged to stdout (`journalctl -u waste-erp` / `docker compose logs app`); users only see friendly messages with a reference.
- Notifications are recalculated at most every 15 minutes while users are active.

## Environment variables
See the table in [SETUP.md](SETUP.md#2-install-and-configure). Secrets live only in `.env` / the orchestrator's secret store — never in the repository (`.env*` is git-ignored except `.env.example`).
