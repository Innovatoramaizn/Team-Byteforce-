import os

from app import create_app

# Production WSGI entry point: gunicorn --bind 0.0.0.0:$PORT run:app
app = create_app()

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=app.config["DEBUG"])
