const net = require('net');

let bytesSent = 0;
let bytesReceived = 0;

const originalWrite = net.Socket.prototype.write;

net.Socket.prototype.write = function(data) {
  bytesSent += data.length;
  return originalWrite.apply(this, arguments);
};

/**
 * Disabled since for some reason we get duplicated insert complaints from mongo when it is enabled
 */

// console.log(net.Socket.prototype)

// const originalOn = net.Socket.prototype.on;

// net.Socket.prototype.on = function(event, listener) {
//   if (this._intercepted) return originalOn.apply(this, arguments);

//   if (event === 'data') {
//     this._intercepted = true;

//     return originalOn.call(this, event, function () {
//         console.trace()
//         bytesReceived += arguments[0].length;
//         listener.apply(this, arguments);
//     });
//   }

//   return originalOn.apply(this, arguments);
// };


setInterval(() => {
  console.log(`Bytes sent: ${bytesSent}\t Bytes received: ${bytesReceived}`);
}, 5000);