'use strict';

const Homey = require('homey');

class EnergyIntegratorApp extends Homey.App {

  async onInit() {
    this.log('Energy Integrator App initializing...');
  }

  /**
   * Checks if the interval between two epoch millisecond timestamps includes midnight,
   * dynamically respecting the Homey user's local timezone and DST settings.
   * @param   {number} epochMillis1 -   First timestamp
   * @param   {number} epochMillis2 -   Second timestamp
   * @param   {string} homeyTimeZone -  Timezone string set in Homey
   * @returns {boolean}                 True if the interval crosses local midnight
   */
  includesMidnight(epochMillis1, epochMillis2, homeyTimeZone) {

    const d1 = new Date(epochMillis1);
    const d2 = new Date(epochMillis2);

    // 2. Format the dates utilizing Homey's local timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: homeyTimeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });

    const dateStr1 = formatter.format(d1);
    const dateStr2 = formatter.format(d2);

    // 3. If the calendar dates match, midnight was not crossed.
    return dateStr1 !== dateStr2;
  }

}

module.exports = EnergyIntegratorApp;