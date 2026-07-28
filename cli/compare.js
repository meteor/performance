// Reads two result JSON files, runs the regression detector, prints markdown
// or JSON, and exits with the report's pass/fail status.

import { io } from '../runner/_io.js';
import { compare, toMarkdown } from '../reporters/regression-detector.js';

function readResultFile(filePath, label) {
  let raw;
  try {
    raw = io.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Could not read ${label} file at ${filePath}: ${err.message}. Check the path or run 'bench.js run' first to produce it.`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Could not parse ${label} file at ${filePath} as JSON: ${err.message}. Is the file a valid bench.js result?`);
    process.exit(1);
  }
}

export function runCompare({ values }) {
  const baselinePath = values.baseline;
  const targetPath = values.target;
  const format = values.format || 'markdown';

  if (!baselinePath || !targetPath) {
    console.error('Usage: node bench.js compare --baseline <file> --target <file>');
    process.exit(1);
  }

  const baseline = readResultFile(baselinePath, 'baseline');
  const target = readResultFile(targetPath, 'target');
  const report = compare(baseline, target);

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(toMarkdown(report));
  }

  process.exit(report.summary.passed ? 0 : 1);
}
