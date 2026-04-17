FROM alpine:3.19

RUN apk add --no-cache bash docker-cli gzip curl tzdata

# Default timezone: London
ENV TZ=Europe/London

COPY crontab /etc/crontabs/root
RUN chmod 600 /etc/crontabs/root

CMD ["crond", "-f", "-l", "2"]
