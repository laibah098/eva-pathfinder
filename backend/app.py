from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Mars EVA Pathfinder API is running!",
        "status": "success"
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy"
    })


@app.route("/api/route", methods=["POST"])
def calculate_route():
    data = request.get_json()

    start = data.get("start")
    end = data.get("end")

    if not start or not end:
        return jsonify({
            "error": "Start and end coordinates are required"
        }), 400

    return jsonify({
        "message": "Coordinates received successfully!",
        "start": start,
        "end": end,
        "path": [start, end]
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)