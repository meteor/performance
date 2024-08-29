#!/usr/bin/env bash

# app. Application directory name within ./apps/*
app="${1}"
if [[ -z "$app" ]]; then
  echo "Usage: deploy.sh <app_name>"
  exit 1;
fi

# Initialize script constants
baseDir="${PWD}"
appsDir="${baseDir}/apps"
appPath="${appsDir}/${app}"
appPort=3000

# Ensure proper cleanup on interrupt the process
function cleanup() {
    builtin cd "${appPath}"
    METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor remove apm-agent
    builtin cd ${baseDir};
    exit 0
}
trap cleanup SIGINT SIGTERM

# Prepare, run and wait meteor app
builtin cd "${appPath}"

METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor add apm-agent

rm -rf "${appPath}/.meteor/local"
hostname="${app//x/0}-perf.meteorapp.com"
echo "Deploying to ${hostname}"
if [[ -n "${METEOR_CHECKOUT_PATH}" ]]; then
  METEOR_PACKAGE_DIRS="${baseDir}/packages" ${METEOR_CHECKOUT_PATH}/meteor deploy ${hostname} --owner mdg
else
  METEOR_PACKAGE_DIRS="${baseDir}/packages" meteor deploy ${hostname} --owner mdg
fi
cleanup
