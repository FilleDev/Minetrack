#!/bin/bash

# Configuration
PM2_APP_NAME="minetrack"
BRANCH="main"
LOG_FILE="update.log"
LOCK_FILE="update.lock"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR" || {
    log "ERROR: Failed to change to directory $SCRIPT_DIR"
    exit 1
}

# Prevent overlapping runs (e.g. a slow npm install still running when the next cron tick fires)
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "Another update is already running, skipping."
    exit 0
fi

BEFORE_HASH="$(git rev-parse HEAD)"

if ! git pull --ff-only origin "$BRANCH" >> "$LOG_FILE" 2>&1; then
    log "ERROR: git pull failed, not restarting the app"
    exit 1
fi

AFTER_HASH="$(git rev-parse HEAD)"

if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
    exit 0
fi
log "New changes detected. Updating..."

# Stop the PM2 process
log "Stopping PM2 app: $PM2_APP_NAME..."
pm2 stop "$PM2_APP_NAME"

# Install dependencies
log "Running npm install..."
npm install

# Rebuild the frontend bundle
log "Running npm run build..."
npm run build

# Restart the PM2 process
log "Restarting PM2 app: $PM2_APP_NAME..."
pm2 restart "$PM2_APP_NAME"

# Check if process is running
if pm2 list | grep -q "$PM2_APP_NAME.*online"; then
    log "Update completed successfully. App is running."
else
    log "WARNING: Could not verify if app started successfully."
fi

# Automatic runner:
# Add as job in crontab
# 1. crontab -e
# 2. Add this to config (checks every 10 min)
# */10 * * * * cd /home/user/x && ./update.sh
# 3. Save and exit.
# 4. Verify with: crontab -l
