import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from airbnb_price.contracts import Listing
from airbnb_price.runtime import get_model


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        chunks = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunks.extend(message.get("body", b""))
            if len(chunks) > 8192:
                return await JSONResponse({"detail": "Request exceeds 8 KB."}, status_code=413)(
                    scope, receive, send
                )
            if not message.get("more_body"):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(chunks), "more_body": False}

        await self.app(scope, replay, send)


def create_app():
    @asynccontextmanager
    async def lifespan(application):
        get_model()
        yield

    application = FastAPI(
        title="Airbnb Price Workbench", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    application.add_middleware(BodyLimit)
    submissions = deque()

    @application.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.update(
            {
                "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
            }
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.get("/health")
    async def health():
        return {"status": "ok", "version": "0.1.0", "model_sha256": get_model().report["model_sha256"]}

    @application.get("/api/model")
    async def model():
        return get_model().report

    @application.post("/api/predict")
    async def predict(listing: Listing):
        now = time.monotonic()
        while submissions and submissions[0] < now - 60:
            submissions.popleft()
        if len(submissions) >= 60:
            raise HTTPException(429, "Prediction request limit reached. Try later.")
        submissions.append(now)
        return get_model().predict(listing)

    site = Path(__file__).with_name("site")
    local = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if local.is_dir():
        site = local
    if site.is_dir():
        application.mount("/assets", StaticFiles(directory=site / "assets"), name="assets")

        @application.get("/")
        async def index():
            return FileResponse(site / "index.html")

        @application.get("/{filename}")
        async def asset(filename: str):
            if filename not in {
                "price-model.onnx",
                "report.json",
                "parity.json",
                "LICENSE",
                "NOTICE.md",
                "licenses.json",
            }:
                raise HTTPException(404)
            return FileResponse(site / filename)

    return application


app = create_app()
