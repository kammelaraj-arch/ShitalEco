FROM python:3.12-alpine

RUN apk add --no-cache docker-cli git bash curl

WORKDIR /app
COPY server.py .
COPY deploy.sh .
COPY deploy_neuron.sh .
RUN chmod +x deploy.sh deploy_neuron.sh

CMD ["python", "server.py"]
