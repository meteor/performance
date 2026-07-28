// Prints every scenario, every app, and the resolved Meteor source.
// Pure: takes config and a resolved source as inputs, writes to stdout.

export function runList({ config, source }) {
  console.log('\nAvailable scenarios:');
  for (const [name, s] of Object.entries(config.scenarios)) {
    console.log(`  ${name.padEnd(20)} ${s.description}`);
  }
  console.log('\nAvailable apps:');
  for (const [name, a] of Object.entries(config.apps)) {
    console.log(`  ${name.padEnd(20)} ${a.description}`);
  }
  console.log(`\nMeteor source: ${source.mode}`);
  if (source.mode === 'checkout') console.log(`  Checkout: ${source.checkoutPath}`);
  console.log(`  Version: ${source.version}  SHA: ${source.sha}\n`);
}
