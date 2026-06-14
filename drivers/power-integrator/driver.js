'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {

    this.homeyApi = null;

    try {
      // Clean, native, package-free system API connection
      this.homeyApi = await HomeyAPI.createAppAPI({ homey: this.homey });
      this.log('Global Web API session secured natively by Driver.');
    } catch (err) {
      this.error('Driver failed to secure native API instance:', err);
    }

    this.log('MyDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [
      {
        name: "Power Integrator",
        data: {
          id: Date.now().toString(36) // Unique ID for this instance
        }
      }
    ];
  }

  /**
     * Main Repair Session Entry Point
     * Fully utilizing the official (session, sessionDevice) SDK signature
     */
  onRepair(session, sessionDevice) {
    this.log('--- Repair Session Tunnel Opened ---');
    this.log(`Repair session context resolved for: ${sessionDevice.getName()} [${sessionDevice.getData().id}]`);

    // 1. Expose the identity bridge with existing configuration attributes
    session.setHandler('get_current_repair_device', async () => {
      const currentSettings = sessionDevice.getSettings();
      return {
        id: sessionDevice.getData().id,
        reflected_device_id: currentSettings.reflected_device_id || null,
        reflected_capability_id: currentSettings.reflected_capability_id || null
      };
    });
    // 2. Real-time system landscape registry extractor
    session.setHandler('get_system_devices', async (data) => {
      this.log('[Driver:power-integrator] --- Frontend requested device registry. Processing system landscape... ---');

      try {
        if (!this.homeyApi) {
          throw new Error('Web API client instance was not ready on Driver context.');
        }

        // Fetch devices and zones concurrently on-demand
        const [devicesMap, zonesMap] = await Promise.all([
          this.homeyApi.devices.getDevices(),
          this.homeyApi.zones.getZones()
        ]);

        this.log(`setHandler:get_system_devices: devicesMap count: ${Object.values(devicesMap).length}`);
        this.log(`setHandler:get_system_devices: zonesMap count: ${Object.values(zonesMap).length}`);

        const payload = {};

        Object.values(devicesMap)
          .filter(device => device.driverId !== 'power-integrator') // Avoid loop feedback
          .forEach(device => {

            // Resolve zone name dynamically from zonesMap to bypass device.zoneName deprecations
            const zoneObj = zonesMap[device.zone];
            const cleanZoneName = zoneObj ? zoneObj.name : 'No Zone';

            // Extract capabilities natively using the Web API structure
            // In the Web API, device.capabilitiesObj contains the properties for each capability
            const targetCapabilities = device.capabilitiesObj || {};

            const capabilitiesArray = Object.keys(targetCapabilities).map(capId => {
              const capMetadata = targetCapabilities[capId];
              return {
                id: capId,
                // Fall back to the raw key ID (like measure_power.load) if title isn't populated
                title: (capMetadata && capMetadata.title) ? capMetadata.title : capId
              };
            });

            payload[device.id] = {
              id: device.id,
              name: device.name,
              zoneName: cleanZoneName,
              capabilities: capabilitiesArray
            };
          });

        // Simple alphabetized sort by name property
        const sortedPayload = Object.fromEntries(
          Object.entries(payload).sort(([, a], [, b]) => a.name.localeCompare(b.name))
        );

        this.log(`[Driver:power-integrator] --- Returning ${Object.keys(sortedPayload).length} alphabetized devices ---`);
        return sortedPayload;

      } catch (err) {
        this.error('--- System Device Fetch Failed inside Repair Handler ---', err);
        throw new Error(err.message || err.toString());
      }
    });

    // 3. Handle incoming settings payloads targeted dynamically to the active instance
    session.setHandler('save_reflection_settings', async (payload) => {
      this.log('--- Received payload to commit to settings: ---', payload);
      try {
        // Commit changes straight to the active device instance context passed by the SDK
        await sessionDevice.setSettings({
          reflected_device_id: payload.reflected_device_id,
          reflected_capability_id: payload.reflected_capability_id
        });

        this.log(`--- Settings successfully committed to storage for: ${sessionDevice.getName()} ---`);

        // Trigger dynamic listener sync if it exists on your device codebase
        if (typeof sessionDevice.updateTargetSubscription === 'function') {
          this.log(`--- Invoking subscription sync on ${sessionDevice.getName()} directly... ---`);
          const targetId = payload.reflected_device_id || null;
          const targetCapability = payload.reflected_capability_id || null;
          await sessionDevice.updateTargetSubscription(targetId, targetCapability);
        } else {
          this.error('--- Failure: updateTargetSubscription method was not found on device context! ---');
        }

        return true;
      } catch (err) {
        this.error('--- Failed to save reflection settings to device ---', err);
        throw new Error(err.message || err.toString());
      }
    });
  }
};
