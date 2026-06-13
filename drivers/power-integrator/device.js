'use strict';

const Homey = require('homey');

class PowerIntegratorDevice extends Homey.Device {

  async onInit() {
    this.log(`Power Integrator Instance Initialized: ${this.getName()}`);

    // Auto-resume reflection subscriptions on boot if configured
    const settings = this.getSettings();
    if (settings.reflected_device_id && settings.reflected_capability_id) {
      this.log(`Resuming background reflection for target device: ${settings.reflected_device_id}`);
      await this.updateTargetSubscription(settings.reflected_device_id, settings.reflected_capability_id);
    }
  }

  /**
   * Live Reflection Synchronization Engine
   */
  async updateTargetSubscription(targetDeviceId, targetCapabilityId) {
    this.log(`Updating listeners for Target: ${targetDeviceId} -> Capability: ${targetCapabilityId}`);

    // Clean up any stale listeners first to prevent memory leak stacking
    if (this._currentCapabilityListener) {
      try {
        this._currentCapabilityListener.destroy();
        this.log('Stale capability listener torn down cleanly.');
      } catch (e) { }
      this._currentCapabilityListener = null;
    }

    if (!targetDeviceId || !targetCapabilityId) {
      this.log('Reflection metrics cleared or unconfigured. Idle monitoring state.');
      return;
    }

    try {
      // Look up target context using the core global tracking map
      const devices = this.homey.devices.getDevices();
      const targetDevice = Object.values(devices).find(d => d.id === targetDeviceId);

      if (!targetDevice) {
        this.error(`Subscription failed: Target device ${targetDeviceId} is no longer present in the ecosystem.`);
        return;
      }

      this.log(`Reflection Bridge Established -> Binding to live events on: ${targetDevice.name}`);

      // Register live background value mirror hook
      this._currentCapabilityListener = targetDevice.makeCapabilityInstance(targetCapabilityId, async (value) => {
        this.log(`[Reflection Capture] -> Intercepted Value: ${value} from ${targetDevice.name} [${targetCapabilityId}]`);

        // Custom transformation logic, calculations, or local execution goes directly here
        // Example: Update our own meter capabilities based on reflected inputs
        try {
          if (this.hasCapability('measure_power')) {
            await this.setCapabilityValue('measure_power', Number(value));
          }
        } catch (capErr) {
          this.error('Failed to update reflected metric state:', capErr);
        }
      });

    } catch (err) {
      this.error('Failed to bind dynamic reflection listener to target entity:', err);
    }
  }

  async onDeleted() {
    this.log(`Power Integrator Instance Deleted: ${this.getName()}`);
    if (this._currentCapabilityListener) {
      this._currentCapabilityListener.destroy();
    }
  }
}

module.exports = PowerIntegratorDevice;