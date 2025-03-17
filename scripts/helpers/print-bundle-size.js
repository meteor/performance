function calculateSize(node) {
  let totalSize = 0;
  let packageSizes = [];

  // If the node is a package and hasn't been visited, calculate its size
  if (node.size) {
    totalSize += node.size;
  }

  // If the node has children, process each child
  if (node.children && node.children.length > 0) {
    for (let child of node.children) {
      const { totalSize: childSize, packageSizes: childPackageSizes } = calculateSize(child);

      // Add the child's size to the total size
      totalSize += childSize;

      // Append the package sizes from this child
      packageSizes.push(...childPackageSizes);
    }
  }

  if (node.type === 'package') {
    packageSizes.push([node.name, totalSize]);
  }

  return { totalSize, packageSizes };
}

function processRoot(node) {
  let sizeSummary = {};
  if (node.children && node.children.length > 0) {
    for (let child of node.children) {
      if (child.type === 'bundle') {

        // Calculate the size of each "bundle" and print its total size
        const { totalSize: childSize, packageSizes } = calculateSize(child);

        sizeSummary['Total Size'] = {
          ...(sizeSummary['Total Size'] || {}),
          [child.name]: `${childSize} (${(childSize / 1000 / 1000).toFixed(2)} MB)`
        };

        // Print the breakdown of package sizes under this bundle
        packageSizes.forEach(([packageName, size]) => {
          sizeSummary[packageName] = {
            ...(sizeSummary[packageName] || {}),
            [child.name]: size != null ? `${size} (${(size / 1000).toFixed(2)} KB)` : '-',
          };
        });
      }
    }
  }

  return sizeSummary;
}

const https = require('https');
const http = require('http');

function fetchData() {
  return new Promise((resolve, reject) => {
    const url = process.env.MONITOR_SIZE_URL;
    const protocol = url.startsWith('https') ? https : http; // Check if URL starts with https

    const req = protocol.request(url, (res) => {
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

    req.end();
  });
}

async function main() {
  try {
    const data = await fetchData();
    const sizeSummary = processRoot(data);
    console.table(sizeSummary);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

main();
