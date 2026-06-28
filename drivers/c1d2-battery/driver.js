'use strict';

const Homey = require('homey');

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.coordinator = this.homey.app.coordinator;
    this.log('MyDriver has been initialized');
  }

  /**
   * Return the single instance of homeyAPI
   * @returns {Object}        homeyApi instance
   */
  async homeyApi() {
    return this.coordinator.homeyApi();
  }


  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    // Define your target device identity properties
    const targetId = "c12c808a-5e4c-4878-8272-5f253d70a903";

    const mockMultiChannelConfig = {
      "measure_power": {
        "reflected_device_id": targetId,
        "reflected_capability_id": "measure_power",
        "invert_power_sign": false
      },
      "measure_percent.battery": {
        "reflected_device_id": targetId,
        "reflected_capability_id": "measure_percent.soc"
      }
    };

    return [
      {
        name: "C1D2 Battery TEST",
        data: { id: Date.now().toString(36) },
        settings: {
          // Force fully formed multi-channel mapping on boot
          reflection_configuration_json: JSON.stringify(mockMultiChannelConfig)
        }
      }
    ];
  }

  async onUninit() {
    this.log(`powerIntegrator.onUninit: closing the homey API instance`)
    this.coordinator = null;
  }

};
