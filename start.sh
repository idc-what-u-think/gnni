#!/bin/bash
echo "Installing dependencies..."
npm install
echo ""
echo "Starting Game Night server..."
node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM
sleep 2
open http://localhost:3000/host 2>/dev/null || xdg-open http://localhost:3000/host 2>/dev/null
wait $SERVER_PID
