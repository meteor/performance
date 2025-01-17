#!/usr/bin/env bash

# app. Application directory name within ./apps/*
# script. Artillery script name within ./artillery/*
app="${1}"
logName="${2}"
if [[ -z "$app" ]]; then
  echo "Usage: monitor-bundler.sh <app_name>"
  exit 1;
fi

# Redirect stdout (1) and stderr (2) to a file
logFile="logs/${logName}-${app}-bundle.log"
mkdir -p logs
exec > "./${logFile}" 2>&1

# Initialize script constants
baseDir="${PWD}"
appsDir="${baseDir}/apps"
appPath="${appsDir}/${app}"
appPort=3000

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

function startMeteorApp() {
  if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
    METEOR_PROFILE=1 METEOR_PACKAGE_DIRS="${baseDir}/packages" ${METEOR_CHECKOUT_PATH}/meteor run --port ${appPort} &
  else
    METEOR_PROFILE=1 METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor run --port ${appPort} &
  fi
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

function findSecondPattern() {
  local file="${1}"
  local first_pattern="${2}"
  local second_pattern="${3}"
  # Search for the line containing the first pattern, then find the first occurrence of the second pattern after that line
  awk '/'"${first_pattern}"'/ {found=1; next} found && /'"${second_pattern}"'/ {print; exit}' "${file}"
}

function parseNumberAndUnit() {
  local input="$1"
  echo "$input" | awk '{
    for (i=1; i<=NF; i++) {
      if ($i ~ /^[0-9,]+$/) {
        gsub(",", "", $i); # Remove commas from the number
        printf "%s %s", $i, $(i+1); # Correctly format the output
        exit; # Ensure the loop stops after finding the first number and unit
      }
    }
  }'
}

function findMetricStage() {
  local stage="${1}"
  local metric="${2}"
  read num unit <<< $(parseNumberAndUnit "$(findSecondPattern "${baseDir}/${logFile}" "\[${stage}\]" "\(${metric}\)")")
  echo -e " - ${metric}: ${num} ${unit}"
}

function getMetricsStage() {
  local stage="${1}"
  findMetricStage "${stage}" "ProjectContext resolveConstraints"
  findMetricStage "${stage}" "ProjectContext prepareProjectForBuild"
  findMetricStage "${stage}" "Build App"
  findMetricStage "${stage}" "Server startup"
}

function reportStageMetrics() {
  local stage="${1}"

  echo -e "==============================="
  echo -e "Metrics - ${stage}"
  echo -e "==============================="

  local metrics="$(getMetricsStage "${stage}")"
  echo -e "${metrics}"

  local totalNum=0
  while IFS= read -r line; do
    read num unit <<< $(parseNumberAndUnit "${line}")
    ((totalNum += num))
  done <<< "${metrics}"

  echo -e " * Total: ${totalNum} ${unit}"
}

function reportMetrics() {
  reportStageMetrics "Cold start"
  reportStageMetrics "Cache start"
}

function killProcessByPort() {
  local portToKill=${1:-''}
  local portPid="$(lsof -i:"${portToKill}" -t)"
  local killSignal=${2}

  local cmdPrefix="$(echo "")"
  for pid in $portPid; do
    if [[ "${pid}" -eq "" ]]; then
      return
    fi

    if [[ -z "${killSignal}" ]]; then
      eval "${cmdPrefix} kill -9 \"${pid}\""
    else
      eval "${cmdPrefix} kill -s \"${killSignal}\" \"${pid}\""
    fi
  done
}

# Ensure proper cleanup on interrupt the process
function cleanup() {
    builtin cd ${baseDir};
    pkill -P $$

    sleep 2
    reportMetrics

    exit 0
}
trap cleanup SIGINT SIGTERM

loadEnv "${baseDir}/.env"

# Prepare, run and wait meteor app
builtin cd "${appPath}"

logMeteorVersion
killProcessByPort "${appPort}"

echo -e "==============================="
echo -e "[Cold start]"
echo -e "==============================="
rm -rf "${appPath}/.meteor/local"
startMeteorApp
waitMeteorApp
killProcessByPort "${appPort}"
sleep 2

echo -e "==============================="
echo -e "[Cache start]"
echo -e "==============================="
startMeteorApp
waitMeteorApp
killProcessByPort "${appPort}"
sleep 2

cleanup
