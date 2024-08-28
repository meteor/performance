if (Meteor.isServer) {
  import './ah';
  import { EventLoopMonitor } from './elm';

  const monitor = new EventLoopMonitor(100);
  monitor.start();
}
