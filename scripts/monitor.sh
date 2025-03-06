#!/usr/bin/env bash


# app. Application directory name within ./apps/*
# script. Artillery script name within ./artillery/*
app="${1}"
script="${2}"
logName="${3:-''}"
artilleryKey="${4:-''}"

if [[ -z "$app" ]] || [[ -z "$script" ]]; then
  echo "Usage: monitor.sh <app_name> <script_name> [log_name] [artillery_key]"
  echo "  artillery_key: Optional - Your Artillery Cloud API key to send results to Artillery Cloud"
  exit 1;
fi

# Determine if we should use Artillery Cloud
useCloud="false"
if [[ -n "${artilleryKey}" ]]; then
  useCloud="true"
  echo "Artillery Cloud key provided - results will be sent to Artillery Cloud"
fi

# Redirect stdout (1) and stderr (2) to a file
logFile="logs/${logName}-${app}-${script}.log"
mkdir -p logs
exec > "./${logFile}" 2>&1

# Initialize script constants
baseDir="${PWD}"
appsDir="${baseDir}/apps"
appPath="${appsDir}/${app}"
appPort=3000
reportDir="${baseDir}/reports"
jsonReport="${reportDir}/${logName}-${app}-${script}.json"
htmlReport="${reportDir}/${logName}-${app}-${script}.html"

# Create reports directory if it doesn't exist
mkdir -p "${reportDir}"

# Define color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Define helpers
function getPidByName() {
  ps aux | grep "${1}" | grep -v grep | awk '{print $2}'
}

function loadEnv() {
  if [[ -f $1 ]]; then
    # shellcheck disable=SC1090
    source "${1}"
    while read -r line; do
      eval "export ${line}"
    done <"$1"
  fi
}

function formatToEnv() {
  local str="${1}"
  str=$(echo ${str} | sed -r -- 's/ /_/g')
  str=$(echo ${str} | sed -r -- 's/\./_/g')
  str=$(echo ${str} | sed -r -- 's/\-/_/g')
  str=$(echo ${str} | tr -d "[@^\\\/<>\"'=]" | tr -d '*')
  str=$(echo ${str} | sed -r -- 's/\//_/g')
  str=$(echo ${str} | sed -r -- 's/,/_/g')
  str=$(echo ${str} | sed 'y/abcdefghijklmnopqrstuvwxyz/ABCDEFGHIJKLMNOPQRSTUVWXYZ/')
  echo "${str}"
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

function getMontiAppId() {
  echo "$(eval "echo \${MONTI_APP_ID_$(formatToEnv ${app})}")"
}

function getMontiAppSecret() {
  echo "$(eval "echo \${MONTI_APP_SECRET_$(formatToEnv ${app})}")"
}

function logScriptConfig() {
  echo -e "==============================="
  echo -e " Artillery Configuration - $(date) "
  echo -e "==============================="
  cat "${baseDir}/artillery/${script}.yml"
  echo -e "==============================="
}

function logMeteorVersion() {
  echo -e "==============================="
  if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
    local oldPath="${PWD}"
    builtin cd "${METEOR_CHECKOUT_PATH}"
    echo -e " Meteor checkout version - $(git rev-parse HEAD)"
    builtin cd "${oldPath}"
  else
    echo -e " Meteor version - $(cat .meteor/release)"
  fi
  echo -e "==============================="
}

# Ensure proper cleanup on interrupt the process
function cleanup() {
    verify="${1}"

    if [[ -n "${ENABLE_APM}" ]]; then
      METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor remove apm-agent
    fi

    builtin cd ${baseDir};
    # Kill all background processes
    pkill -P ${artPid}
    kill -s TERM ${cpuRamAppPid} || true
    kill -s TERM ${cpuRamDbPid} || true
    pkill -P $$

    # Verify valid output
    if [[ "${verify}" == "true" ]]; then
      sleep 6
      if cat "${baseDir}/${logFile}" | grep -q " Timeout "; then
        echo -e "${RED}*** !!! ERROR: SOMETHING WENT WRONG !!! ***${NC}"
        echo -e "${RED}Output triggered an unexpected timeout (${logFile})${NC}"
        echo -e "${RED} Your machine is overloaded and unable to provide accurate comparison results.${NC}"
        echo -e "${RED} Try switching to a configuration that your machine can handle.${NC}"

        exit 1
      else
        echo -e "${GREEN}Output is suitable for comparisons (${logFile})${NC}"
        echo -e "${GREEN} Your machine managed the configuration correctly.${NC}"
        
        if [[ -f "${htmlReport}" ]]; then
          echo -e "${GREEN}HTML report was generated successfully at: ${htmlReport}${NC}"
        else
          echo -e "${RED}Warning: HTML report was not generated${NC}"
        fi

        if [[ "${useCloud}" == "true" ]]; then
          echo -e "${GREEN}Results were sent to Artillery Cloud. Check your dashboard at https://artillery.io/cloud${NC}"
        fi

        exit 0
      fi
    fi

    exit 0
}
trap cleanup SIGINT SIGTERM

logScriptConfig

loadEnv "${baseDir}/.env"

# Prepare, run and wait meteor app
builtin cd "${appPath}"

if [[ -n "${ENABLE_APM}" ]]; then
  export MONTI_APP_ID="$(getMontiAppId)"
  export MONTI_APP_SECRET="$(getMontiAppSecret)"
  METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor add apm-agent
fi

rm -rf "${appPath}/.meteor/local"
logMeteorVersion
if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
  METEOR_PACKAGE_DIRS="${baseDir}/packages" ${METEOR_CHECKOUT_PATH}/meteor run --port ${appPort} &
else
  METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor run --port ${appPort} &
fi
waitMeteorApp

appPid="$(getPidByName "${app}/.meteor/local/build/main.js")"
dbPid="$(getPidByName "${app}/.meteor/local/db")"
echo "APP PID: ${appPid}"
echo "DB PID: ${dbPid}"

# Run artillery script
if [[ "${useCloud}" == "true" ]]; then
  echo "Running Artillery with Cloud integration..."
  npx artillery run "${baseDir}/artillery/${script}.yml" --record --key "${artilleryKey}" --output "${jsonReport}" &
else
  echo "Running Artillery locally..."
  npx artillery run "${baseDir}/artillery/${script}.yml" --output "${jsonReport}" &
fi
artPid="$!"

# Run CPU and RAM monitoring for meteor app and db
node "${baseDir}/scripts/helpers/monitor-cpu-ram.js" "${appPid}" "APP" &
node "${baseDir}/scripts/helpers/monitor-cpu-ram.js" "${dbPid}" "DB" &

cpuRamAppPid="$(getPidByName "${baseDir}/scripts/helpers/monitor-cpu-ram.js ${appPid} APP")"
cpuRamDbPid="$(getPidByName "${baseDir}/scripts/helpers/monitor-cpu-ram.js ${dbPid} DB")"

echo "Monitor CpuRam APP Pid ${cpuRamAppPid}"
echo "Monitor CpuRam DB Pid ${cpuRamDbPid}"

# Wait for artillery script to finish the process
wait "${artPid}"

# Generate HTML report
echo "Generating HTML report..."
npx artillery report "${jsonReport}" --output "${htmlReport}"
echo "HTML report generated at: ${htmlReport}"

cleanup "true"
