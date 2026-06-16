'use strict';

const Homey = require('homey');
//const { HomeyAPI } = require('homey-api');
const DiscoveryCoordinator = require('../../modules/discoveryCoordinator');

module.exports = class powerIntegrator extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.coordinator = new DiscoveryCoordinator(this.homey, 'com.energy.integrator');
    this.log('[powerIntegrator:onInit] Driver has been initialized');
  }

  async homeyApi() {
    return this.coordinator.homeyApi();
  }

  /**
   * Streamlined Pair Session Entry Point
   * Uses frontend instantiation, eliminating the need for list_devices tracking
   */
  onPair(session) {
    this.log('--- Pair Session Active ---');

    session.setHandler('get_current_device', async () => {
      // Pass null to safely drop to empty provisioning schemas
      return this.coordinator.getCurrentDevice(null);
    });

    session.setHandler('get_system_devices', async (query) => {
      return this.coordinator.getSystemDevices(query);
    });

    // Device creation is completed by the frontend using Homey API method createDevice

  }

  /**
     * Main Repair Session Entry Point
     * Fully utilizing the official (session, sessionDevice) SDK signature
   */
  onRepair(session, sessionDevice) {
    this.log(`--- Repair Session Active: ${sessionDevice.getName()} ---`);

    session.setHandler('get_current_device', async () => {
      return this.coordinator.getCurrentDevice(sessionDevice);
    });

    session.setHandler('get_system_devices', async (query) => {
      return this.coordinator.getSystemDevices(query);
    });

    session.setHandler('save_reflection_settings', async (payload) => {
      return this.coordinator.saveReflectionSettings(sessionDevice, payload);
    });
  }
};
