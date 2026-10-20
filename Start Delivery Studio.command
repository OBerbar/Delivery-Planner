#!/bin/zsh
# Double-click to open the local planner. Closing this terminal stops the app.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
if curl -fsS http://127.0.0.1:4311/api/health >/dev/null 2>&1; then
  open http://127.0.0.1:4311
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js is needed to start Delivery Studio. Install the free Node.js LTS runtime.'
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Installing the free project dependencies (first launch only).'
  npm ci || exit 1
fi
if [[ ! -f dist/index.html ]]; then
  npm run build || exit 1
fi
(sleep 2; open http://127.0.0.1:4311) &
npm start
