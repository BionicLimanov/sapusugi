FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV NOTEBOOK_DIR=/data/notebooks
ENV MEMORY_DIR=/data/memory

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
