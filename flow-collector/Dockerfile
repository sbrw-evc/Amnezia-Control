FROM netsampler/goflow2:v2.2.1 AS goflow

FROM python:3.12-alpine
COPY --from=goflow /goflow2 /usr/local/bin/goflow2
RUN pip install --no-cache-dir httpx==0.28.1 maxminddb==2.6.2
WORKDIR /srv
COPY collector.py .
ENV PYTHONUNBUFFERED=1
EXPOSE 2055/udp 6343/udp
CMD ["python", "collector.py"]
