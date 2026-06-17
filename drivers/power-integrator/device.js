'use strict';

const Homey = require('homey');

class PowerIntegratorDevice extends Homey.Device {

  async onInit() {
    this.log(`Device [${this.getName()}] initializing...`);
    await this.driver.ready();
    this.capabilityInstance = null;
    const settings = this.getSettings();
    await this.configureCapabilitySubscription(
      settings.reflected_device_id,
      settings.reflected_capability_id,
    )
  }

  /**
   * Triggers automatically whenever the subscribed capability pushes an update
   */
  updateFromSubscribedCapability(newValue, thisTime) {

    const homeyInstance = this.homey;
    this.log(`PowerIntegratorDevice.updateFromSubscribedCapability: name: ${this.getName()} newValue: ${newValue} thisTime: ${thisTime}`)
    const lastTime = this.getCapabilityValue('measure_time');
    const lastPower = this.getCapabilityValue('measure_power') || 0;
    const firstTime = lastTime === null;
    //const thisTime = Date.now();

    const updates = [
      this.setCapabilityValue('measure_time', thisTime),
      this.setCapabilityValue('measure_power', newValue),
    ];

    if (!firstTime) {
      const lastEnergyTotal = this.getCapabilityValue('meter_power') || 0;
      const lastEnergyToday = this.getCapabilityValue('meter_power.today') || 0;
      const deltaTime = thisTime - lastTime;
      const deltaEnergy = (lastPower / 1000) * (deltaTime / 3600000);
      const isNewDay = homeyInstance.app.includesMidnight(lastTime, thisTime, homeyInstance.clock.getTimezone());
      updates.push(
        this.setCapabilityValue('meter_power', deltaEnergy + lastEnergyTotal),
        this.setCapabilityValue('meter_power.today', deltaEnergy + (isNewDay ? 0 : lastEnergyToday)),
        this.setCapabilityValue('measure_interval', deltaTime / 1000)
      )
    }

    Promise.all(updates)
      .catch(err => this.error('PowerIntegratorDevice.handleReflectedSignal: Error committing capability updates:', err));

    return true;
  }

  /**
   * Internal wrapper to cleanup and reconfigure the target capability subscription
   */
  async configureCapabilitySubscription(targetId, targetCapability) {
    // 1. Clean up old memory links if re-configuring or hot-reloading
    this.driver.coordinator.destroyCapabilitySubscription(this.capabilityInstance);
    this.capabilityInstance = null;

    try {
      // 2. Cascade down, get the return value, and assign it straight to this.xxx in the caller
      this.capabilityInstance = await this.driver.coordinator.setCapabilitySubscription(
        targetId,
        targetCapability,
        (val, time) => this.updateFromSubscribedCapability(val, time)
      );

      if (this.capabilityInstance) {
        this.log(`Active pipeline hook successfully assigned to this.capabilityInstance.`);
      }
    } catch (err) {
      this.error(`Device pipeline configuration error: ${err.message}`);
    }
  }

  /**
   * Automatically intercept whenever a user modifies the Advanced Settings panel
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings modification detected. Re-evaluating reflection pipeline...');

    if (changedKeys.includes('reflected_device_id') || changedKeys.includes('reflected_capability_id')) {
      this.log('[Device] Advanced settings changed. Re-binding pipeline...');

    await this.configureCapabilitySubscription(
        newSettings.reflected_device_id,
        newSettings.reflected_capability_id
      );
    }
    return true;
  }

  /**
   * Clean up connections if the device gets deleted by the user
   */
  async onDeleted() {
    this.driver.coordinator.destroyCapabilitySubscription(this.capabilityInstance);
    this.capabilityInstance = null;
    this.log('Device destroyed. Capability Subscription closed cleanly.');
  }

}

module.exports = PowerIntegratorDevice;