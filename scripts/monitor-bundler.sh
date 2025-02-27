#!/usr/bin/env bash

# app. Application directory name within ./apps/*
# script. Artillery script name within ./artillery/*
app="${1}"
logName="${2}"
meteorOptions="${@:3}"
if [[ -z "$app" ]]; then
  echo "Usage: monitor-bundler.sh <app_name>"
  exit 1;
fi

# Initialize script constants
baseDir="${PWD}"
appsDir="${baseDir}/apps"
appPath="${appsDir}/${app}"
appPort="$(echo "$meteorOptions" | sed -n 's/.*--port[ =]\?\([0-9]\+\).*/\1/p')"
if [[ -z "$appPort" ]]; then
  appPort=3000
fi
appResolved="$(echo $app)"
logDir="${baseDir}/logs"
if [[ -d "$appResolved" ]]; then
  if [[ "$appResolved" == "$(echo ~)/"* ]]; then
    appsDir="$(dirname $appResolved)"
  else
    appsDir="${baseDir}/$(dirname $appResolved)"
  fi
  app="$(basename "$appPath")"
  appPath="${appsDir}/${app}"
  logDir="${appPath}/logs"
  logFile="${logDir}/${logName}-${app}-bundle.log"
else
  METEOR_PACKAGE_DIRS="${baseDir}/packages"
fi
meteorClientEntrypoint="$(grep -oP '"client":\s*"\K[^"]+' "${appPath}/package.json")"
meteorServerEntrypoint="$(grep -oP '"server":\s*"\K[^"]+' "${appPath}/package.json")"
logFile="${logDir}/${logName}-${app}-bundle.log"
monitorSize="${METEOR_BUNDLE_SIZE}"

meteorCmd="meteor"
if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
  meteorCmd="${METEOR_CHECKOUT_PATH}/meteor"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
GREY='\033[0;37m'
NC='\033[0m'

function logMessage() {
  echo -e "${1}"
}

function logProgress() {
  # Restore original stdout and stderr
  exec 1>&3 2>&4

  logMessage "${BLUE}${1}${NC}"

  # Redirect stdout and stderr to logFile
  exec >> "${logFile}" 2>&1
}

function logBanner() {
  if [[ "${DISABLE_COLORS}" == "true" ]]; then
    logMessage "${1}"
    return
  fi
  logMessage "${PURPLE}${1}${NC}" ${@:2}
}

function logSpecial() {
  if [[ "${DISABLE_COLORS}" == "true" ]]; then
    logMessage "${1}"
    return
  fi
  logMessage "${CYAN}${1}${NC}" ${@:2}
}

function logError() {
  if [[ "${DISABLE_COLORS}" == "true" ]]; then
    logMessage "${1}"
    return
  fi
  logMessage "${RED}${1}${NC}" ${@:2}
}

function logScriptInfo() {
  logBanner "==============================="
  logBanner " Profile script"
  logBanner "==============================="
  logBanner " - App path: $(logMessage "${appPath}")"
  logBanner " - App port: $(logMessage "${appPort}")"
  logBanner " - Logs file: $(logMessage "${logFile}")"
  if [[ "${monitorSize}" == "true" ]]; then
  logBanner " - Monitor size: $(logMessage "${monitorSize}")"
  fi
  logBanner "==============================="
}

function logFullLogDetails() {
  logSpecial "==============================="
  logSpecial " Full log details at ${logFile}"
  logSpecial "==============================="
}

logScriptInfo
logFullLogDetails

# Redirect stdout (1) and stderr (2) to a file
mkdir -p "${logDir}"
# Save original stdout and stderr
exec 3>&1 4>&2
# Redirect stdout and stderr to logFile
exec > "${logFile}" 2>&1

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

  echo ":: MeteorAppStarted"
}

function waitMeteorClientModified() {
  local context="waitMeteorClientModified::${1}"
  PROCESS_WAIT_TIMEOUT=3600000
  processWaitTimeoutSecs=$((PROCESS_WAIT_TIMEOUT / 1000))
  waitSecs=0

  echo "${context}"
  while ! awk -v context="${context}" '
    /'"${context}"'/ {found=1; next}   # When context is found, set `found` and skip
    found && /Client modified/ {exit 0}  # After context, check for "Client modified"
    END { if (found && !/Client modified/) exit 1 }  # If found but "Client modified" is missing, exit 1
  ' "${logFile}"; do
    sleep 1
    waitSecs=$((waitSecs + 1))
  done

  echo ":: MeteorClientModified"
}

function waitMeteorServerModified() {
  local context="waitMeteorServerModified::${1}"
  PROCESS_WAIT_TIMEOUT=3600000
  processWaitTimeoutSecs=$((PROCESS_WAIT_TIMEOUT / 1000))
  waitSecs=0

  echo "${context}"
  while ! awk -v context="${context}" '
    /'"${context}"'/ {found=1; next}   # When context is found, set `found` and skip
    found && /Server modified/ {exit 0}  # After context, check for "Server modified"
    END { if (found && !/Server modified/) exit 1 }  # If found but "Server modified" is missing, exit 1
  ' "${logFile}"; do
    sleep 1
    waitSecs=$((waitSecs + 1))
  done

  echo ":: MeteorServerModified"
}

function startMeteorApp() {
  METEOR_PROFILE=1 METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} run ${meteorOptions} &
}

function visualizeMeteorAppBundle() {
  METEOR_PROFILE=1 METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} --extra-packages bundle-visualizer --production ${meteorOptions} &
}

function removeMeteorAppBundleVisualizer() {
  METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} remove bundle-visualizer
  sed -i '/bundle-visualizer/d' "${appPath}/.meteor/versions"
}

function calculateMeteorAppBundleSize() {
  local scriptContext="$(dirname $0)"
  if [[ "${scriptContext}" =~ "./" ]]; then
    scriptContext="${baseDir}/${scriptContext}"
  fi
  MONITOR_SIZE_URL="http://localhost:${appPort}/__meteor__/bundle-visualizer/stats" ${meteorCmd} node "${scriptContext}/helpers/print-bundle-size.js"
}

function logMeteorVersion() {
  logBanner "==============================="
  logBanner " Meteor version - $(cat "${appPath}/.meteor/release")"
  if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
    local oldPath="${PWD}"
    builtin cd "${METEOR_CHECKOUT_PATH}"
    logBanner " Meteor checkout version - $(git rev-parse HEAD)"
    builtin cd "${oldPath}"
  fi
  logBanner "==============================="
  if [[ -n "${meteorOptions}" ]]; then
    logBanner " Meteor options - ${meteorOptions}"
    logBanner "==============================="
  fi
}

function logNpmPackages() {
  logBanner "==============================="
  logBanner " Npm packages"
  logBanner "==============================="
  $meteorCmd node -p "Object.entries(Object.assign({}, require('${appPath}/package.json').dependencies, require('${appPath}/package.json').devDependencies)).map(([k,v]) => \`\${k}@\${v}\`).join('\n')" \
    | awk '{ printf (NR%5 ? $0 " │ " : $0 "\n") } END { if (NR%5) print "" }'
  logBanner "==============================="
}

function logMeteorPackages() {
  logBanner "==============================="
  logBanner " Meteor packages"
  logBanner "==============================="
  logMessage " $(formatFile "${appPath}/.meteor/versions")"
  logBanner "==============================="
}

function logMeteorBundleSize() {
  logBanner "==============================="
  logBanner " Bundle size"
  logBanner "==============================="
  logMessage " $(echo "${BundleSize}")"
  logBanner "==============================="
}

function sedr() {
  sed -r -- "$@"
}

function formatKebabCase() {
  local str="${1}"
  str=$(echo ${str} | sedr 's/([A-Z])/-\1/g')
  str=$(echo ${str} | sedr 's/ /-/g')
  str=$(echo ${str} | sedr 's/@/-/g')
  str=$(echo ${str} | sedr 's/\//-/g')
  str=$(echo ${str} | sedr 's/:/-/g')
  str=$(echo ${str} | sedr 's/\./-/g')
  str=$(echo ${str} | sedr 's/_/-/g')
  str=$(echo ${str} | sedr 's/-+/-/g')
  echo "${str}" | tr '[:upper:]' '[:lower:]'
}

function formatCamelCase() {
  local str="${1}"
  formatKebabCase "${str}" | sedr 's/(-)([a-z])/\U\2/g'
}

function findSecondPattern() {
  local file="${1}"
  local first_pattern="${2}"
  local second_pattern="${3}"
  # Search for the line containing the first pattern, then find the first occurrence of the second pattern after that line
  awk '/'"${first_pattern}"'/ {found=1; next} found && /'"${second_pattern}"'/ {print; exit}' "${file}"
}

function findSecondOccurrence() {
  local file="${1}"
  local first_pattern="${2}"
  local second_pattern="${3}"
  # Search for the line containing the first pattern, then find the second occurrence of the second pattern after that line
  awk '/'"${first_pattern}"'/ {found=1; count=0; next} found && /'"${second_pattern}"'/ {count++; if (count == 2) {print; exit}}' "${file}"
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
  local label="${3:-${metric}}"
  read num unit <<< $(parseNumberAndUnit "$(findSecondPattern "${logFile}" "\[${stage}\]" "${metric}")")
  logMessage " - ${label}: ${num} ${unit}"

  if [[ "${metric}" == *"Rebuild"* ]]; then
    read num unit <<< $(parseNumberAndUnit "$(findSecondOccurrence "${logFile}" "\[${stage}\]" "${metric}")")
    logMessage " - ${label}#2: ${num} ${unit}"
  fi
}

function getMetricsStage() {
  local stage="${1}"
  findMetricStage "${stage}" "\(ProjectContext resolveConstraints\)" "Meteor(resolveConstraints)"
  findMetricStage "${stage}" "\(ProjectContext prepareProjectForBuild\)" "Meteor(prepareProjectForBuild)"
  findMetricStage "${stage}" "\(Build App\)" "Meteor(Build App)"
  findMetricStage "${stage}" "\(Server startup\)" "Meteor(Server startup)"

  if [[ "${stage}" == *"Rebuild"* ]]; then
    findMetricStage "${stage}" "\(Rebuild App\)" "Meteor(Rebuild App)"
  fi
}

function reportStageMetrics() {
  local stage="${1}"

  logBanner "==============================="
  logBanner "Metrics - ${stage}"
  logBanner "==============================="

  local metrics="$(getMetricsStage "${stage}")"

  logMessage "${metrics}"

  local totalNum=0
  while IFS= read -r line; do
    read num unit <<< $(parseNumberAndUnit "${line}")
    ((totalNum += num))
  done <<< "${metrics}"

  logMessage " * Total: ${totalNum} ${unit}"
  logMessage " * Total Process: $(eval "echo \${$(formatCamelCase "${stage}ProcessTime")}") ms"
}

function reportMetrics() {
  reportStageMetrics "Cold start"
  reportStageMetrics "Cache start"
  reportStageMetrics "Rebuild client"
  reportStageMetrics "Rebuild server"

  if [[ "${monitorSize}" == "true" ]] && cat "${appPath}/.meteor/versions" | grep -q "standard-minifier-js@"; then
    reportStageMetrics "Visualize bundle"
    logMeteorBundleSize
  fi
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

function appendLine() {
  echo "$1" >> "$2"
}

function removeLastLine() {
    sed -i '$ d' "$1"
}

function formatFile() {
   [[ -f "$1" ]] || { echo "File not found: $1"; return 1; }
   awk '{ printf (NR%5 ? $0 " │ " : $0 "\n") } END { if (NR%5) print "" }' "$1"
}

function monitorErrorsAndTimeout() {
    local file="$1"
    local interval="$2"
    local timeout="$3"
    local unchanged_time=0
    local last_line=""

    while true; do
        if [[ ! -f "$file" ]]; then
            echo "File $file not found!"
            sleep "$interval"
            continue
        fi

        new_line=$(tail -n 1 "$file")

        if [[ "$new_line" == "$last_line" ]]; then
            ((unchanged_time+=interval))
        else
            unchanged_time=0
        fi

        last_line="$new_line"

        if [[ "$unchanged_time" -ge "$timeout" ]]; then
            triggerExit
            break
        fi

        if grep -q "Your application is crashing" "$file" || grep -q "Exited with code" "$file"; then
            triggerExit
            break
        fi

        sleep "$interval"
    done
}

function triggerExit() {
  # Restore original stdout and stderr
  exec 1>&3 2>&4

  logError "==============================="
  logError " An error occurred when profiling. For more details, check at ${logFile}"
  logError "==============================="

  # Close the saved file descriptors
  exec 3>&- 4>&-

  builtin cd ${baseDir};

  killProcessByPort "${appPort}"
  kill -KILL -- -$$ >/dev/null

  exit 1
}

# Ensure proper cleanup on interrupt the process
function cleanup() {
  builtin cd ${baseDir};
  pkill -P $$

  sleep 2

  DISABLE_COLORS=true logScriptInfo
  DISABLE_COLORS=true logNpmPackages
  DISABLE_COLORS=true logMeteorPackages
  DISABLE_COLORS=true logMeteorVersion
  DISABLE_COLORS=true reportMetrics

  # Restore original stdout and stderr
  exec 1>&3 2>&4

  logNpmPackages
  logMeteorPackages
  logMeteorVersion
  reportMetrics
  logFullLogDetails

  # Close the saved file descriptors
  exec 3>&- 4>&-

  exit 0
}
trap cleanup SIGINT SIGTERM


loadEnv "${baseDir}/.env"

monitorErrorsAndTimeout "${logFile}" 2 60 &

# Prepare, run and wait meteor app
builtin cd "${appPath}"

logScriptInfo
logMeteorVersion
killProcessByPort "${appPort}"

logProgress "Profiling \"Cold start\"..."

logMessage "==============================="
logMessage "[Cold start]"
logMessage "==============================="
rm -rf "${appPath}/.meteor/local"
start_time_ms=$(date +%s%3N)
startMeteorApp
waitMeteorApp
end_time_ms=$(date +%s%3N)
total_sleep_ms=1000 # sleep leftovers
ColdStartProcessTime=$((end_time_ms - start_time_ms - total_sleep_ms))
killProcessByPort "${appPort}"
sleep 2

logProgress "Profiling \"Cache start\"..."

logMessage "==============================="
logMessage "[Cache start]"
logMessage "==============================="
start_time_ms=$(date +%s%3N)
startMeteorApp
waitMeteorApp
end_time_ms=$(date +%s%3N)
total_sleep_ms=1000 # sleep leftovers
CacheStartProcessTime=$((end_time_ms - start_time_ms - total_sleep_ms))
killProcessByPort "${appPort}"
sleep 2

logProgress "Profiling \"Rebuild client\"..."

logMessage "==============================="
logMessage "[Rebuild client]"
logMessage "==============================="
start_time_ms=$(date +%s%3N)
startMeteorApp
waitMeteorApp
appendLine "console.log('new line')" "${meteorClientEntrypoint}"
waitMeteorClientModified "#1"
waitMeteorApp
removeLastLine "${meteorClientEntrypoint}"
waitMeteorClientModified "#2"
waitMeteorApp
end_time_ms=$(date +%s%3N)
total_sleep_ms=5000 # sleep leftovers
RebuildClientProcessTime=$((end_time_ms - start_time_ms - total_sleep_ms))
killProcessByPort "${appPort}"
sleep 2

logProgress "Profiling \"Rebuild server\"..."

logMessage "==============================="
logMessage "[Rebuild server]"
logMessage "==============================="
start_time_ms=$(date +%s%3N)
startMeteorApp
waitMeteorApp
appendLine "console.log('new line')" "${meteorServerEntrypoint}"
waitMeteorServerModified "#1"
waitMeteorApp
removeLastLine "${meteorServerEntrypoint}"
waitMeteorServerModified "#2"
waitMeteorApp
end_time_ms=$(date +%s%3N)
total_sleep_ms=5000 # sleep leftovers
RebuildServerProcessTime=$((end_time_ms - start_time_ms - total_sleep_ms))
killProcessByPort "${appPort}"
sleep 2

if [[ "${monitorSize}" == "true" ]] && cat "${appPath}/.meteor/versions" | grep -q "standard-minifier-js@"; then
  logProgress "Profiling \"Visualize bundle\"..."

  logMessage "==============================="
  logMessage "[Visualize bundle]"
  logMessage "==============================="
  start_time_ms=$(date +%s%3N)
  visualizeMeteorAppBundle
  waitMeteorApp
  BundleSize=$(calculateMeteorAppBundleSize)
  end_time_ms=$(date +%s%3N)
  total_sleep_ms=1000 # sleep leftovers
  VisualizeBundleProcessTime=$((end_time_ms - start_time_ms - total_sleep_ms))
  killProcessByPort "${appPort}"
  sleep 2
  removeMeteorAppBundleVisualizer
fi

cleanup
