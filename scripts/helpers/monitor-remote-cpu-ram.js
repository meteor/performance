const https = require('https');

// Function to fetch data from the API
function fetchData() {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({
            token: process.env.GALAXY_TOKEN,
            hostname: process.env.GALAXY_APP,
            region: "us-east-1",
            seriesName: "5s",
        });

        const options = {
            hostname: 'galaxy-beta.meteor.com',
            path: '/api/container-metrics',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
        };

        const req = https.request(options, (res) => {
            let responseBody = '';

            // Collect response data
            res.on('data', (chunk) => {
                responseBody += chunk;
            });

            // Handle the end of the response
            res.on('end', () => {
                try {
                    const jsonResponse = JSON.parse(responseBody);
                    resolve(jsonResponse);
                } catch (error) {
                    reject(new Error('Error parsing JSON response: ' + error));
                }
            });
        });

        // Handle request errors
        req.on('error', (error) => {
            reject(new Error('Request failed: ' + error));
        });

        // Write the request body
        req.write(requestBody);
        req.end();
    });
}

// Function to calculate averages
function calculateAverages(data) {
    const connectionsData = data[0].connections;
    const cpuData = data[0].cpu;
    const memoryData = data[0].memory;

    // Calculate average connections
    const totalConnections = connectionsData.reduce((acc, conn) => acc + conn.connections, 0);
    const averageConnections = totalConnections / connectionsData.length;

    // Calculate average CPU percentage
    const totalCpuPercentage = cpuData.reduce((acc, cpu) => acc + cpu.percentage, 0);
    const averageCpuPercentage = totalCpuPercentage / cpuData.length;

    // Calculate average memory usage
    const totalMemoryUsage = memoryData.reduce((acc, mem) => acc + mem.value, 0);
    const averageMemoryUsage = totalMemoryUsage / memoryData.length;

    return {
        averageConnections,
        averageCpuPercentage,
        averageMemoryUsage,
    };
}

// Main function to execute the script
async function main() {
    try {
        const data = await fetchData();
        const averages = calculateAverages(data);

        console.log('---- Galaxy Container metrics ----');
        console.log('Average CPU Percentage:', averages.averageCpuPercentage);
        console.log('Average Memory Usage:', averages.averageMemoryUsage);

    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

main();
