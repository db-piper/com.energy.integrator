'use strict';

const Homey = require('homey');

module.exports = class abstractIntegrator extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`Device [${this.getName()}] initializing...`);
    await this.driver.ready();
    const settings = this.getSettings();
    const configObject = JSON.parse(settings.reflection_configuration_json || '{}');
    await this.setupReflectionHandlers(configObject);
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

      const configObject = JSON.parse(newSettings.reflection_configuration_json || '{}');

      await this.setupReflectionHandlers(configObject);
    }

    return true;
  }

  /**
   * onDeleted is called when the user deleted the device - clean up the subscriptions.
   */
  async onDeleted() {
    await this.onUninit();
    this.log('Device destroyed. Capability Subscription closed cleanly.');
  }

  /**
   * Triggered automatically by Homey when the device is unloaded (app update, restart, shutdown).
   */
  async onUninit() {
    this.log(`Device [${this.getName()}] tearing down. Cleaning up active subscriptions...`);

    if (this._activeSubscriptions) {
      const activeKeys = Object.keys(this._activeSubscriptions);

      for (const targetCapabilityKey of activeKeys) {
        try {
          this.log(`[SUPERCLASS TEARDOWN] Destroying stream hook for capability: ${targetCapabilityKey}`);

          // Hand the handle over to the coordinator for explicit destruction
          this.driver.coordinator.destroyCapabilitySubscription(this._activeSubscriptions[targetCapabilityKey]);

          delete this._activeSubscriptions[targetCapabilityKey];
        } catch (err) {
          this.error(`[SUPERCLASS TEARDOWN] Failed to cleanly sever stream for ${targetCapabilityKey}: ${err.message}`);
        }
      }
    }

    this.log(`Device [${this.getName()}] lifecycle stream hooks severed cleanly.`);
  }

  /**
   * Universal Setup: Provisions listener hooks for all user-configured reflections
   */
  async setupReflectionHandlers(configObject) {
    this.log(`[abstractIntegrator.reflectionHandlerSetup] Starting reflection handler setup`);

    try {
      const manifest = this.constructor._SUBSCRIPTION_SPECIFICATIONS || {};
      this._activeSubscriptions = this._activeSubscriptions || {};

      // 2. Iterate dynamically over the active configurations chosen during pairing
      for (const targetCapabilityKey of Object.keys(configObject)) {
        // Validation Guard: Ensure this capability is declared in our spec manifest
        this.log(`[abstractIntegrator.setupReflectionHandlers]: Processing capability ${targetCapabilityKey}`);
        if (!manifest[targetCapabilityKey]) {
          this.error(`[abstractIntegrator.reflectionHandlerSetup] Skipped "${targetCapabilityKey}": Not declared in _SUBSCRIPTION_SPECIFICATIONS.`);
          continue;
        }

        const targetMapping = configObject[targetCapabilityKey];
        if (!targetMapping || !targetMapping.reflected_device_id || !targetMapping.reflected_capability_id) {
          continue;
        }

        const { reflected_device_id, reflected_capability_id } = targetMapping;

        // 3. Clean up any existing stale subscription token for this path
        if (this._activeSubscriptions[targetCapabilityKey]) {
          this.log(`[abstractIntegrator.reflectionHandlerSetup] Removing existing subscription for: ${targetCapabilityKey}`);
          this.driver.coordinator.destroyCapabilitySubscription(this._activeSubscriptions[targetCapabilityKey]);
          delete this._activeSubscriptions[targetCapabilityKey];
        }

        this.log(`[abstractIntegrator.reflectionHandlerSetup] Setting reflection handler for: [${reflected_device_id}].${reflected_capability_id}}`);

        // 4. Bind the listener directly to our universal router
        const subscriptionHandle = await this.driver.coordinator.setCapabilitySubscription(
          reflected_device_id,
          reflected_capability_id,
          (newValue, time) => {
            // Note: time defaults to Date.now() if the upstream packet lacks an explicit epoch timestamp
            const eventTime = time || Date.now();
            this.processReflection(newValue, eventTime, targetCapabilityKey);
          }
        );

        if (subscriptionHandle) {
          this._activeSubscriptions[targetCapabilityKey] = subscriptionHandle;
        }
      }

      this.log(`[abstractIntegrator.setupReflectionHandlers] All reflection handlers setup successfully.`);
    } catch (err) {
      this.error(`[abstractIntegrator.setupReflectionHandlers] Reflection setup failure: ${err.message}`);
    }
  }

  /**
   * Route the reflected value to the nominated capability via the specified method and rule set
   * @param   {number}        newValue          The value with which to update the capability
   * @param   {number}        thisTime          The time of the event in epoch milliseconds
   * @param   {string}        capabilityId      The unlabelled name of the capability to be updated
   */
  async processReflection(newValue, thisTime, capabilityId) {
    const spec = this.constructor._SUBSCRIPTION_SPECIFICATIONS[capabilityId];

    const strategyName = spec ? spec.updateFunctionName : 'updateRawCapability';
    const splitters = (spec && spec.splitters) ? spec.splitters : [{ test: (v) => true, label: '' }];

    const valueToSet = this.isInvertValue(capabilityId) ? 0-newValue : newValue; 

    for (const rule of splitters) {
      if (rule.test(valueToSet)) {
        const label = rule.label || '';
        if (typeof this[strategyName] === 'function') {
          return this[strategyName](valueToSet, thisTime, capabilityId, label);
        } else {
          this.error(`[Router] Strategy method "${strategyName}" missing.`);
        }
        break;
      }
    }
  }

  isInvertValue(capabilityId) {
    try {
      const rawConfig = this.getSetting('reflection_configuration_json');
      if (!rawConfig) return false;
      const configuration = JSON.parse(rawConfig);
      return configuration?.[capabilityId]?.invert_power_sign || false;
    } catch (err) {
      this.error(`[abstractIntegrator.isInvertValue] Failed to parse reflection configuration JSON:`, err);
      return false;
    }
  }

  /**
   * Standardized supervisor method triggered exclusively by the App orchestrator
   */
  async executeMidnightReset() {
    this.log(`[abstractIntegrator] Resetting capabilities for [${this.getName()}]...`);

    try {
      const targetResets = [];
      const capabilities = this.getCapabilities();
      for (const capability of capabilities) {
        if (capability.endsWith('_today') || capability.includes('.today')) {
          if (this.getCapabilityValue(capability) !== 0) {
            targetResets.push(this.setCapabilityValue(capability, 0));
          }
        }
      }
      await Promise.all(targetResets);
    } catch (err) {
      this.error(`[abstractIntegrator.executeMidnightReset] Execution failed for [${this.getName()}]:`, err);
      throw err; // Propagate up to app logs
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
    this.log(`abstractIntegrator.integrateTimedCapability: device: ${this.getName()} label: ${label} newValue: ${newValue} thisTime: ${thisTime}`);
    const [baseName, subName = ''] = targetCapabilityName.split('.');
    // 1. Time & Interval tracking matches the sensor subName exactly
    const timeBaseName = subName ? `measure_time.${subName}` : 'measure_time';
    const measureIntervalName = subName ? `measure_interval.${subName}` : 'measure_interval';

    // 2. Build the unified sub-key for the energy capabilities
    // Filters out empty strings and joins remaining tokens with an underscore
    // e.g. ['', 'import'] -> 'import' | ['foo', ''] -> 'foo' | ['foo', 'import'] -> 'foo_import'
    const energySubKey = [subName, label].filter(Boolean).join('_');

    // 3. Resolve meter capability names based on whether a unified sub-key exists
    const meterPowerName = energySubKey ? `meter_power.${energySubKey}` : 'meter_power';
    const meterPowerTodayName = energySubKey ? `meter_power.${energySubKey}_today` : 'meter_power.today';

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

  async forwardReflectedValue(newValue, thisTime, targetCapabilityName, label) {
    await this.setCapabilityValue(targetCapabilityName, newValue);
    return true;
  }
}