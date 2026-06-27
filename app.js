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
    const tz = this.homey.clock.getTimezone(); // e.g., "Europe/London"
    const now = new Date();

    // 1. Get tomorrow's calendar date string using en-CA
    const dateOpts = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' };
    const todayStr = new Intl.DateTimeFormat('en-CA', dateOpts).format(now);
    const [year, month, day] = todayStr.split('-').map(Number);
    const tomorrowStr = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().split('T')[0]; // "2026-06-28"

    // 2. Base Anchor: Midnight UTC on that calendar day
    const utcMidnightEpoch = Date.parse(`${tomorrowStr}T00:00:00.000Z`);

    // 3. Look at what a clock in London reads AT that exact UTC moment
    const timeOpts = { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const targetTimeStr = new Intl.DateTimeFormat('en-CA', timeOpts).format(new Date(utcMidnightEpoch)); // e.g. "01:00:00"

    // 4. Calculate the exact timezone offset in effect AT that future midnight
    const [tHours, tMinutes, tSeconds] = targetTimeStr.split(':').map(Number);
    const offsetMsAtMidnight = (tHours * 3600000) + (tMinutes * 60000) + (tSeconds * 1000);

    // 5. Deduct that future offset from the UTC anchor to get the true physical epoch of local midnight
    const trueMidnightEpoch = utcMidnightEpoch - offsetMsAtMidnight;

    // 6. Absolute physical milliseconds until that exact moment
    const msToMidnight = trueMidnightEpoch - now.getTime();

    // Debugging logs
    const currentTimeStr = new Intl.DateTimeFormat('en-CA', timeOpts).format(now);
    this.log(`[App] Clock Status -> Local Time: ${todayStr} ${currentTimeStr} | Target Reset Date: ${tomorrowStr}`);
    this.log(`[App] Global midnight reset orchestrated. Firing in ${Math.round(msToMidnight / 1000 / 60)} minutes.`);

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
   * Iterates through drivers and active devices to trigger the flush
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