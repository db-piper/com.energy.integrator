'use strict';

const Homey = require('homey');
const abstractIntegrator = require('../../modules/abstractIntegrator')

class PowerIntegratorDevice extends abstractIntegrator {

  static _SUBSCRIPTION_SPECIFICATIONS = {
    'measure_power': {
      updateFunctionName: 'integrateTimedCapability' 
    }
  }

}

module.exports = PowerIntegratorDevice;