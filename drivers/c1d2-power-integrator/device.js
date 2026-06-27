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

  /**
   * Integrate over a time period ending with thisTime and store newValue as the next timeseries value
   * @param   {number}   newValue                     New timeseries value the base for the next integration                    
   * @param   {number}   thisTime                     End time of the current integration period in epoch ms
   * @param   {string}   targetCapabilityName         Capability receiving the time series value
   * @param   {string}   label                        Used to tailor meter_power and meter_power.today capability names
   * @returns {boolean}                               Indicates values stored
   */
  async integrateTimedCapability(newValue, thisTime, targetCapabilityName, label) {
    await super.integrateTimedCapability(Math.abs(newValue), thisTime, targetCapabilityName, label);
  }

}

module.exports = PowerIntegratorDevice;