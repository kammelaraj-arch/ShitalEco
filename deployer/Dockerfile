FROM python:3.12-alpine

RUN apk add --no-cache docker-cli git bash curl

WORKDIR /app
COPY server.py .
COPY deploy.sh .
RUN chmod +x deploy.sh

CMD ["python", "server.py"]
