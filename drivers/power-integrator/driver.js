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
   * @param {PairSocket} session - The active UI frame tunnel
   * @param {Homey.Device} device - The explicit device instance being repaired
   */
  /**
     * Main Repair Session Entry Point
     */
  onRepair(session, currentRepairDevice) {
    this.log('--- Repair Session Tunnel Opened ---');

    // 1. Guard Clause: Ensure the platform cleanly injected the parameter
    if (!currentRepairDevice) {
      this.error('--- CRITICAL SDK FAILURE: onRepair executed without providing the device parameter! ---');
      throw new Error('Repair failed: Device reference was not supplied by the platform.');
    }

    const targetId = currentRepairDevice.getData().id;
    this.log(`Repair session context verified via parameter for: ${currentRepairDevice.getName()} [${targetId}]`);

    // 2. Expose the identity bridge so the iframe can request its own tracking context
    session.setHandler('get_current_repair_device', async () => {
      return {
        id: targetId
      };
    });

    // 3. System landscape registry extractor (Using your working native getDevices() call)
    session.setHandler('get_system_devices', async (data) => {
      this.log('[Driver:power-integrator] --- Frontend requested device registry. Processing system landscape... ---');

      // Uses your exact working method
      const devices = this.homey.devices.getDevices();
      const payload = {};

      Object.values(devices)
        .filter(d => d.getDriver().id !== 'power-integrator') // Renamed to 'd' to stop shadowing conflict
        .forEach(d => {
          const zone = d.getZone();
          payload[d.id] = {
            id: d.id,
            name: d.name,
            zoneName: zone ? zone.name : 'No Zone',
            capabilities: Object.keys(d.capabilities).map(capId => {
              const capObj = d.homey.managerDrivers.getCapability(capId);
              return {
                id: capId,
                title: (capObj && capObj.title) ? capObj.title : capId
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
    });

    // 4. Handle incoming settings payloads targeted dynamically to the active instance
    session.setHandler('save_reflection_settings', async (payload) => {
      this.log('--- Received payload to commit to settings: ---', payload);
      try {
        const instances = this.getDevices();

        // Match the specific configuration context using the incoming target token
        const currentDevice = instances.find(inst => inst.getData().id === payload.target_integrator_id);

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
