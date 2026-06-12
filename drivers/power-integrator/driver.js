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
  // async onPairListDevices() {
  //   return [
  //     {
  //       name: "Power Integrator",
  //       data: {
  //         id: Date.now().toString(36) // Unique ID for this instance
  //       }
  //     }
  //   ];
  // }

  async onPair(session) {
    let selectedDeviceId = null;

    // Hook 1: Fetch and return all system devices to the UI dropdown
    session.setHandler('get_system_devices', async (data) => {
      if (!this.homeyApi) throw new Error('API unavailable');
      const allDevices = await this.homeyApi.devices.getDevices();

      // Map to a clean payload for the HTML dropdown selection
      return Object.values(allDevices).map(d => ({ id: d.id, name: d.name }));
    });

    // Hook 2: Capture the user's device selection
    session.setHandler('save_selected_device', async (deviceId) => {
      selectedDeviceId = deviceId;
      return true;
    });

    // Hook 3: Provide filtered capabilities for the chosen device
    session.setHandler('get_target_capabilities', async (data) => {
      if (!this.homeyApi || !selectedDeviceId) throw new Error('No device selected');
      const device = await this.homeyApi.devices.getDevice({ id: selectedDeviceId });

      // FILTER WRINKLE: Only pass along capabilities we can actively measure
      return device.capabilities.filter(cap => cap.startsWith('measure_') || cap.startsWith('meter_'));
    });

    // Hook 4: Finalize and instantiate our tracking device
    session.setHandler('create_integrator_device', async (selectedCapability) => {
      if (!this.homeyApi || !selectedDeviceId) throw new Error('Incomplete configuration');
      const targetDevice = await this.homeyApi.devices.getDevice({ id: selectedDeviceId });

      // Return the final instanced definition payload to Homey core
      return {
        name: `${targetDevice.name} Integrator`,
        data: {
          id: `integrator-${selectedDeviceId}-${Date.now()}`
        },
        settings: {
          reflected_device_id: selectedDeviceId,
          reflected_capability_id: selectedCapability
        }
      };
    });
  }

};
