#!/usr/bin/env bash


# app. Application directory name within ./apps/*
# script. Artillery script name within ./artillery/*
app="${1}"
script="${2}"
logName="${3:-''}"
if [[ -z "$app" ]] || [[ -z "$script" ]]; then
  echo "Usage: monitor.sh <app_name> <script_name>"
  exit 1;
fi

# Redirect stdout (1) and stderr (2) to a file
mkdir -p logs
exec > ./logs/${logName}-${app}-${script}.log 2>&1

# Initialize script constants
baseDir="${PWD}"
appsDir="${baseDir}/apps"
appPath="${appsDir}/${app}"
appPort=3000

# Define helpers
function getPidByName() {
  ps aux | grep "${1}" | grep -v grep | awk '{print $2}'
}

function isRunningUrl() {
  local url="${1}"
  local urlStatus="$(curl -Is "${url}" | head -1)"
  echo "${urlStatus}" | grep -q "200"
}

function waitMeteorApp() {
  PROCESS_WAIT_TIMEOUT=3600000
  processWaitTimeoutSecs=$((PROCESS_WAIT_TIMEOUT / 1000))
  waitSecs=0
  while ! isRunningUrl "http://localhost:${appPort}" && [[ "${waitSecs}" -lt "${processWaitTimeoutSecs}" ]]; do
    sleep 1
    waitSecs=$((waitSecs + 1))
  done
}

# Ensure proper cleanup on interrupt the process
function cleanup() {
    builtin cd ${baseDir};
    # Kill all background processes
    pkill -P ${artPid}
    pkill -P $$
    sleep 5
    exit 0
}
trap cleanup SIGINT SIGTERM


# Prepare, run and wait meteor app
builtin cd "${appPath}"
rm -rf "${appPath}/.meteor/local"
METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor run --port ${appPort} &
waitMeteorApp

appPid="$(getPidByName "${app}/.meteor/local/build/main.js")"
dbPid="$(getPidByName "${app}/.meteor/local/db")"
echo "APP PID: ${appPid}"
echo "DB PID: ${dbPid}"

# Run artillery script
npx artillery run "${baseDir}/artillery/${script}" &
artPid="$!"

# Run CPU and RAM monitoring for meteor app and db
node "${baseDir}/scripts/monitor-cpu-ram.js" "${appPid}" "APP" &
node "${baseDir}/scripts/monitor-cpu-ram.js" "${dbPid}" "DB" &

# Wait for artillery script to finish the process
wait "${artPid}"
cleanup
