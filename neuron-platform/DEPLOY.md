# Deploying the Neuron Platform to `neuron.shital.org.uk`

The Neuron Master Platform is now wired into the ShitalEco production
pipeline as a separate block. The DB stays fully isolated (own SQLite
file in the `neuron_data` Docker volume; `backend/db.py` refuses to
start if `NEURON_DB_URL` ever points at the ShitalEco database).

## What this PR adds

| File                                | Change                                                                |
| ----------------------------------- | --------------------------------------------------------------------- |
| `docker-compose.prod.yml`           | new `neuron-master` service (build context `./neuron-platform`), volumes `neuron_data` + `neuron_artifacts`, joined to existing `internal` network |
| `nginx/conf.d/neuron.conf`          | new vhost: HTTP→HTTPS redirect + HTTPS proxy to `neuron-master:8088`  |
| `deploy.sh`                         | builds + (re)starts `neuron-master`, smoke-checks `/healthz`          |
| `neuron-platform/`                  | the Master Platform itself (Stages 1 + 2 + Secrets/Library Mgmt)      |

## Production deploy steps

The work happens on the production VPS at `/opt/shitaleco`.

### 1. Pull the changes onto the deploy branch

This branch is `claude/create-project-blocks-N8kpy`. The deploy script
hard-codes `BRANCH=claude/shital-erp-platform-iR2UF`, so the merge needs
to land there for `deploy.sh` to pick it up:

```bash
# locally (or via GitHub UI):
git checkout claude/shital-erp-platform-iR2UF
git merge --no-ff claude/create-project-blocks-N8kpy
git push origin claude/shital-erp-platform-iR2UF
```

### 2. Run the deploy on the VPS

```bash
ssh root@<vps>
cd /opt/shitaleco
sudo bash deploy.sh --update
```

The deploy script will:

1. Pull the deploy branch (now containing `neuron-platform/`).
2. Pull the existing GHCR images for the ShitalEco services.
3. **Build `neuron-master` locally** from `./neuron-platform/master_platform/Dockerfile`.
4. Bring everything up with `docker compose ... up -d`.
5. Reload nginx (which now picks up `neuron.conf`).
6. Smoke-check `neuron-master /healthz`.

### 3. Issue / extend the TLS certificate

`neuron.shital.org.uk` needs to be added to the existing Let's Encrypt
cert at `/etc/letsencrypt/live/shital.org.uk/`:

```bash
docker compose -f /opt/shitaleco/docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  --expand --cert-name shital.org.uk \
  -d shital.org.uk -d www.shital.org.uk \
  -d admin.shital.org.uk -d kiosk.shital.org.uk \
  -d donate.shital.org.uk -d screen.shital.org.uk \
  -d service.shital.org.uk -d neuron.shital.org.uk

docker compose -f /opt/shitaleco/docker-compose.prod.yml exec nginx nginx -s reload
```

### 4. First-time login

After the deploy, the Master writes its bootstrap admin key to
`master_platform/data/bootstrap_admin.txt` inside the `neuron_data`
volume. To copy it:

```bash
docker compose -f /opt/shitaleco/docker-compose.prod.yml exec neuron-master \
  cat master_platform/data/bootstrap_admin.txt
```

Open `https://neuron.shital.org.uk/login`, paste the key (ignore the
leading `#` comment lines), then immediately delete the file:

```bash
docker compose -f /opt/shitaleco/docker-compose.prod.yml exec neuron-master \
  rm master_platform/data/bootstrap_admin.txt
```

From that point on, every API key is created/rotated/revoked from the
in-app **Secrets** section at `/ui/secrets`.

## Rollback

```bash
# stop neuron-master only
docker compose -f /opt/shitaleco/docker-compose.prod.yml stop neuron-master

# or take it out of the stack entirely
docker compose -f /opt/shitaleco/docker-compose.prod.yml rm -fs neuron-master
```

The ShitalEco services are untouched by Neuron; the volumes
(`neuron_data`, `neuron_artifacts`) live separately and survive
`down`/`up` cycles.

## DNS

`neuron.shital.org.uk` already resolves to the production VPS — confirmed
returning HTTP 503 (nginx with no upstream) on `2026-05-09`. After the
deploy + cert expansion above, that will become HTTP 200 from
`neuron-master:8088`.
