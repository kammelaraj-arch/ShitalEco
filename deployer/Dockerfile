FROM python:3.12-alpine

# docker-cli-compose installs the Compose v2 plugin so 'docker compose' works.
# Without it, deploy.sh fails with "unknown shorthand flag: 'f' in -f" because
# 'compose' isn't recognised as a subcommand and -f bubbles up to docker itself.
RUN apk add --no-cache docker-cli docker-cli-compose git bash curl

WORKDIR /app
COPY server.py .
COPY deploy.sh .
RUN chmod +x deploy.sh

CMD ["python", "server.py"]
