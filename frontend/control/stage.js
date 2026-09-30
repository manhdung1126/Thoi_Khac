import {LEDScene} from '../display/led-scene.js';

// Control always previews the finalized 27-cell LED scene.
export class Stage {
  constructor(host, options) {
    this.ledHost = document.createElement('div');
    this.ledHost.className = 'control-led-preview';
    host.append(this.ledHost);
    this.led = new LEDScene(this.ledHost, {
      grid: true,
      onError: options.onError,
      onSelect: (id, index) => {
        this.selectCell(index);
        options.onCell?.(index);
      },
    });
  }

  render(state) { this.led.render(state); }
  selectCell(index) {
    this.led.nodes.forEach((entry, i) => {
      entry.node.classList.toggle('selected', i === index);
      entry.node.setAttribute('aria-pressed', String(i === index));
    });
  }
  capture(state) { return this.led.capture(state); }
  destroy() { this.led.destroy(); }
}
