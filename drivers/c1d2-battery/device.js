'use strict';

const Homey = require('homey');
const abstractIntegrator = require('../../modules/abstractIntegrator');

module.exports = class PowerIntegratorDevice extends abstractIntegrator {

    static _SUBSCRIPTION_SPECIFICATIONS = {
    'measure_power': {
      updateFunctionName: 'integrateTimedCapability',
      splitters: [
        {test: (value) => value >= 0, label: 'charging'},
        {test: (value) => value < 0, label: 'discharging'}
      ] 
    },
    'measure_percent.battery': {
      updateFunctionName: 'forwardReflectedValue'
    },
    'measure_temperature': {
      updateFunctionName: 'forwardReflectedValue'
    },
    'measure_percent.health': {
      updateFunctionName: 'forwardReflectedValue'
    }
  }

};
