export const tryMonitorExtras = async () => {
    if (process.env.MONITOR_EXTRAS) {
        await import('./monitoring');
    }
};
