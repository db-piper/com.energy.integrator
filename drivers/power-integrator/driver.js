'use strict';

const Homey = require('homey');

class PowerIntegratorDriver extends Homey.Driver {

  async onInit() {
    this.log('PowerIntegratorDriver initializing...');
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
   * Keeping the single-parameter signature from this morning's baseline
   */
  onRepair(session) {
    this.log('--- Repair Session Tunnel Opened ---');

    // THIS MORNING'S FALLBACK: Pulls index 0 to get an active device context
    const instances = this.getDevices();
    const sessionDevice = instances[0];

    if (!sessionDevice) {
      this.error('--- Repair Aborted: No active Power Integrator instances found on disk ---');
      throw new Error('Please pair a Power Integrator device before running repair.');
    }

    this.log(`Repair session baseline attached to instance: ${sessionDevice.getName()} [${sessionDevice.getData().id}]`);

    // Identity bridge for the iframe configuration frame
    session.setHandler('get_current_repair_device', async () => {
      return {
        id: sessionDevice.getData().id
      };
    });

    // System landscape registry extractor with alphabetization and capability titles
    session.setHandler('get_system_devices', async (data) => {
      this.log('[Driver:power-integrator] --- Frontend requested device registry. Processing system landscape... ---');

      // Native global accessor that was successfully working this morning
      const devices = this.homey.devices.getDevices();
      const payload = {};

      Object.values(devices)
        .filter(device => device.getDriver().id !== 'power-integrator') // Avoid mirror loop feedback
        .forEach(device => {
          const zone = device.getZone();
          payload[device.id] = {
            id: device.id,
            name: device.name,
            zoneName: zone ? zone.name : 'No Zone',
            capabilities: Object.keys(device.capabilities).map(capId => {
              const capObj = device.homey.managerDrivers.getCapability(capId);
              return {
                id: capId,
                title: (capObj && capObj.title) ? capObj.title : capId
              };
            })
          };
        });

      // Alphabetized sort by name property
      const sortedPayload = Object.fromEntries(
        Object.entries(payload).sort(([, a], [, b]) => a.name.localeCompare(b.name))
      );

      this.log(`[Driver:power-integrator] --- Returning ${Object.keys(sortedPayload).length} alphabetized devices ---`);
      return sortedPayload;
    });

    // Handle incoming settings updates targeted to the resolved context instance
    session.setHandler('save_reflection_settings', async (payload) => {
      this.log('--- Received payload to commit to settings: ---', payload);
      try {
        // Double-check target mapping
        const currentDevice = this.getDevices().find(d => d.getData().id === payload.target_integrator_id);

        if (!currentDevice) {
          throw new Error(`Could not find active device instance with matching ID: ${payload.target_integrator_id}`);
        }

        this.log(`--- Targeted device instance verified: ${currentDevice.getName()} ---`);

        // Write directly to configuration storage partition
        await currentDevice.setSettings({
          reflected_device_id: payload.reflected_device_id,
          reflected_capability_id: payload.reflected_capability_id
        });

        this.log(`--- Settings successfully committed to storage for: ${currentDevice.getName()} ---`);

        // Trigger live subscription engine
        if (typeof currentDevice.updateTargetSubscription === 'function') {
          this.log(`--- Invoking subscription sync on ${currentDevice.getName()} directly... ---`);
          await currentDevice.updateTargetSubscription(payload.reflected_device_id, payload.reflected_capability_id);
        }

        return true;
      } catch (err) {
        this.error('--- Failed to save reflection settings to device ---', err);
        throw new Error(err.message || err.toString());
      }
    });
  }
}

module.exports = PowerIntegratorDriver;