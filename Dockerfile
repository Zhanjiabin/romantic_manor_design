FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MANOR_HOST=0.0.0.0 \
    MANOR_PORT=8765 \
    MANOR_NO_BROWSER=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=8s --start-period=120s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=5)"

CMD ["python", "server.py"]
