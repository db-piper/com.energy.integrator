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

};
