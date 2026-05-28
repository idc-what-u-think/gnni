#!/bin/bash
echo "Installing dependencies..."
npm install
echo ""
echo "Starting Game Night server..."
open http://localhost:3000/host 2>/dev/null || xdg-open http://localhost:3000/host 2>/dev/null
node server.js
