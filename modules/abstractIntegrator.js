'use strict';

const Homey = require('homey');

module.exports = class abstractIntegrator extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
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
   * onSettings is called when the user updates the device's settings.
   * @param   {object}                event             The onSettings event data
   * @param   {object}                event.oldSettings The old settings object
   * @param   {object}                event.newSettings The new settings object
   * @param   {string[]}              event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>}                    Return a custom message that will be displayed
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
   * onDeleted is called when the user deleted the device - clean up the subscriptions.
   */
  async onDeleted() {
    this.driver.coordinator.destroyCapabilitySubscription(this.capabilityInstance);
    this.capabilityInstance = null;
    this.log('Device destroyed. Capability Subscription closed cleanly.');
  }

  /**
   * Internal wrapper to cleanup and reconfigure the capability targeted by the subscription
   * @param   {string}    targetDeviceId         Id of the device holding the targeted capability
   * @param   {string}    targetCapabilityName   Name of the targeted capability
   */
  async configureCapabilitySubscription(targetDeviceId, targetCapabilityName) {
    // 1. Clean up old memory links if re-configuring or hot-reloading
    this.driver.coordinator.destroyCapabilitySubscription(this.capabilityInstance);
    this.capabilityInstance = null;

    try {
      // 2. Cascade down, get the return value, and assign it straight to this.xxx in the caller
      this.capabilityInstance = await this.driver.coordinator.setCapabilitySubscription(
        targetDeviceId,
        targetCapabilityName,
        (val, time) => {
          if (typeof this.updateFromSubscribedCapability === 'function') {
            this.updateFromSubscribedCapability(val, time);
          } else {
            this.error(`Handler missing on child device class context.`);
          }
        });

      if (this.capabilityInstance) {
        this.log(`Active pipeline hook successfully assigned to this.capabilityInstance.`);
      }
    } catch (err) {
      this.error(`Device pipeline configuration error: ${err.message}`);
    }
  }

  /**
   * Standardized supervisor method triggered exclusively by the App orchestrator
   */
  async executeMidnightReset() {
    this.log(`[abstractIntegrator] Resetting capabilities for [${this.getName()}]...`);
    
    try {
      const targetResets = [];

      // Phase 1 POC (Ready to be upgraded to your ReflectionArray loop next)
      if (this.hasCapability('meter_power.today')) {
        targetResets.push(this.setCapabilityValue('meter_power.today', 0));
      }

      await Promise.all(targetResets);
    } catch (err) {
      this.error(`[abstractIntegrator] Execution failed for [${this.getName()}]:`, err);
      throw err; // Propagate up to app logs
    }
  }

  // /**
  //  * Checks if the interval between two epoch millisecond timestamps includes midnight,
  //  * dynamically respecting the Homey user's local timezone and DST settings.
  //  * @param   {number} epochMillis1 -   First timestamp
  //  * @param   {number} epochMillis2 -   Second timestamp
  //  * @param   {string} homeyTimeZone -  Timezone string set in Homey
  //  * @returns {boolean}                 True if the interval crosses local midnight
  //  */
  // includesMidnight(epochMillis1, epochMillis2) {

  //   const homeyTimeZone = this.homey.clock.getTimezone();
  //   const d1 = new Date(epochMillis1);
  //   const d2 = new Date(epochMillis2);

  //   // 2. Format the dates utilizing Homey's local timezone
  //   const formatter = new Intl.DateTimeFormat('en-CA', {
  //     timeZone: homeyTimeZone,
  //     year: 'numeric',
  //     month: 'numeric',
  //     day: 'numeric'
  //   });

  //   const dateStr1 = formatter.format(d1);
  //   const dateStr2 = formatter.format(d2);

  //   // 3. If the calendar dates match, midnight was not crossed.
  //   return dateStr1 !== dateStr2;
  // }

}