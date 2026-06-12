'use strict';

const Homey = require('homey');

class PowerIntegratorDevice extends Homey.Device {

  async onInit() {
    this.log(`Device [${this.getName()}] initializing...`);

    this.homeyApi = null;
    this.targetDeviceInstance = null;
    this.lastTimestampMs = this.getCapabilityValue('measure_time') || null;

    // Initialize the Web API wrapper
    await this.initLocalWebApi();

    // Start listening to our configured target
    await this.updateTargetSubscription();
  }

  /**
   * Secure a local Web API session for this specific device instance
   */
  async initLocalWebApi() {
    this.homeyApi = this.driver.homeyApi;

    if (!this.homeyApi) {
      this.error('Failed to inject API: Parent driver session is not ready!');
      return;
    }

    this.log('Web API successfully injected from parent Driver.');
  }

  /**
   * Tears down any old listener and binds cleanly to the currently configured target settings
   */
  async updateTargetSubscription() {
    // 1. Clean up existing listener if the user changed settings or device is reloading
    if (this.capabilityInstance) {
      this.log('Destroying official capability instance wrapper...');
      try {
        this.capabilityInstance.destroy();
      } catch (err) {
        this.error('Error destroying capability instance:', err);
      }
      this.capabilityInstance = null;
    }

    if (this.targetDeviceInstance) {
      this.targetDeviceInstance = null;
    }
    if (!this.homeyApi) return;

    const settings = this.getSettings();
    const targetId = settings.reflected_device_id;
    const targetCapability = settings.reflected_capability_id;

    // If settings are blank (e.g., right after pairing), pause until configured
    if (!targetId || !targetCapability) {
      this.log('No reflection target configured yet. Standing by...');
      return;
    }

    try {
      this.log(`Attempting connection to targeted source device: ${targetId}`);

      // 2. Fetch ONLY the specific device we care about from the system
      this.targetDeviceInstance = await this.homeyApi.devices.getDevice({ id: targetId });

      // 3. Attach a listener to the capability instance
      this.capabilityInstance = this.targetDeviceInstance.makeCapabilityInstance(targetCapability, (newValue, capabilityInstance) => {
        const eventTime = Date.parse(capabilityInstance.lastChanged);
        this.handleReflectedSignal(newValue, eventTime);
      });

      // 4. Open the socket channel for this single piece of hardware exclusively
      await this.targetDeviceInstance.connect();
      this.log(`Successfully subscribed to ${targetId} for capability: ${targetCapability}`);

    } catch (err) {
      this.error(`Failed to bind reflection target subscription:`, err);
    }
  }

  /**
   * Triggers automatically whenever the targeted capability pushes an update
   */
  handleReflectedSignal(newValue, thisTime) {

    const homeyInstance = this.homey;
    this.log(`PowerIntegratorDevice.handleReflectedSignal: newValue: ${newValue} thisTime: ${thisTime}`)
    const lastTime = this.getCapabilityValue('measure_time');
    const lastPower = this.getCapabilityValue('measure_power') || 0;
    const firstTime = lastTime === null;
    //const thisTime = Date.now();

    const updates = [
      this.setCapabilityValue('measure_time', thisTime),
      this.setCapabilityValue('measure_power', newValue),
    ];

    if (!firstTime) {
      const lastEnergyTotal = this.getCapabilityValue('meter_power') || 0;
      const lastEnergyToday = this.getCapabilityValue('meter_power.today') || 0;
      const deltaTime = thisTime - lastTime;
      const deltaEnergy = (lastPower / 1000) * (deltaTime / 3600000);
      const isNewDay = homeyInstance.app.includesMidnight(lastTime, thisTime, homeyInstance.clock.getTimezone());
      updates.push(
        this.setCapabilityValue('meter_power', deltaEnergy + lastEnergyTotal),
        this.setCapabilityValue('meter_power.today', deltaEnergy + (isNewDay ? 0 : lastEnergyToday)),
        this.setCapabilityValue('measure_interval', deltaTime / 1000)
      )
    }

    Promise.all(updates)
      .catch(err => this.error('PowerIntegratorDevice.handleReflectedSignal: Error committing capability updates:', err));

    return true;
  }

  /**
   * Automatically intercept whenever a user modifies the Advanced Settings panel
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings modification detected. Re-evaluating reflection pipeline...');

    // Directly intercept whenever either manual box OR picker dropdown modifies the targets
    if (changedKeys.includes('reflected_device_id') || changedKeys.includes('reflected_capability_id')) {
      this.log('[Device] Core target configurations updated. Re-binding hooks...');

      // Execute instantly. updateTargetSubscription() will read the fresh runtime state safely
      await this.updateTargetSubscription();
    }

    return true;
  }
  // async onSettings({ oldSettings, newSettings, changedKeys }) {
  //   this.log('Settings modification detected. Re-evaluating reflection pipeline...');

  //   // We defer execution slightly to allow Homey to commit the new variables to storage
  //   this.homey.setTimeout(async () => {
  //     await this.updateTargetSubscription();
  //   }, 1000);

  //   return true; // Accept the settings save action cleanly
  // }

  /**
   * Clean up connections if the device gets deleted by the user
   */
  async onDeleted() {
    // Explicitly destroy the capability instance connection wrapper if it exists
    if (this.capabilityInstance) {
      try {
        this.capabilityInstance.destroy();
      } catch (e) {
        this.error('Error destroying capability wrapper on delete:', e);
      }
    }
    this.log('Device destroyed. Connection closed cleanly.');
  }
  // async onDeleted() {
  //   if (this.targetDeviceInstance) {
  //     this.targetDeviceInstance.removeAllListeners('capability');
  //   }
  //   this.log('Device destroyed. Connection closed cleanly.');
  // }
}

module.exports = PowerIntegratorDevice;