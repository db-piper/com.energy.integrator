'use strict';

//TODO: Re-write all hard-coded references to measure_power

const Homey = require('homey');
const DiscoveryCoordinator = require('./modules/discoveryCoordinator');

class EnergyIntegratorApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Energy Integrator App initializing...');
    this.scheduleGlobalMidnightReset();
    this.coordinator = new DiscoveryCoordinator(this.homey, this.id);
  }

  /**
   * onUninit is called when the app is terminated.
   */
  async onUninit() {
    if (this.midnightTimeout) {
      this.log(`app.onUninit: Clearing midnight reset timer.`);
      clearTimeout(this.midnightTimeout);
      this.midnightTimeout = null;
      this.log('[App] Midnight reset schedule cancelled cleanly.');
    }

    if (this.coordinator && typeof this.coordinator.terminateApi === 'function') {
      await this.coordinator.terminateApi();
    }

    this.coordinator = null;
  }

  /**
   * Single application-wide clock loop - Zero-Drift Mathematical Targeter
   */
  scheduleGlobalMidnightReset() {
    const msToMidnight = this.getMsToMidnight();
    this.log(`[App.scheduleGlobalMidnightReset] Firing in ${Math.round(msToMidnight / 1000 / 60)} minutes.`);

    this.midnightTimeout = this.homey.setTimeout(async () => {
      try {
        await this.executeGlobalMidnightReset();
      } catch (err) {
        this.error(`[Error] Midnight reset execution failed:`, err);
      }
      this.scheduleGlobalMidnightReset(); // Loop recursively for the next day
    }, msToMidnight);
  }

  /**
   * Calculate the milliseconds from "now" until next midnight
   */
  getMsToMidnight() {
    const tz = this.homey.clock.getTimezone(); // e.g., "Europe/London"
    const now = new Date();

    const dateOpts = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' };
    const todayStr = new Intl.DateTimeFormat('en-CA', dateOpts).format(now);                      // YYYY-MM-DD
    const [year, month, day] = todayStr.split('-').map(Number);
    const [tomorrowStr] = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().split('T');  // YYYY-MM-DD
    const tomorrowOffset = this.getZoneOffsetAtDate(tomorrowStr, tz);                             // Hours
    const utcTomorrowMidnight = Date.parse(`${tomorrowStr}T00:00:00.000Z`);                       // Epoch Millis
    const trueTomorrowMidnightEpoch = utcTomorrowMidnight - (tomorrowOffset * 3600000);           // TZ adjusted Millis
    return trueTomorrowMidnightEpoch - now.getTime();                                             // Millis interval now until midnight
  }

  /**
   * Return the hours offset from UTC of a timezone at midnight on the specified date
   * @param   {string}        targetDateString        Date in YYYY-MM-DD form 
   * @param   {string}        timeZone                IANA timezone code (e.g. EUROPE/London)      
   * @returns {number}                                Hours offset from UTC (UTC+1 or +01:00 gives 1)
   */
  getZoneOffsetAtDate(targetDateString, timeZone) {
    const utcDate = Date.parse(`${targetDateString}T00:00:00.000Z`);
    const tzDate = Date.parse(new Date(utcDate).toLocaleString('en-CA', { timeZone, hour12: false }));

    return (tzDate - utcDate) / 3600000; 
  }

  /**
   * Iterates through drivers and active devices to set daily values to zero at midnight
   */
  async executeGlobalMidnightReset() {
    this.log('[App] Local midnight reached! Executing global device flush...');

    // 1. Get all drivers registered in your app
    const drivers = this.homey.drivers.getDrivers();
    this.log(`app.executeGlobalMidnightReset: drivers found: ${Object.keys(drivers).join(', ')}`);
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