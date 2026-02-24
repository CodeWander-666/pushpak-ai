// ====================================================
// ui.js – Ultimate User Interface Subsystem
// ====================================================

// ---------- Imports from other modules ----------
import { PhysicsConfig } from './physics.js';
import { PlayerConfig } from './player.js';
import { AudioConfig } from './audio.js';
import { PostConfig } from './postprocessing.js';
import { AIConfig } from './ai.js';

// ---------- GameContext (set by main.js) ----------
export let GameContext = null;
export function setGameContext(ctx) { GameContext = ctx; }

// ---------- UI Configuration ----------
export const UIConfig = {
  ENABLED: true,
  THEME: 'dark',                // 'dark', 'light', or custom class
  LANGUAGE: 'en',
  SCALE: 1.0,
  DEBUG: true,
  SHOW_FPS: true,
  SHOW_MEMORY: false,
  CROSSHAIR: {
    enabled: true,
    type: 'dot',                // 'dot', 'cross', 'circle'
    color: '#ffffff',
    size: 16,
  },
  NOTIFICATION_DURATION: 3000,  // ms
  NOTIFICATION_MAX_QUEUE: 5,
  MENU_ANIMATION_DURATION: 200, // ms
};

// ---------- Simple Event Bus wrapper (for UI internal use) ----------
const UIEventBus = {
  on: (event, callback) => GameContext?.eventBus?.on(event, callback),
  off: (event, callback) => GameContext?.eventBus?.off(event, callback),
  emit: (event, data) => GameContext?.eventBus?.emit(event, data),
};

// ---------- Base class for UI elements ----------
class UIElement {
  constructor(id, options = {}) {
    this.id = id;
    this.container = null;
    this.visible = true;
    this.options = options;
  }

  create() {
    // Override
  }

  update(data) {
    // Override
  }

  show() {
    if (this.container) this.container.style.display = '';
    this.visible = true;
  }

  hide() {
    if (this.container) this.container.style.display = 'none';
    this.visible = false;
  }

  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

// ---------- Health Bar ----------
class HealthBar extends UIElement {
  constructor() {
    super('healthBar');
  }

  create() {
    this.container = document.createElement('div');
    this.container.id = 'health-bar';
    this.container.style.cssText = `
      position: absolute;
      bottom: 30px;
      left: 30px;
      width: 200px;
      height: 20px;
      background: rgba(0,0,0,0.5);
      border: 2px solid #888;
      border-radius: 10px;
      overflow: hidden;
      backdrop-filter: blur(4px);
    `;
    this.fill = document.createElement('div');
    this.fill.style.cssText = `
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #f00, #f66);
      transition: width 0.1s;
    `;
    this.container.appendChild(this.fill);
    document.body.appendChild(this.container);
    this.listen();
  }

  listen() {
    UIEventBus.on('player:health', (data) => this.update(data));
  }

  update(data) {
    const percent = (data.health / PlayerConfig.MAX_HEALTH) * 100;
    this.fill.style.width = percent + '%';
  }
}

// ---------- Stamina Bar ----------
class StaminaBar extends UIElement {
  constructor() {
    super('staminaBar');
  }

  create() {
    this.container = document.createElement('div');
    this.container.id = 'stamina-bar';
    this.container.style.cssText = `
      position: absolute;
      bottom: 60px;
      left: 30px;
      width: 200px;
      height: 10px;
      background: rgba(0,0,0,0.5);
      border: 2px solid #888;
      border-radius: 5px;
      overflow: hidden;
      backdrop-filter: blur(4px);
    `;
    this.fill = document.createElement('div');
    this.fill.style.cssText = `
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0f0, #6f6);
      transition: width 0.1s;
    `;
    this.container.appendChild(this.fill);
    document.body.appendChild(this.container);
    this.listen();
  }

  listen() {
    UIEventBus.on('player:stamina', (data) => this.update(data));
  }

  update(data) {
    const percent = (data.stamina / PlayerConfig.MAX_STAMINA) * 100;
    this.fill.style.width = percent + '%';
  }
}

// ---------- Crosshair ----------
class Crosshair extends UIElement {
  constructor() {
    super('crosshair');
  }

  create() {
    if (!UIConfig.CROSSHAIR.enabled) return;
    this.container = document.createElement('div');
    this.container.id = 'crosshair';
    this.container.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: ${UIConfig.CROSSHAIR.size}px;
      height: ${UIConfig.CROSSHAIR.size}px;
      pointer-events: none;
      z-index: 1000;
    `;
    // Draw based on type
    if (UIConfig.CROSSHAIR.type === 'dot') {
      this.container.style.borderRadius = '50%';
      this.container.style.backgroundColor = UIConfig.CROSSHAIR.color;
    } else if (UIConfig.CROSSHAIR.type === 'cross') {
      const line1 = document.createElement('div');
      const line2 = document.createElement('div');
      line1.style.cssText = line2.style.cssText = `
        position: absolute;
        background: ${UIConfig.CROSSHAIR.color};
      `;
      line1.style.width = '100%';
      line1.style.height = '2px';
      line1.style.top = '50%';
      line1.style.transform = 'translateY(-50%)';
      line2.style.width = '2px';
      line2.style.height = '100%';
      line2.style.left = '50%';
      line2.style.transform = 'translateX(-50%)';
      this.container.appendChild(line1);
      this.container.appendChild(line2);
    }
    document.body.appendChild(this.container);
    this.listen();
  }

  listen() {
    UIEventBus.on('player:aiming', (data) => {
      if (data.hit) {
        this.container.style.borderColor = '#f00';
        this.container.style.backgroundColor = '#f00';
      } else {
        this.container.style.borderColor = UIConfig.CROSSHAIR.color;
        this.container.style.backgroundColor = UIConfig.CROSSHAIR.color;
      }
    });
  }
}

// ---------- Notification Manager ----------
class NotificationManager {
  constructor() {
    this.queue = [];
    this.container = null;
  }

  create() {
    this.container = document.createElement('div');
    this.container.id = 'notification-container';
    this.container.style.cssText = `
      position: absolute;
      top: 60px;
      right: 30px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 2000;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
    this.listen();
  }

  listen() {
    UIEventBus.on('notification:show', (data) => this.enqueue(data));
  }

  enqueue(data) {
    if (this.queue.length >= UIConfig.NOTIFICATION_MAX_QUEUE) {
      const oldest = this.queue.shift();
      oldest.remove();
    }
    const notif = this.createNotification(data);
    this.queue.push(notif);
    this.container.appendChild(notif.element);
    setTimeout(() => {
      notif.element.style.opacity = '0';
      setTimeout(() => {
        const index = this.queue.indexOf(notif);
        if (index !== -1) this.queue.splice(index, 1);
        notif.element.remove();
      }, 300);
    }, data.duration || UIConfig.NOTIFICATION_DURATION);
  }

  createNotification(data) {
    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(20,20,30,0.8);
      backdrop-filter: blur(8px);
      border-left: 4px solid ${data.color || '#88ccff'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      transition: opacity 0.3s;
      opacity: 1;
    `;
    el.textContent = data.message;
    return { element: el, remove: () => el.remove() };
  }
}

// ---------- Debug Overlay (FPS, stats) ----------
class DebugOverlay extends UIElement {
  constructor() {
    super('debugOverlay');
    this.stats = null;
    this.fps = 0;
    this.lastTime = performance.now();
    this.frames = 0;
  }

  create() {
    if (!UIConfig.DEBUG) return;
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.7);
      color: #0f0;
      font-family: monospace;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 5px;
      z-index: 3000;
      pointer-events: none;
    `;
    document.body.appendChild(this.container);
    // Start FPS counter
    this.updateLoop();
    this.listen();
  }

  updateLoop() {
    requestAnimationFrame(() => {
      const now = performance.now();
      this.frames++;
      if (now >= this.lastTime + 1000) {
        this.fps = this.frames;
        this.frames = 0;
        this.lastTime = now;
        this.updateDisplay();
      }
      this.updateLoop();
    });
  }

  listen() {
    UIEventBus.on('physics:stats', (data) => this.updatePhysicsStats(data));
    UIEventBus.on('audio:stats', (data) => this.updateAudioStats(data));
  }

  updatePhysicsStats(data) {
    this.physicsStats = data;
    this.updateDisplay();
  }

  updateAudioStats(data) {
    this.audioStats = data;
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.container) return;
    let html = `FPS: ${this.fps}<br>`;
    if (UIConfig.SHOW_MEMORY && window.performance?.memory) {
      const mem = (window.performance.memory.usedJSHeapSize / (1024*1024)).toFixed(1);
      html += `Memory: ${mem} MB<br>`;
    }
    if (this.physicsStats) {
      html += `Physics bodies: ${this.physicsStats.bodyCount}<br>`;
    }
    if (this.audioStats) {
      html += `Audio sources: ${this.audioStats.activeCount}<br>`;
    }
    this.container.innerHTML = html;
  }
}

// ---------- Performance Monitor (Stats.js integration) ----------
class PerformanceMonitor {
  constructor() {
    this.stats = null;
  }

  create() {
    if (typeof Stats === 'undefined') return;
    this.stats = new Stats();
    this.stats.dom.style.position = 'absolute';
    this.stats.dom.style.top = '20px';
    this.stats.dom.style.right = '20px';
    document.body.appendChild(this.stats.dom);
  }

  update() {
    if (this.stats) this.stats.update();
  }
}

// ---------- Main UIManager ----------
export class UIManager {
  constructor() {
    this.elements = new Map();
    this.notificationManager = new NotificationManager();
    this.performanceMonitor = new PerformanceMonitor();
    this.activeMenu = null;
    this.menus = new Map();
    this.theme = UIConfig.THEME;
    this.lang = UIConfig.LANGUAGE;
    this.init();
  }

  init() {
    if (!UIConfig.ENABLED) return;
    this.setupTheme();
    this.setupLocalization();
    this.createBaseElements();
    this.setupEventListeners();
    if (UIConfig.DEBUG) {
      this.performanceMonitor.create();
    }
  }

  setupTheme() {
    document.body.className = `theme-${this.theme}`;
  }

  setupLocalization() {
    // Load language file (simplified)
    fetch(`locales/${this.lang}.json`)
      .then(res => res.json())
      .catch(() => ({}))
      .then(strings => {
        this.strings = strings;
        document.querySelectorAll('[data-i18n]').forEach(el => {
          const key = el.getAttribute('data-i18n');
          if (this.strings[key]) el.textContent = this.strings[key];
        });
      });
  }

  createBaseElements() {
    // HUD elements
    this.addElement('healthBar', new HealthBar());
    this.addElement('staminaBar', new StaminaBar());
    this.addElement('crosshair', new Crosshair());
    if (UIConfig.DEBUG) {
      this.addElement('debugOverlay', new DebugOverlay());
    }
    // Notification container (managed separately)
    this.notificationManager.create();

    // Create all elements
    this.elements.forEach((el) => el.create());
  }

  addElement(name, instance) {
    this.elements.set(name, instance);
  }

  setupEventListeners() {
    // Player events
    UIEventBus.on('player:damage', (data) => {
      this.showNotification({ message: `-${data.amount}`, color: '#ff4444' });
    });
    UIEventBus.on('player:death', () => {
      this.showNotification({ message: 'You died', color: '#ff0000', duration: 5000 });
    });
    UIEventBus.on('player:jump', () => {
      // could show a tiny "jump" notification or just ignore
    });

    // Menu toggle (example: Escape)
    GameContext?.eventBus?.on('input:keydown', (e) => {
      if (e.code === 'Escape') {
        this.toggleMenu('pause');
      }
    });

    // Window resize
    window.addEventListener('resize', this.onResize.bind(this));
  }

  showNotification(data) {
    this.notificationManager.enqueue(data);
  }

  toggleMenu(menuName) {
    if (this.activeMenu) {
      this.activeMenu.hide();
      this.activeMenu = null;
      if (GameContext?.input) GameContext.input.menuActive = false;
    } else {
      if (!this.menus.has(menuName)) {
        this.createMenu(menuName);
      }
      this.activeMenu = this.menus.get(menuName);
      this.activeMenu.show();
      if (GameContext?.input) GameContext.input.menuActive = true;
    }
  }

  createMenu(menuName) {
    // Simplified menu creation – in a real app, you'd have a Menu class
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.style.cssText = `
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8);
      backdrop-filter: blur(10px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity ${UIConfig.MENU_ANIMATION_DURATION}ms;
    `;
    const content = document.createElement('div');
    content.style.cssText = `
      background: rgba(30,30,40,0.9);
      padding: 40px;
      border-radius: 20px;
      color: white;
      font-family: 'Inter', sans-serif;
      min-width: 300px;
    `;
    content.innerHTML = `<h2 data-i18n="menu_${menuName}">${menuName}</h2>`;
    // Add buttons for settings, resume, quit etc.
    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = 'Resume';
    resumeBtn.onclick = () => this.toggleMenu(menuName);
    content.appendChild(resumeBtn);
    menu.appendChild(content);
    document.body.appendChild(menu);
    // Store menu object with show/hide methods
    this.menus.set(menuName, {
      element: menu,
      show: () => {
        menu.style.display = 'flex';
        setTimeout(() => menu.style.opacity = '1', 10);
      },
      hide: () => {
        menu.style.opacity = '0';
        setTimeout(() => menu.style.display = 'none', UIConfig.MENU_ANIMATION_DURATION);
      },
    });
  }

  onResize() {
    // Scale UI elements if needed
    const scale = Math.min(window.innerWidth / 1920, 1.0) * UIConfig.SCALE;
    document.documentElement.style.fontSize = (16 * scale) + 'px';
  }

  update(deltaTime) {
    if (this.performanceMonitor) this.performanceMonitor.update();
    // Update any per‑frame UI elements (e.g., crosshair animation)
  }

  setTheme(theme) {
    this.theme = theme;
    document.body.className = `theme-${theme}`;
  }

  setLanguage(lang) {
    this.lang = lang;
    this.setupLocalization();
  }

  dispose() {
    this.elements.forEach(el => el.destroy());
    this.notificationManager.container?.remove();
    this.performanceMonitor.stats?.dom.remove();
    this.menus.forEach(menu => menu.element.remove());
    window.removeEventListener('resize', this.onResize);
  }
}

// ---------- Default Export ----------
export default {
  setGameContext,
  UIManager,
  UIConfig,
};