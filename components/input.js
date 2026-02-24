// ====================================================
// input.js – Professional Input Handler
// ====================================================

import { EventBus } from './events.js';

export class InputHandler {
  constructor({ canvas, eventBus = null }) {
    if (!canvas || !(canvas instanceof HTMLElement)) {
      throw new Error('InputHandler requires a valid canvas element');
    }
    this.canvas = canvas;
    this.eventBus = eventBus || new EventBus();

    // Key states (code -> boolean)
    this.keys = new Map();
    // Mouse state
    this.mouseButtons = [false, false, false]; // left, middle, right
    this.mousePosition = { x: 0, y: 0 }; // normalized device coordinates (-1..1)
    this.mouseDelta = { x: 0, y: 0 };
    this._lastMouseEvent = null;

    // Action mapping (defaults)
    this.actionMap = {
      moveForward: 'KeyW',
      moveBackward: 'KeyS',
      moveLeft: 'KeyA',
      moveRight: 'KeyD',
      run: 'ShiftLeft',
      jump: 'Space',
      interact: 'KeyE',
      pause: 'Escape',
    };

    // Menu active flag: when true, gameplay input is suppressed
    this.menuActive = false;

    // Pointer lock state
    this.pointerLocked = false;

    // Bind methods to preserve `this` in event listeners
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    this._initListeners();
  }

  _initListeners() {
    try {
      // Keyboard (global)
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);

      // Mouse (canvas only)
      this.canvas.addEventListener('mousedown', this._onMouseDown);
      this.canvas.addEventListener('mouseup', this._onMouseUp);
      this.canvas.addEventListener('mousemove', this._onMouseMove);
      this.canvas.addEventListener('contextmenu', this._onContextMenu);

      // Pointer lock change (global)
      document.addEventListener('pointerlockchange', this._onPointerLockChange);
      document.addEventListener('mozpointerlockchange', this._onPointerLockChange);
      document.addEventListener('webkitpointerlockchange', this._onPointerLockChange);
    } catch (error) {
      console.error('InputHandler: failed to add event listeners', error);
    }
  }

  _onKeyDown(e) {
    try {
      // Prevent default for game actions (optional, but can be configured)
      // e.preventDefault(); // uncomment if needed

      this.keys.set(e.code, true);
      this.eventBus.emit('input:keydown', { code: e.code, key: e.key, repeat: e.repeat });

      // Special case for Escape (pause)
      if (e.code === 'Escape') {
        this.eventBus.emit('input:togglePause');
      }
    } catch (error) {
      console.error('InputHandler: error in keydown handler', error);
    }
  }

  _onKeyUp(e) {
    try {
      this.keys.set(e.code, false);
      this.eventBus.emit('input:keyup', { code: e.code, key: e.key });
    } catch (error) {
      console.error('InputHandler: error in keyup handler', error);
    }
  }

  _onMouseDown(e) {
    try {
      if (e.button >= 0 && e.button < this.mouseButtons.length) {
        this.mouseButtons[e.button] = true;
        this.eventBus.emit('input:mousedown', {
          button: e.button,
          x: this.mousePosition.x,
          y: this.mousePosition.y,
          originalEvent: e,
        });
      }
    } catch (error) {
      console.error('InputHandler: error in mousedown handler', error);
    }
  }

  _onMouseUp(e) {
    try {
      if (e.button >= 0 && e.button < this.mouseButtons.length) {
        this.mouseButtons[e.button] = false;
        this.eventBus.emit('input:mouseup', { button: e.button });
      }
    } catch (error) {
      console.error('InputHandler: error in mouseup handler', error);
    }
  }

  _onMouseMove(e) {
    try {
      // Normalized device coordinates
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mousePosition.x = Math.max(-1, Math.min(1, x));
      this.mousePosition.y = Math.max(-1, Math.min(1, y));

      // Mouse delta (for look)
      if (document.pointerLockElement === this.canvas) {
        // Pointer lock gives raw movement
        this.mouseDelta.x = e.movementX;
        this.mouseDelta.y = e.movementY;
      } else {
        // Fallback: compute delta from last event
        if (this._lastMouseEvent) {
          this.mouseDelta.x = e.clientX - this._lastMouseEvent.clientX;
          this.mouseDelta.y = e.clientY - this._lastMouseEvent.clientY;
        } else {
          this.mouseDelta.x = 0;
          this.mouseDelta.y = 0;
        }
      }
      this._lastMouseEvent = e;

      this.eventBus.emit('input:mousemove', {
        x: this.mousePosition.x,
        y: this.mousePosition.y,
        deltaX: this.mouseDelta.x,
        deltaY: this.mouseDelta.y,
      });
    } catch (error) {
      console.error('InputHandler: error in mousemove handler', error);
    }
  }

  _onContextMenu(e) {
    // Prevent right‑click context menu
    e.preventDefault();
  }

  _onPointerLockChange() {
    try {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.eventBus.emit('input:pointerLockChange', { locked: this.pointerLocked });
    } catch (error) {
      console.error('InputHandler: error in pointerlockchange handler', error);
    }
  }

  /**
   * Check if a gameplay action is currently pressed.
   * Respects the menuActive flag.
   * @param {string} action - Action name (e.g., 'moveForward')
   * @returns {boolean}
   */
  isPressed(action) {
    if (this.menuActive) return false;
    const keyCode = this.actionMap[action];
    if (!keyCode) {
      if (this._warnedMissingActions?.has(action) !== true) {
        console.warn(`InputHandler: action "${action}" not defined in actionMap`);
        (this._warnedMissingActions ||= new Set()).add(action);
      }
      return false;
    }
    return this.keys.get(keyCode) || false;
  }

  /**
   * Get current mouse position (normalized device coordinates).
   * @returns {{x: number, y: number}}
   */
  getMouse() {
    return { x: this.mousePosition.x, y: this.mousePosition.y };
  }

  /**
   * Get mouse delta since last frame.
   * @returns {{x: number, y: number}}
   */
  getMouseDelta() {
    return { x: this.mouseDelta.x, y: this.mouseDelta.y };
  }

  /**
   * Update the action‑to‑key mapping.
   * @param {Object} newMap - Partial mapping to merge.
   */
  setActionMap(newMap) {
    Object.assign(this.actionMap, newMap);
  }

  /**
   * Set the menu active state (suppresses gameplay input).
   * @param {boolean} active
   */
  setMenuActive(active) {
    this.menuActive = active;
    this.eventBus.emit('input:menuActiveChanged', { active });
  }

  /**
   * Request pointer lock on the canvas.
   */
  requestPointerLock() {
    try {
      this.canvas.requestPointerLock();
    } catch (error) {
      console.error('InputHandler: failed to request pointer lock', error);
    }
  }

  /**
   * Exit pointer lock.
   */
  exitPointerLock() {
    try {
      document.exitPointerLock();
    } catch (error) {
      console.error('InputHandler: failed to exit pointer lock', error);
    }
  }

  /**
   * Clean up event listeners (call when disposing).
   */
  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('mozpointerlockchange', this._onPointerLockChange);
    document.removeEventListener('webkitpointerlockchange', this._onPointerLockChange);
  }
}