const pidusage = require('pidusage');
const path = require('path');
const minimist = require('minimist');

const MONITOR_INTERVAL = 1000;

// Parse and initialize args
const args = minimist(process.argv.slice(2), {});
let pid = args._[0] || process.pid;
let name = args._[1];
if (pid == null || name == null) {
    console.error('Usage: node monitor_cpu_ram.js <PID> <name>');
    process.exit(1);
}

// Initialize process state
const metrics = [];
let totalCpu = 0;
let totalMemory = 0;
let count = 0;

/* Helpers -------------------------------- */
const getCpuRamMetrics = async (pid) => {
    try {
        const stats = await pidusage(pid);
        metrics.push(stats);
        totalCpu += stats.cpu;
        totalMemory += stats.memory;

        if (count % 10 === 0) {
            console.log(name, "| Cpu", stats.cpu, "Memory", stats.memory);
        }
        count++;
    } catch (err) {
        logAverageMetrics();
        process.exit();
    }
};

const logAverageMetrics = () => {
    const avgCpu = totalCpu / count;
    const avgMemory = totalMemory / count;

    console.log(`----------\n${name}\nAverage CPU usage (%): ${avgCpu.toFixed(2)}\nAverage Memory usage (bytes): ${prettyBytes(avgMemory)}\n----------`);
};

const monitorCpuRam = () => {
    const intervalId = setInterval(() => {
        getCpuRamMetrics(pid);
    }, MONITOR_INTERVAL);

    process.on('SIGINT', () => {
        clearInterval(intervalId);
        logAverageMetrics();
        process.exit();
    });
    process.on('SIGTERM', () => {
        clearInterval(intervalId);
        logAverageMetrics();
        process.exit();
    });
};

const BYTE_UNITS = [
    'B',
    'kB',
    'MB',
    'GB',
    'TB',
    'PB',
    'EB',
    'ZB',
    'YB',
];

const BIBYTE_UNITS = [
    'B',
    'KiB',
    'MiB',
    'GiB',
    'TiB',
    'PiB',
    'EiB',
    'ZiB',
    'YiB',
];

const BIT_UNITS = [
    'b',
    'kbit',
    'Mbit',
    'Gbit',
    'Tbit',
    'Pbit',
    'Ebit',
    'Zbit',
    'Ybit',
];

const BIBIT_UNITS = [
    'b',
    'kibit',
    'Mibit',
    'Gibit',
    'Tibit',
    'Pibit',
    'Eibit',
    'Zibit',
    'Yibit',
];

const toLocaleString = (number, locale, options) => {
    let result = number;
    if (typeof locale === 'string' || Array.isArray(locale)) {
        result = number.toLocaleString(locale, options);
    } else if (locale === true || options !== undefined) {
        result = number.toLocaleString(undefined, options);
    }

    return result;
};

function prettyBytes(number, options) {
    if (!Number.isFinite(number)) {
        throw new TypeError(`Expected a finite number, got ${typeof number}: ${number}`);
    }

    options = {
        bits: false,
        binary: false,
        space: true,
        ...options,
    };

    const UNITS = options.bits
        ? (options.binary ? BIBIT_UNITS : BIT_UNITS)
        : (options.binary ? BIBYTE_UNITS : BYTE_UNITS);

    const separator = options.space ? ' ' : '';

    if (options.signed && number === 0) {
        return ` 0${separator}${UNITS[0]}`;
    }

    const isNegative = number < 0;
    const prefix = isNegative ? '-' : (options.signed ? '+' : '');

    if (isNegative) {
        number = -number;
    }

    let localeOptions;

    if (options.minimumFractionDigits !== undefined) {
        localeOptions = {minimumFractionDigits: options.minimumFractionDigits};
    }

    if (options.maximumFractionDigits !== undefined) {
        localeOptions = {maximumFractionDigits: options.maximumFractionDigits, ...localeOptions};
    }

    if (number < 1) {
        const numberString = toLocaleString(number, options.locale, localeOptions);
        return prefix + numberString + separator + UNITS[0];
    }

    const exponent = Math.min(Math.floor(options.binary ? Math.log(number) / Math.log(1024) : Math.log10(number) / 3), UNITS.length - 1);
    number /= (options.binary ? 1024 : 1000) ** exponent;

    if (!localeOptions) {
        number = number.toPrecision(3);
    }

    const numberString = toLocaleString(Number(number), options.locale, localeOptions);

    const unit = UNITS[exponent];

    return prefix + numberString + separator + unit;
}
/* End Helpers -------------------------------- */

// Start monitoring
monitorCpuRam({ pid });
