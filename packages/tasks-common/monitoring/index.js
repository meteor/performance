if (Meteor.isServer) {
  import './ah';
  import { EventLoopMonitor } from './elm';
  import './net';
  
  const monitor = new EventLoopMonitor(100);
  monitor.start();
}
