SapuSugi

Full-stack web application built with a Python backend and a Next.js
frontend. Containerized with Docker and orchestrated via docker-compose.

------------------------------------------------------------------------

------------------------------------------------------------------------

Backend

-   Python API service
-   Dependency management via requirements.txt
-   Designed for container execution
-   Test file included: test_backend_api.py

Frontend

-   Next.js (TypeScript enabled)
-   TailwindCSS
-   PostCSS configuration
-   Production build via .next

Infrastructure

-   Dockerized backend and frontend
-   docker-compose.yml for local orchestration
-   Environment configuration via .env

------------------------------------------------------------------------

Tech Stack

Backend: - Python - FastAPI - Uvicorn

Frontend: - Next.js - TypeScript - TailwindCSS

DevOps: - Docker - Docker Compose

------------------------------------------------------------------------

Prerequisites

-   Docker
-   Docker Compose
-   Node.js (if running frontend locally without Docker)
-   Python 3.10+ (if running backend locally without Docker)

------------------------------------------------------------------------

Running with Docker (Recommended)

docker-compose up –build

------------------------------------------------------------------------

Running Backend Locally

cd backend python -m venv .venv source .venv/bin/activate pip install -r
requirements.txt uvicorn main:app –reload

------------------------------------------------------------------------

Running Frontend Locally

cd frontend npm install npm run dev

------------------------------------------------------------------------

Environment Variables

Create a .env file if required by backend or frontend services.

Example:

API_URL=http://localhost:8000

Adjust based on your environment.

------------------------------------------------------------------------

Testing

cd backend pytest

------------------------------------------------------------------------

Production Build

Frontend: npm run build npm start

Backend: Use production ASGI server configuration (e.g., uvicorn with
workers or gunicorn).

------------------------------------------------------------------------

Notes

-   node_modules/ and .next/ must not be committed.
-   Python virtual environments must not be committed.
-   Use Docker for consistent deployments.

------------------------------------------------------------------------

License

Private / Internal project. Adjust as required.
