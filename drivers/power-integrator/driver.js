'use strict';

const Homey = require('homey');
const DiscoveryCoordinator = require('../../modules/discoveryCoordinator');

module.exports = class powerIntegrator extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.coordinator = new DiscoveryCoordinator(this.homey, 'com.energy.integrator');
    this.log('[powerIntegrator:onInit] Driver has been initialized');
  }

  /**
   * Return the single instance of homeyAPI
   * @returns {Object}        homeyApi instance
   */
  async homeyApi() {
    return this.coordinator.homeyApi();
  }

  /**
   * Handle front-end events from the pairing session
   * @param   {homey.session}   session     pairing session object
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

  }

  /**
   * Handle front-end events from the repairing session
   * @param     {Homey.session}    session        repairing session object
   * @param     {Homey.Device}     sessionDevice  device being repaired
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

  async onUninit() {
    this.log(`powerIntegrator.onUninit: closing the homey API instance`)
    if (this.coordinator && typeof this.coordinator.terminateApi === 'function') {
      await this.coordinator.terminateApi();
    }
    this.coordinator = null;
  }
};
