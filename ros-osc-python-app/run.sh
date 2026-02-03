#!/usr/bin/env bash
cd "$(dirname "$0")"
pip install -r requirements.txt 2>/dev/null || true
python app.py
