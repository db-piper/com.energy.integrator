'use strict';

const Homey = require('homey');

module.exports = class abstractIntegrator extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`Device [${this.getName()}] initializing...`);
    await this.driver.ready();
    await this.compileAllSubscriptions();
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

    // If the centralized configuration map changes, trigger a clean re-compile
    if (changedKeys.includes('reflection_configuration_json')) {
      this.log(`Device configuration map updated. Re-compiling telemetry paths...`);

      await this.compileAllSubscriptions();
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
   * Establish the reflections declared in the device's manifest
   */
  async compileAllSubscriptions() {
    this.log(`[SUPERCLASS COMPILER] Initializing full pipeline compilation...`);

    try {
      const manifest = this.constructor._SUBSCRIPTION_SPECIFICATIONS || {};
      const manifestKeys = Object.keys(manifest);

      if (manifestKeys.length === 0) return;

      const settings = this.getSettings();
      let configObject = {};
      try {
        configObject = JSON.parse(settings.reflection_configuration_json || '{}');
      } catch (e) {
        this.error(`[SUPERCLASS COMPILER] Critical: Failed parsing configuration JSON string.`);
        return;
      }

      // Initialize our tracking dictionary if it doesn't exist yet
      this._activeSubscriptions = this._activeSubscriptions || {};

      // Pure loop orchestrator—no cleanup responsibility here!
      for (const targetCapabilityKey of manifestKeys) {
        const updateFunctionName = manifest[targetCapabilityKey]?.updateFunctionName;
        await this.compileSingleSubscription(targetCapabilityKey, updateFunctionName, configObject);
      }

    } catch (err) {
      this.error(`[SUPERCLASS COMPILER] High-level orchestration failure: ${err.message}`);
    }
  }

  /**
   * Establish the reflection for the target capability using the function and defined by the configuration object
   * @param {string}            targetCapabilityKey    The name of the capability receiving reflected data
   * @param {string}            updateFunctionName     The name of the callback function when reflected data changes
   * @param {Object}            configObject           Relection mappings defined during onPair or onRepair
   */
  async compileSingleSubscription(targetCapabilityKey, updateFunctionName, configObject) {
    if (!updateFunctionName || typeof this[updateFunctionName] !== 'function') {
      this.error(`[COMPILER LEAF] Aborted for "${targetCapabilityKey}": Method missing.`);
      return;
    }

    const targetMapping = configObject[targetCapabilityKey];
    if (!targetMapping || !targetMapping.reflected_device_id || !targetMapping.reflected_capability_id) {
      return;
    }

    const { reflected_device_id, reflected_capability_id } = targetMapping;

    try {
      // 1. Clean up the specific previous instance right here before replacing it!
      if (this._activeSubscriptions[targetCapabilityKey]) {
        this.log(`[COMPILER LEAF] Tearing down existing subscription for: ${targetCapabilityKey}`);
        this.driver.coordinator.destroyCapabilitySubscription(this._activeSubscriptions[targetCapabilityKey]);
        delete this._activeSubscriptions[targetCapabilityKey];
      }

      this.log(`[COMPILER LEAF] Compiling pipeline: [${reflected_device_id}].${reflected_capability_id} ──► this.${updateFunctionName}()`);

      // 2. Provision and store the subscription token keyed by its capability name
      const subscriptionHandle = await this.driver.coordinator.setCapabilitySubscription(
        reflected_device_id,
        reflected_capability_id,
        (val, time) => {
          this[updateFunctionName](val, time, targetCapabilityKey);
        }
      );

      if (subscriptionHandle) {
        this._activeSubscriptions[targetCapabilityKey] = subscriptionHandle;
        this.log(`[COMPILER LEAF] Active pipeline hook successfully assigned for ${targetCapabilityKey}.`);
      }

    } catch (err) {
      this.error(`[COMPILER LEAF] Execution mapping failed for ${targetCapabilityKey}: ${err.message}`);
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

  async integrateTimedCapability(newValue, thisTime, targetCapabilityName) {
    this.log(`abstractIntegrator.integrateTimedCapability: device: ${this.getName()} targetCapabilityName: ${targetCapabilityName}`);
    this.log(`abstractIntegrator.integrateTimedCapability: newValue: ${newValue} thisTime: ${thisTime}`);
    const [baseName, subName = ''] = targetCapabilityName.split('.');
    const dottedSubName = (subName !== '') ? `.${subName}` : '';
    const todayExtension = (subName !== '') ? '_today' : '.today';
    const meterPowerName = `meter_power${dottedSubName}`;
    const meterPowerTodayName = `${meterPowerName}${todayExtension}`;
    const timeBaseName = `measure_time${dottedSubName}`;
    const measureIntervalName = `measure_interval${dottedSubName}`;
    this.log(`abstractIntegrator.integrateTimedCapability: meterPowerName ${meterPowerName} meterPowerTodayName ${meterPowerTodayName}`);
    this.log(`abstractIntegrator.integrateTimedCapability: timeBaseName ${timeBaseName} measureIntervalName ${measureIntervalName}`);

    const lastTime = this.getCapabilityValue(timeBaseName);
    const lastPower = this.getCapabilityValue(targetCapabilityName) || 0;
    const firstTime = lastTime === null;

    const updates = [
      this.setCapabilityValue(timeBaseName, thisTime),
      this.setCapabilityValue(targetCapabilityName, newValue),
    ];

    if (!firstTime) {
      const lastEnergyTotal = this.getCapabilityValue(meterPowerName) || 0;
      const lastEnergyToday = this.getCapabilityValue(meterPowerTodayName) || 0;
      const deltaTime = thisTime - lastTime;
      const deltaEnergy = (lastPower / 1000) * (deltaTime / 3600000);
      updates.push(
        this.setCapabilityValue(meterPowerName, deltaEnergy + lastEnergyTotal),
        this.setCapabilityValue(meterPowerTodayName, deltaEnergy + lastEnergyToday),
        this.setCapabilityValue(measureIntervalName, deltaTime / 1000)
      )
    }

    Promise.all(updates)
      .catch(err => this.error('PowerIntegratorDevice.handleReflectedSignal: Error committing capability updates:', err));

    return true;

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