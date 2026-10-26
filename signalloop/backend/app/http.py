from flask import request


def json_body():
    """Return the JSON request body as a dict; anything else (lists, strings, invalid JSON) becomes {}."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}
