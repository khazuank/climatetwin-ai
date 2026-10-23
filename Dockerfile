FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN python3 -m venv /opt/backend-venv \
    && /opt/backend-venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend-build /app/frontend/.next/standalone/ /app/frontend/
COPY --from=frontend-build /app/frontend/.next/static/ /app/frontend/.next/static/
COPY --from=frontend-build /app/frontend/public/ /app/frontend/public/
COPY deploy/start.sh /app/start.sh
ENV NODE_ENV=production FASTAPI_BASE_URL=http://127.0.0.1:8000
EXPOSE 10000
CMD ["sh", "/app/start.sh"]
