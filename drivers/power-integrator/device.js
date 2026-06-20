'use strict';

const Homey = require('homey');
const abstractIntegrator = require('../../modules/abstractIntegrator')

class PowerIntegratorDevice extends abstractIntegrator {

  /**
   * Triggered by the subscribed capability pushing an update
   * @param   {number}      newValue    The new value of the subscribed capability
   * @param   {number}      thisTime    The epoch milli-second when the capability was updated
   * @returns {boolean}                 Indicate target capability has been updated
   */
  updateFromSubscribedCapability(newValue, thisTime) {

    this.log(`PowerIntegratorDevice.updateFromSubscribedCapability: name: ${this.getName()} newValue: ${newValue} thisTime: ${thisTime}`)
    const lastTime = this.getCapabilityValue('measure_time');
    const lastPower = this.getCapabilityValue('measure_power') || 0;
    const firstTime = lastTime === null;

    const updates = [
      this.setCapabilityValue('measure_time', thisTime),
      this.setCapabilityValue('measure_power', newValue),
    ];

    if (!firstTime) {
      const lastEnergyTotal = this.getCapabilityValue('meter_power') || 0;
      const lastEnergyToday = this.getCapabilityValue('meter_power.today') || 0;
      const deltaTime = thisTime - lastTime;
      const deltaEnergy = (lastPower / 1000) * (deltaTime / 3600000);
      //const isNewDay = this.includesMidnight(lastTime, thisTime);
      updates.push(
        this.setCapabilityValue('meter_power', deltaEnergy + lastEnergyTotal),
        //this.setCapabilityValue('meter_power.today', deltaEnergy + (isNewDay ? 0 : lastEnergyToday)),
        this.setCapabilityValue('meter_power.today', deltaEnergy + lastEnergyToday),
        this.setCapabilityValue('measure_interval', deltaTime / 1000)
      )
    }

    Promise.all(updates)
      .catch(err => this.error('PowerIntegratorDevice.handleReflectedSignal: Error committing capability updates:', err));

    return true;
  }

}

module.exports = PowerIntegratorDevice;