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
   */
  onRepair(session, sessionDevice) {
    this.log('--- Repair Session Tunnel Opened ---');

    // 1. Capture the exact device instance associated with this specific user session click
    // const sessionDevice = session.getDevice();
    this.log(`Repair session context resolved for: ${sessionDevice.getName()} [${sessionDevice.getData().id}]`);

    // 2. Expose the identity bridge so the iframe can request its own tracking context
    session.setHandler('get_current_repair_device', async () => {
      return {
        id: sessionDevice.getData().id
      };
    });

    // 3. Keep your existing system landscape registry extractor
    session.setHandler('get_system_devices', async (data) => {
      this.log('[Driver:power-integrator] --- Frontend requested device registry. Processing system landscape... ---');

      try {
        if (!this.homeyApi) {
          throw new Error('Web API client instance was not ready on Driver context.');
        }

        // 1. Correctly await the Web API map fetch
        const devicesMap = await this.homeyApi.devices.getDevices();
        this.log(`setHandler:get_system_devices: devicesMap count: ${Object.values(devicesMap).length}`);
        const payload = {};

        Object.values(devicesMap)
          .filter(device => device.driverId !== 'power-integrator') // Web API uses driverId string natively
          .forEach(device => {
            // 2. Web API objects include zoneName directly as a flat string property!
            const zoneName = device.zoneName || 'No Zone';

            payload[device.id] = {
              id: device.id,
              name: device.name,
              zoneName: zoneName,
              // 3. Web API pre-populates titles directly on the capability sub-objects
              capabilities: Object.keys(device.capabilities || {}).map(capId => {
                return {
                  id: capId,
                  title: device.capabilities[capId].title || capId
                };
              })
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
    // 4. Handle incoming settings payloads targeted dynamically to the active instance
    session.setHandler('save_reflection_settings', async (payload) => {
      this.log('--- Received payload to commit to settings: ---', payload);
      try {
        const instances = this.getDevices();

        // Match the specific configuration context using the incoming target token
        const currentDevice = instances.find(d => d.getData().id === payload.target_integrator_id);

        if (!currentDevice) {
          throw new Error(`Could not find active device instance with matching ID: ${payload.target_integrator_id}`);
        }

        this.log(`--- Targeted device instance verified: ${currentDevice.getName()} ---`);

        // Force variables to storage partition
        await currentDevice.setSettings({
          reflected_device_id: payload.reflected_device_id,
          reflected_capability_id: payload.reflected_capability_id
        });

        this.log(`--- Settings successfully committed to storage for: ${currentDevice.getName()} ---`);

        // Awaken the dedicated socket listener directly on this exact instance
        if (typeof currentDevice.updateTargetSubscription === 'function') {
          this.log(`--- Invoking subscription sync on ${currentDevice.getName()} directly... ---`);
          const targetId = payload.reflected_device_id || null;
          const targetCapability = payload.reflected_capability_id || null;
          await currentDevice.updateTargetSubscription(targetId, targetCapability);
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
