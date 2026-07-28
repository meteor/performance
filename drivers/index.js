// Plain-object dispatch table — mirrors the runner/_io.js facade so tests can
// mock.method individual drivers without fighting ESM namespace exports.

import { runArtilleryDriver } from './artillery.js';
import { runScriptDriver } from './script.js';
import { runColdStartDriver } from './cold-start.js';
import { runBundleSizeDriver } from './bundle-size.js';
import { runBuildProfileDriver } from './build-profile.js';

export const drivers = {
  runArtilleryDriver,
  runScriptDriver,
  runColdStartDriver,
  runBundleSizeDriver,
  runBuildProfileDriver,
};
