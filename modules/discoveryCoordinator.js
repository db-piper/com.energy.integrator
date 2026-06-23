'use strict';
const { HomeyAPI } = require('homey-api');


/**
 * Handles stateless system registry extraction and identity normalization
 * across any driver pair/repair session.
 */
class DiscoveryCoordinator {
  /**
   * @param {Object} homey - The native Homey runtime instance (this.homey)
   * @param {string} appId - The current application ID
   */
  constructor(homey, appId = 'com.energy.integrator') {
    this.homey = homey;
    this.appId = appId;
    this._homeyApi = null;

    // Push the asynchronous setup down into an isolated, managed pipeline
    this._initializePromise = this._initApi();
  }

  /**
   * Internal async initializer to secure the Web API session securely
   */
  async _initApi() {
    try {
      this._homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });
      this.homey.app.log('[DiscoveryCoordinator] Global Web API session secured natively.');
    } catch (err) {
      this.homey.app.error('[DiscoveryCoordinator] Failed to secure native API instance:', err);
      throw err;
    }
  }

  /**
   * Return a fully initialized homey API
   * @returns {Object}          Fully initialized homey API
   */
  async homeyApi() {
    await this._initializePromise;
    return this._homeyApi;
  }


  /**
   * Normalizes the identity profile response.
   * Works for Repair (maps existing device) and Pair (falls back to clean null settings safely).
   * @param {Object|null} sessionDevice - The Homey Device instance (null if pairing)
   */
  getCurrentDevice(sessionDevice) {
    if (!sessionDevice) {
      return {
        id: null,
        reflected_device_id: null,
        reflected_capability_id: null
      };
    }

    const currentSettings = sessionDevice.getSettings();
    let configObject = {};

    try {
      configObject = JSON.parse(currentSettings.reflection_configuration_json || '{}');
    } catch (e) {
      configObject = {};
    }

    // Extract the flat fallbacks out of our target key context for the picker view
    const measurePowerMapping = configObject["measure_power"] || {};

    return {
      id: sessionDevice.getData().id,
      reflected_device_id: measurePowerMapping.reflected_device_id || null,
      reflected_capability_id: measurePowerMapping.reflected_capability_id || null
    };
  }

  /**
   * Universal landscape extractor with capability filtering
   * @param {Object} query - Incoming arguments from frontend
   */
  async getSystemDevices(query) {
    await this._initializePromise;

    const isStrict = query && query.strict;
    const currentDevId = query && query.currentDeviceId;
    const currentCapId = query && query.currentCapabilityId;

    if (!this._homeyApi) {
      throw new Error('Web API client instance was not available on DiscoveryCoordinator.');
    }

    // Fetch live infrastructure topology maps concurrently
    const [devicesMap, zonesMap] = await Promise.all([
      this._homeyApi.devices.getDevices(),
      this._homeyApi.zones.getZones()
    ]);

    const payload = {};

    Object.values(devicesMap)
      // Exclude devices created by this app's drivers to avoid circular reference loops
      .filter(device => device.ownerUri !== `homey:app:${this.appId}`)
      .forEach(device => {
        const zoneObj = zonesMap[device.zone];
        const cleanZoneName = zoneObj ? zoneObj.name : 'No Zone';
        const targetCapabilities = device.capabilitiesObj || {};

        const capabilitiesArray = Object.keys(targetCapabilities)
          .filter(capId => {
            // Safeguard evaluation matrix for null or blank pairing bounds
            const isCurrent = currentDevId && currentCapId &&
              device.id === currentDevId && capId === currentCapId;

            let include = false;
            if (isStrict) {
              include = capId === 'measure_power' || capId.startsWith('measure_power.');
            } else {
              include = capId.startsWith('measure');
            }

            return isCurrent || include;
          })
          .map(capId => {
            const capMetadata = targetCapabilities[capId];
            return {
              id: capId,
              title: (capMetadata && capMetadata.title) ? capMetadata.title : capId
            };
          });

        if (capabilitiesArray.length > 0) {
          payload[device.id] = {
            id: device.id,
            name: device.name,
            zoneName: cleanZoneName,
            capabilities: capabilitiesArray
          };
        }
      });

    // Alphabetize output payload by device name
    return Object.fromEntries(
      Object.entries(payload).sort(([, a], [, b]) => a.name.localeCompare(b.name))
    );
  }

  /**
   * Commits selected device and capability to the active device instance settings
   * and forces a subscription synchronization loop.
   * @param {Object} sessionDevice - Active Homey Device context instance
   * @param {Object} payload - Settings payload sent from the frontend
   */
  async saveReflectionSettings(sessionDevice, payload) {
    if (!sessionDevice) {
      throw new Error('Cannot commit reflection settings: Missing active device context.');
    }

    try {
      const currentSettings = sessionDevice.getSettings();
      let configObject = {};

      try {
        configObject = JSON.parse(currentSettings.reflection_configuration_json || '{}');
      } catch (e) {
        configObject = {};
      }

      // Dynamically target the key we are working with
      configObject["measure_power"] = {
        reflected_device_id: payload.reflected_device_id,
        reflected_capability_id: payload.reflected_capability_id
      };

      await sessionDevice.setSettings({
        reflection_configuration_json: JSON.stringify(configObject)
      });

      this.log(`[DiscoveryCoordinator] Committed JSON configuration map for measure_power.`);
      return true;
    } catch (err) {
      throw new Error(err.message || err.toString());
    }
  }

  /**
   * Generates a live capability subscription stream, forwarding events to the device callback
   * @param {string}                    targetId           The target device UUID to observe
   * @param {string}                    targetCapability   The capability ID (e.g., measure_power)
   * @param {Function}                  onSignalCallback   Bound arrow function to trigger on updates
   * @returns {Promise<Object|null>}                       The official capability wrapper instance for local tracking
   */
  async setCapabilitySubscription(targetId, targetCapability, onSignalCallback) {
    await this._initializePromise;

    if (!targetId || !targetCapability) {
      this.homey.app.log('[DiscoveryCoordinator] Subscription bypassed: Missing configuration bounds.');
      return null;
    }

    try {
      this.homey.app.log(`[DiscoveryCoordinator] Initiating target stream hook for: ${targetId}`);

      // Fetch specific device topology mapping
      const targetDevice = await this._homeyApi.devices.getDevice({ id: targetId });

      const capabilityInstance = targetDevice.makeCapabilityInstance(
        targetCapability,
        (newValue, rawInstance) => {
          const eventTime = Date.parse(rawInstance.lastChanged);
          onSignalCallback(newValue, eventTime);
        }
      );

      await targetDevice.connect();
      return capabilityInstance;

    } catch (err) {
      this.homey.app.error(`[DiscoveryCoordinator] Failed to set target subscription:`, err);
      throw err;
    }
  }

  /**
   * Safely tears down an active capability instance stream to prevent memory leaks
   * @param {Object|null} capabilityInstance - The live wrapper instance to destroy
   */
  destroyCapabilitySubscription(capabilityInstance) {
    if (!capabilityInstance) return;

    try {
      this.homey.app.log('[DiscoveryCoordinator] Explicitly destroying active capability stream wrapper...');
      capabilityInstance.destroy();
    } catch (err) {
      this.homey.app.error('[DiscoveryCoordinator] Error during capability stream destruction:', err);
    }
  }

}

module.exports = DiscoveryCoordinator;