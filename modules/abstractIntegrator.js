'use strict';

const Homey = require('homey');

module.exports = class abstractIntegrator extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`Device [${this.getName()}] initializing...`);
    await this.driver.ready();
    await this.setupReflectionHandlers();
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

      await this.setupReflectionHandlers();
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
  async setupReflectionHandlers() {
    this.log(`[abstractIntegrator.reflectionHandlerSetup] Starting reflection handler setup`);

    try {
      // 1. Safely retrieve and parse user pairing configuration
      const settings = this.getSettings();
      let configObject = {};
      try {
        configObject = JSON.parse(settings.reflection_configuration_json || '{}');
      } catch (e) {
        this.error(`[abstractIntegrator.reflectionHandlerSetup] Critical: Failed parsing configuration JSON string.`);
        return;
      }

      const manifest = this.constructor._SUBSCRIPTION_SPECIFICATIONS || {};
      this._activeSubscriptions = this._activeSubscriptions || {};

      // 2. Iterate dynamically over the active configurations chosen during pairing
      for (const targetCapabilityKey of Object.keys(configObject)) {

        // Validation Guard: Ensure this capability is declared in our spec manifest
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

      this.log(`[abstractIntegrator.reflectionHandlerSetup] All reflection handlers setup successfully.`);
    } catch (err) {
      this.error(`[abstractIntegrator.reflectionHandlerSetup] Reflection setup failure: ${err.message}`);
    }
  }

  /**
   * Route the reflected value to the nominated capability via the specified method and rule set
   * @param   {number}        newValue          The value with which to update the capability
   * @param   {number}        thisTime          The time of the event in epoch milliseconds
   * @param   {string}        capabilityId      The unlabelled name of the capability to be updated
   */
  /**
   * Universal Core Router: Evaluates conditions and passes raw data downstream
   */
  async processReflection(newValue, thisTime, capabilityId) {
    const spec = this.constructor._SUBSCRIPTION_SPECIFICATIONS[capabilityId];

    const strategyName = spec ? spec.updateFunctionName : 'updateRawCapability';
    const splitters = (spec && spec.splitters) ? spec.splitters : [{ test: (v) => true, label: '' }];

    for (const rule of splitters) {
      if (rule.test(newValue)) {
        const label = rule.label || '';

        // Pass newValue completely raw so the strategy function has full context
        if (typeof this[strategyName] === 'function') {
          return this[strategyName](newValue, thisTime, capabilityId, label);
        } else {
          this.error(`[Router] Strategy method "${strategyName}" missing.`);
        }
        break;
      }
    }
  }

  // /**
  //  * Establish the reflections declared in the device's manifest
  //  */
  // async compileAllSubscriptions() {
  //   this.log(`[SUPERCLASS COMPILER] Initializing full pipeline compilation...`);

  //   try {
  //     const manifest = this.constructor._SUBSCRIPTION_SPECIFICATIONS || {};
  //     const manifestKeys = Object.keys(manifest);

  //     if (manifestKeys.length === 0) return;

  //     const settings = this.getSettings();
  //     let configObject = {};
  //     try {
  //       configObject = JSON.parse(settings.reflection_configuration_json || '{}');
  //     } catch (e) {
  //       this.error(`[SUPERCLASS COMPILER] Critical: Failed parsing configuration JSON string.`);
  //       return;
  //     }

  //     // Initialize our tracking dictionary if it doesn't exist yet
  //     this._activeSubscriptions = this._activeSubscriptions || {};

  //     // Pure loop orchestrator—no cleanup responsibility here!
  //     for (const targetCapabilityKey of manifestKeys) {
  //       const updateFunctionName = manifest[targetCapabilityKey]?.updateFunctionName;
  //       await this.compileSingleSubscription(targetCapabilityKey, updateFunctionName, configObject);
  //     }

  //   } catch (err) {
  //     this.error(`[SUPERCLASS COMPILER] High-level orchestration failure: ${err.message}`);
  //   }
  // }

  // /**
  //  * Establish the reflection for the target capability using the function and defined by the configuration object
  //  * @param {string}            targetCapabilityKey    The name of the capability receiving reflected data
  //  * @param {string}            updateFunctionName     The name of the callback function when reflected data changes
  //  * @param {Object}            configObject           Relection mappings defined during onPair or onRepair
  //  */
  // async compileSingleSubscription(targetCapabilityKey, updateFunctionName, configObject) {
  //   if (!updateFunctionName || typeof this[updateFunctionName] !== 'function') {
  //     this.error(`[COMPILER LEAF] Aborted for "${targetCapabilityKey}": Method missing.`);
  //     return;
  //   }

  //   const targetMapping = configObject[targetCapabilityKey];
  //   if (!targetMapping || !targetMapping.reflected_device_id || !targetMapping.reflected_capability_id) {
  //     return;
  //   }

  //   const { reflected_device_id, reflected_capability_id } = targetMapping;

  //   try {
  //     // 1. Clean up the specific previous instance right here before replacing it!
  //     if (this._activeSubscriptions[targetCapabilityKey]) {
  //       this.log(`[COMPILER LEAF] Tearing down existing subscription for: ${targetCapabilityKey}`);
  //       this.driver.coordinator.destroyCapabilitySubscription(this._activeSubscriptions[targetCapabilityKey]);
  //       delete this._activeSubscriptions[targetCapabilityKey];
  //     }

  //     this.log(`[COMPILER LEAF] Compiling pipeline: [${reflected_device_id}].${reflected_capability_id} ──► this.${updateFunctionName}()`);

  //     // 2. Provision and store the subscription token keyed by its capability name
  //     const subscriptionHandle = await this.driver.coordinator.setCapabilitySubscription(
  //       reflected_device_id,
  //       reflected_capability_id,
  //       (val, time) => {
  //         this[updateFunctionName](val, time, targetCapabilityKey);
  //       }
  //     );

  //     if (subscriptionHandle) {
  //       this._activeSubscriptions[targetCapabilityKey] = subscriptionHandle;
  //       this.log(`[COMPILER LEAF] Active pipeline hook successfully assigned for ${targetCapabilityKey}.`);
  //     }

  //   } catch (err) {
  //     this.error(`[COMPILER LEAF] Execution mapping failed for ${targetCapabilityKey}: ${err.message}`);
  //   }
  // }

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
    this.log(`abstractIntegrator.integrateTimedCapability: device: ${this.getName()} targetCapabilityName: ${targetCapabilityName}`);
    this.log(`abstractIntegrator.integrateTimedCapability: newValue: ${newValue} thisTime: ${thisTime}`);
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

}