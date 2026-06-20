'use strict';

const Homey = require('homey');

class EnergyIntegratorApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Energy Integrator App initializing...');
  }

}

module.exports = EnergyIntegratorApp;