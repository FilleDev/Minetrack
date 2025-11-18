#!/bin/bash

# Configuration
PM2_APP_NAME="minetrack"
BRANCH="main"
LOG_FILE="update.log"

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

# Fetch latest changes from remote
#log "Fetching latest changes..."
git fetch origin

# Get current and remote commit hashes
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/$BRANCH)

# Check if update is needed
if [ "$LOCAL" = "$REMOTE" ]; then
#    log "Already up to date."
    exit 0
fi

log "New changes detected. Updating..."

# Stop the PM2 process
log "Stopping PM2 app: $PM2_APP_NAME..."
pm2 stop "$PM2_APP_NAME"

# Pull latest changes
log "Pulling changes..."
git pull origin "$BRANCH"

# Install dependencies
log "Running npm install..."
npm install

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