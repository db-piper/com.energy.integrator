'use strict';

const Homey = require('homey');

class EnergyIntegratorApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Energy Integrator App initializing...');
    this.scheduleGlobalMidnightReset();
  }

  /**
   * Single application-wide clock loop
   */
  scheduleGlobalMidnightReset() {
    const tz = this.homey.clock.getTimezone();
    const now = new Date();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(tomorrow);
    const localMidnightEpoch = Date.parse(`${tomorrowStr}T00:00:00.000`, { timeZone: tz });
    const msToMidnight = localMidnightEpoch - now.getTime();

    this.log(`[App] Global midnight reset orchestrated. Firing in ${Math.round(msToMidnight / 1000 / 60)} minutes.`);

    this.midnightTimeout = this.homey.setTimeout(async () => {
      await this.executeGlobalMidnightReset();
      this.scheduleGlobalMidnightReset(); // Loop recursively
    }, msToMidnight);
  }

  /**
   * Iterates through drivers and active devices to trigger the flush
   */
  async executeGlobalMidnightReset() {
    this.log('[App] Local midnight reached! Executing global device flush...');
    
    // 1. Get all drivers registered in your app
    const drivers = this.getDrivers();

    for (const driver of Object.values(drivers)) {
      // 2. Get all active, initialized devices for this driver
      const devices = driver.getDevices();
      
      const resetPromises = devices.map(device => {
        // 3. Duck-type check: Does the device implement our abstract reset method?
        if (typeof device.executeMidnightReset === 'function') {
          return device.executeMidnightReset().catch(err => {
            this.error(`[App] Error resetting device ${device.getName()}:`, err);
          });
        }
        return Promise.resolve();
      });

      await Promise.all(resetPromises);
    }
    
    this.log('[App] Global midnight reset cycle completed.');
  }

}

module.exports = EnergyIntegratorApp;