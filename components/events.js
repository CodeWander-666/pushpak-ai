// ====================================================
// events.js – High‑End Event Bus with Error Resilience
// ====================================================

/**
 * Central event bus for decoupled communication.
 * Emits events to registered listeners with error isolation.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map(); // event name -> Set of callbacks
    this.maxListeners = 100; // optional warning threshold
  }

  /**
   * Register a callback for an event.
   * @param {string} event - Event name
   * @param {Function} callback - Function to call when event is emitted
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (typeof callback !== 'function') {
      console.error(`EventBus.on: callback for event "${event}" is not a function`);
      return () => {};
    }
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const callbacks = this.listeners.get(event);
    callbacks.add(callback);

    // Warn if too many listeners (potential memory leak)
    if (callbacks.size > this.maxListeners) {
      console.warn(`EventBus: event "${event}" has ${callbacks.size} listeners (exceeds ${this.maxListeners})`);
    }

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Remove a specific callback for an event.
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   */
  off(event, callback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event with data.
   * @param {string} event - Event name
   * @param {any} data - Data to pass to listeners
   */
  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;

    // Iterate over a copy to avoid issues if a listener modifies the set
    const callbacksArray = Array.from(callbacks);
    for (const callback of callbacksArray) {
      try {
        callback(data);
      } catch (error) {
        console.error(`EventBus: error in listener for event "${event}":`, error);
        // Optionally emit an error event for centralized handling
        this.emit('event:error', { event, error, callback });
      }
    }
  }

  /**
   * Remove all listeners for a specific event (or all events).
   * @param {string?} event - If provided, remove only for this event.
   */
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event.
   * @param {string} event - Event name
   * @returns {number}
   */
  listenerCount(event) {
    return this.listeners.get(event)?.size || 0;
  }
}