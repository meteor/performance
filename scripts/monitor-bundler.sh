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
  if [[ "$appResolved" == "$(echo ~)/"* ]] || [[ "$appResolved" == "/"* ]]; then
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

if [[ -n "${METEOR_LOG_DIR}" ]] && [[ "${METEOR_LOG_DIR}" == "/"* ]]; then
  logDir="${METEOR_LOG_DIR}"
elif [[ -n "${METEOR_LOG_DIR}" ]] && [[ "${METEOR_LOG_DIR}" == "~"* ]]; then
  logDir="${METEOR_LOG_DIR}"
elif [[ -n "${METEOR_LOG_DIR}" ]] && [[ -d "$appResolved" ]]; then
  logDir="${appPath}/${METEOR_LOG_DIR}"
elif [[ -n "${METEOR_LOG_DIR}" ]]; then
  logDir="${baseDir}/${METEOR_LOG_DIR}"
fi

logFile="${logDir}/${logName}-${app}-bundle.log"
monitorSize="${METEOR_BUNDLE_SIZE:-${METEOR_BUNDLE_SIZE_ONLY}}"
monitorSizeOnly="${METEOR_BUNDLE_SIZE_ONLY}"

monitorBuild="${METEOR_BUNDLE_BUILD}"
buildDirectory="/tmp/${logName}-${app}-dist"

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

function getMeteorNodeCmd() {
  local meteorNodeCmd
  if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
    meteorNodeCmd="${METEOR_CHECKOUT_PATH}/dev_bundle/bin/node"
  else
    meteorNodeCmd="${meteorCmd} node"
    local meteorPath="$(dirname $(readlink -f "$(which meteor)"))"
    # Try use node built-in directly to avoid delay on running "meteor node"
    if [[ -f "${meteorPath}/dev_bundle/bin/node" ]]; then
      meteorNodeCmd="${meteorPath}/dev_bundle/bin/node"
    fi
  fi
  echo "${meteorNodeCmd}"
}

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
  if [[ -n "${DISABLE_COLORS}" ]]; then
    logMessage "${1}"
    return
  fi
  logMessage "${PURPLE}${1}${NC}" ${@:2}
}

function logSpecial() {
  if [[ -n "${DISABLE_COLORS}" ]]; then
    logMessage "${1}"
    return
  fi
  logMessage "${CYAN}${1}${NC}" ${@:2}
}

function logError() {
  if [[ -n "${DISABLE_COLORS}" ]]; then
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
  if [[ -n "${monitorSize}" ]]; then
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

function sedi() {
  sed --version >/dev/null 2>&1 && sed -i -- "$@" || sed -i "" "$@"
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
  local context="${1}"
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
  local context="${1}"
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
  METEOR_PROFILE="${METEOR_PROFILE:-1}}" METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} run ${meteorOptions} &
}

function buildMeteorApp() {
  METEOR_PROFILE="${METEOR_PROFILE:-1}}" METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} build --directory "${buildDirectory}" ${meteorOptions}
}

function measureMeteorAppSize() {
  local oldPwd="${PWD}"
  cd "${buildDirectory}/bundle/programs/server"
  ${meteorCmd} npm install
}

function visualizeMeteorAppBundle() {
  METEOR_PROFILE="${METEOR_PROFILE:-1}}" METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} --extra-packages bundle-visualizer --production ${meteorOptions} &
}

function removeMeteorAppBundleVisualizer() {
  METEOR_PACKAGE_DIRS="${METEOR_PACKAGE_DIRS}" ${meteorCmd} remove bundle-visualizer
  sedi '/bundle-visualizer/d' "${appPath}/.meteor/versions"
}

function runScriptHelper() {
  local script="${1}"
  local scriptContext="$(dirname $0)"
  if [[ "${scriptContext}" =~ "./" ]]; then
    scriptContext="${baseDir}/${scriptContext}"
  fi
  $(getMeteorNodeCmd) "${scriptContext}/helpers/${script}" ${@:2}
}

function calculateMeteorAppBundleSize() {
  MONITOR_SIZE_URL="http://localhost:${appPort}/__meteor__/bundle-visualizer/stats" runScriptHelper "print-bundle-size.js"
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
  runScriptHelper "print-meteor-packages.js" "${appPath}" "npm"
  logBanner "==============================="
}

function logMeteorPackages() {
  logBanner "==============================="
  logBanner " Meteor packages"
  logBanner "==============================="
  runScriptHelper "print-meteor-packages.js" "${appPath}" "atmosphere"
  logBanner "==============================="
}

function logMeteorConfig() {
  logBanner "==============================="
  logBanner " Meteor config"
  logBanner "==============================="
  runScriptHelper "print-meteor-config.js" "${appPath}"
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

function formatEnvCase() {
  $(getMeteorNodeCmd) -e "console.log(\"${1}\".replace(/\s+(.)/g, (match, group1) => group1.toUpperCase()).replace(/\s+/g, ''))"
}

function isOSX() {
  [[ "$OSTYPE" == "darwin"* ]]
}

function getTime() {
  $(getMeteorNodeCmd) -e "console.log(String(Date.now()).trim())"
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

function getSize() {
  du -sh "$1" 2>/dev/null | sed -E 's/^([0-9.]+)([KMGTPE]?)[[:space:]]+.*$/\1 \2B/'
}

function measureMeteorAppSize() {
  local oldPwd="${PWD}"
  cd "${buildDirectory}/bundle/programs/server"
  ${meteorCmd} npm install
  cd "${oldPwd}"
  BundleSize="$(getSize "${buildDirectory}/bundle")"
}

function findMetricStage() {
  local stage="${1}"
  local metric="${2}"
  local label="${3:-${metric}}"
  read num unit <<< $(parseNumberAndUnit "$(findSecondPattern "${logFile}" "${stage}" "${metric}")")
  logMessage " - ${label}: ${num} ${unit}"
}

function getMetricsStage() {
  local stage="${1}"

  findMetricStage "\[${stage}\]" "\(ProjectContext resolveConstraints\)" "Meteor(resolveConstraints)"
  findMetricStage "\[${stage}\]" "\(ProjectContext prepareProjectForBuild\)" "Meteor(prepareProjectForBuild)"
  findMetricStage "\[${stage}\]" "\(Build App\)" "Meteor(Build App)"
  findMetricStage "\[${stage}\]" "\(Server startup\)" "Meteor(Server startup)"

  if [[ "${stage}" == *"Rebuild"* ]]; then
    findMetricStage "${stage}#1" "\(ProjectContext prepareProjectForBuild\)" "Meteor(prepareProjectForBuild #1)"
    findMetricStage "${stage}#1" "\(Rebuild App\)" "Meteor(Rebuild App #1)"
    if [[ "${stage}" == *"server"* ]]; then
      findMetricStage "${stage}#1" "\(Server startup\)" "Meteor(Server startup #1)"
    fi

    findMetricStage "${stage}#2" "\(ProjectContext prepareProjectForBuild\)" "Meteor(prepareProjectForBuild #2)"
    findMetricStage "${stage}#2" "\(Rebuild App\)" "Meteor(Rebuild App #2)"
    if [[ "${stage}" == *"server"* ]]; then
      findMetricStage "${stage}#2" "\(Server startup\)" "Meteor(Server startup #2)"
    fi
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

  logMessage " * Total(Meteor): ${totalNum} ${unit}"
  if [[ -n "${METEOR_MONITOR_PROCESS}" ]]; then
    local totalProcess="$(eval "echo \${$(formatEnvCase "${stage}ProcessTime")}")"
    logMessage " * Total(Process): ${totalProcess} ms (+$((totalProcess - totalNum)) ms)"
  fi

  if [[ "${stage}" == *"Rebuild"* ]]; then
    local totalRebuildOne=0
    while IFS= read -r line; do
      if [[ "${line}" == *"#1"* ]]; then
        read num unit <<< $(parseNumberAndUnit "${line}")
        ((totalRebuildOne += num))
      fi
    done <<< "${metrics}"
    logMessage " * Total(Rebuild #1): ${totalRebuildOne} ${unit}"

    local totalRebuildTwo=0
    while IFS= read -r line; do
      if [[ "${line}" == *"#2"* ]]; then
        read num unit <<< $(parseNumberAndUnit "${line}")
        ((totalRebuildTwo += num))
      fi
    done <<< "${metrics}"
    logMessage " * Total(Rebuild #2): ${totalRebuildTwo} ${unit}"
  fi
}

function reportBuildMetrics() {
  local stage="${1}"

  logBanner "==============================="
  logBanner "Metrics - ${stage}"
  logBanner "==============================="

  findMetricStage "\[${stage}\]" "\(meteor build\)" "Meteor(Total)"
}

function reportMetrics() {
  if [[ -z "${monitorSizeOnly}" ]] && [[ -z "${monitorBuild}" ]]; then
    reportStageMetrics "Cold start"
    reportStageMetrics "Cache start"
    reportStageMetrics "Rebuild client"
    reportStageMetrics "Rebuild server"
  fi

  if [[ -n "${monitorBuild}" ]]; then
    reportBuildMetrics "Cold build"
    reportBuildMetrics "Cache build"
    reportBuildMetrics "Final build"
  fi

  if [[ -z "${monitorBuild}" ]] && [[ -n "${monitorSize}" ]] && cat "${appPath}/.meteor/versions" | grep -q "standard-minifier-js@"; then
    reportStageMetrics "Visualize bundle"
    logMeteorBundleSize
  fi

  if [[ -n "${monitorBuild}" ]] && [[ -n "${monitorSize}" ]]; then
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

function sanitizeFilePath() {
  local file="$1"
  echo "$file" | sed 's/[^a-zA-Z0-9._-]/_/g' | sed 's/^\///'
}

function appendLine() {
  local file="$2"
  local content="$1"
  local sanitizedPath=$(sanitizeFilePath "$file")
  local backupFile="/tmp/appendLine_backup_${sanitizedPath}"

  # Create a backup of the original file
  if [[ -f "$file" ]]; then
    cp -p "$file" "$backupFile"
  else
    touch "$backupFile"
  fi

  # Ensure the file exists
  if [[ ! -f "$file" ]]; then
    touch "$file"
  fi

  # Check if the file is empty
  if [[ ! -s "$file" ]]; then
    # If the file is empty, just write the content with a newline
    printf "%s\n$content" > "$file"
  else
    # Check if the file ends with a newline
    local lastChar
    lastChar=$(tail -c1 "$file")

    # Append the content with a newline, adding an extra newline if needed
    if [[ "$lastChar" != $'\n' && "$lastChar" != "" ]]; then
      printf "\n%s\n$content" >> "$file"
    else
      printf "%s\n$content" >> "$file"
    fi
  fi
}

function removeLastLine() {
  local file="$1"
  local backupOnly="$2"
  # Use the same sanitized path as in appendLine to find the backup file
  local sanitizedPath=$(sanitizeFilePath "$file")
  local backupFile="/tmp/appendLine_backup_${sanitizedPath}"

  # Check if we have a backup file
  if [[ -f "$backupFile" ]]; then
    # Restore the original file from the backup
    cp -p "$backupFile" "$file"

    # Remove the backup file
    rm -f "$backupFile"
  elif [[ -z "$backupOnly" || "$backupOnly" != "true" ]]; then
    # Use sedi helper to remove the last line in-place if not in backup-only mode
    sedi -e '$d' "$file"
  fi
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
  kill -KILL $(ps -o pgid= -p $$ | grep -o '[0-9]*') >/dev/null

  exit 1
}

# Ensure proper cleanup on interrupt the process
function cleanup() {
  builtin cd ${baseDir};
  pkill -P $$

  sleep 2

  # Revert any files that were modified by appendLine
  if [[ -n "${meteorClientEntrypoint}" ]] && [[ -f "${meteorClientEntrypoint}" ]]; then
    removeLastLine "${meteorClientEntrypoint}" "true"
  fi
  if [[ -n "${meteorServerEntrypoint}" ]] && [[ -f "${meteorServerEntrypoint}" ]]; then
    removeLastLine "${meteorServerEntrypoint}" "true"
  fi

  logMessage

  DISABLE_COLORS=true logScriptInfo
  DISABLE_COLORS=true logNpmPackages
  DISABLE_COLORS=true logMeteorPackages
  DISABLE_COLORS=true logMeteorConfig
  DISABLE_COLORS=true logMeteorVersion
  DISABLE_COLORS=true reportMetrics

  # Restore original stdout and stderr
  exec 1>&3 2>&4

  logNpmPackages
  logMeteorPackages
  logMeteorConfig
  logMeteorVersion
  reportMetrics
  logFullLogDetails

  # Close the saved file descriptors
  exec 3>&- 4>&-

  exit 0
}
trap cleanup SIGINT SIGTERM

meteorClientEntrypoint="${METEOR_CLIENT_ENTRYPOINT:-$(runScriptHelper "get-meteor-entrypoint.js" "${appPath}" "client")}"
meteorServerEntrypoint="${METEOR_SERVER_ENTRYPOINT:-$(runScriptHelper "get-meteor-entrypoint.js" "${appPath}" "server")}"

if [[ -z "${monitorSizeOnly}" ]]  && [[ -z "${monitorBuild}" ]] && ([[ -z "${meteorClientEntrypoint}" ]] || [[ -z "${meteorServerEntrypoint}" ]]); then
  # Restore original stdout and stderr
  exec 1>&3 2>&4

  logError "==============================="
  logError " Not detected entrypoint files"
  logError " Please set the environment variables METEOR_CLIENT_ENTRYPOINT and METEOR_SERVER_ENTRYPOINT"
  logError "==============================="

  # Close the saved file descriptors
  exec 3>&- 4>&-

  exit 1
fi

loadEnv "${baseDir}/.env"

monitorErrorsAndTimeout "${logFile}" 2 ${METEOR_IDLE_TIMEOUT:-90} &

# Prepare, run and wait meteor app
builtin cd "${appPath}"

logScriptInfo
logMeteorVersion
logMessage "Node cmd: $(getMeteorNodeCmd)"

killProcessByPort "${appPort}"

if [[ -z "${monitorSizeOnly}" ]] && [[ -z "${monitorBuild}" ]]; then
  logProgress " * Profiling \"Cold start\"..."

  logMessage "==============================="
  logMessage "[Cold start]"
  logMessage "==============================="
  ${meteorCmd} reset --skip-cache
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="cold-start"
  startMeteorApp
  waitMeteorApp
  end_time_ms=$(getTime)
  ColdStartProcessTime=$((end_time_ms - start_time_ms))
  killProcessByPort "${appPort}"
  sleep 2

  logProgress " * Profiling \"Cache start\"..."

  logMessage "==============================="
  logMessage "[Cache start]"
  logMessage "==============================="
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="cache-start"
  startMeteorApp
  waitMeteorApp
  end_time_ms=$(getTime)
  CacheStartProcessTime=$((end_time_ms - start_time_ms))
  killProcessByPort "${appPort}"
  sleep 2

  logProgress " * Profiling \"Rebuild client\"..."

  logMessage "==============================="
  logMessage "[Rebuild client]"
  logMessage "==============================="
  logMessage "Client entrypoint: ${meteorClientEntrypoint}"
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="rebuild-client"
  startMeteorApp
  waitMeteorApp
  appendLine "console.log('trigger rebuild client');" "${meteorClientEntrypoint}"
  waitMeteorClientModified "Rebuild client#1"
  waitMeteorApp
  removeLastLine "${meteorClientEntrypoint}"
  waitMeteorClientModified "Rebuild client#2"
  waitMeteorApp
  end_time_ms=$(getTime)
  RebuildClientProcessTime=$((end_time_ms - start_time_ms))
  killProcessByPort "${appPort}"
  sleep 2

  logProgress " * Profiling \"Rebuild server\"..."

  logMessage "==============================="
  logMessage "[Rebuild server]"
  logMessage "==============================="
  logMessage "Server entrypoint: ${meteorServerEntrypoint}"
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="rebuild-server"
  startMeteorApp
  waitMeteorApp
  appendLine "console.log('trigger rebuild server');" "${meteorServerEntrypoint}"
  waitMeteorServerModified "Rebuild server#1"
  waitMeteorApp
  removeLastLine "${meteorServerEntrypoint}"
  waitMeteorServerModified "Rebuild server#2"
  waitMeteorApp
  end_time_ms=$(getTime)
  RebuildServerProcessTime=$((end_time_ms - start_time_ms))
  killProcessByPort "${appPort}"
  sleep 2
fi

if [[ -n "${monitorBuild}" ]]; then
  logProgress " * Profiling \"Cold build\"..."

  logMessage "==============================="
  logMessage "[Cold build]"
  logMessage "==============================="
  ${meteorCmd} reset --skip-cache
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="cold-build"
  buildMeteorApp
  end_time_ms=$(getTime)
  ColdBuildProcessTime=$((end_time_ms - start_time_ms))
  rm -rf "${buildDirectory}"
  sleep 1

  logProgress " * Profiling \"Cache build\"..."

  logMessage "==============================="
  logMessage "[Cache build]"
  logMessage "==============================="
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="cache-build"
  buildMeteorApp
  end_time_ms=$(getTime)
  CacheBuildProcessTime=$((end_time_ms - start_time_ms))
  rm -rf "${buildDirectory}"
  sleep 1

 logProgress " * Profiling \"Final build\"..."

  logMessage "==============================="
  logMessage "[Final build]"
  logMessage "==============================="
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="final-build"
  buildMeteorApp
  end_time_ms=$(getTime)
  FinalBuildProcessTime=$((end_time_ms - start_time_ms))
  if [[ -n "${monitorSize}" ]]; then
    measureMeteorAppSize
  fi
  rm -rf "${buildDirectory}"
  sleep 1
fi

if [[ -z "${monitorBuild}" ]] && [[ -n "${monitorSize}" ]] && cat "${appPath}/.meteor/versions" | grep -q "standard-minifier-js@"; then
  logProgress " * Profiling \"Visualize bundle\"..."

  logMessage "==============================="
  logMessage "[Visualize bundle]"
  logMessage "==============================="
  start_time_ms=$(getTime)
  export METEOR_INSPECT_CONTEXT="visualize-bundle"
  visualizeMeteorAppBundle
  waitMeteorApp
  BundleSize=$(calculateMeteorAppBundleSize)
  end_time_ms=$(getTime)
  VisualizeBundleProcessTime=$((end_time_ms - start_time_ms))
  killProcessByPort "${appPort}"
  sleep 2
  removeMeteorAppBundleVisualizer
fi

cleanup 
