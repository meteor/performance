import { Monti } from 'meteor/montiapm:agent';

if (Meteor.isProduction) {
    Monti.startContinuousProfiling();
}
