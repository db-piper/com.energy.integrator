'use strict';

const Homey = require('homey');
const abstractIntegrator = require('../../modules/abstractIntegrator')

class PowerIntegratorDevice extends abstractIntegrator {

  static _SUBSCRIPTION_SPECIFICATIONS = {
    'measure_power': {
      updateFunctionName: 'integrateTimedCapability',
      splitters: [
        {test: (value) => value >= 0, label: 'input'},
        {test: (value) => value < 0, label: 'output'}
      ] 
    }
  }

}

module.exports = PowerIntegratorDevice;