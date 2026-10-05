import {LEDScene} from '../display/led-scene.js?v=20261006-exhibition';
import {EndingPresentation} from '../ending/session.js';

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
    this.endingHost=document.createElement('div');this.endingHost.className='control-ending-overlay';
    host.append(this.endingHost);
    this.ending=new EndingPresentation(this.endingHost,{onError:options.onError});
  }

  render(state) {
    const active=state.ending&&state.current_page_id===state.ending.page_id;
    this.ending.update(active?state:{...state,ending:null});
    this.led.render(active?{...state,pages:[{id:state.ending.page_id,cells:state.ending.cells}],drawings:state.ending.drawings}:state);
    this.led.animateMetal=!active;this.led.resumeShine();
  }
  selectCell(index) {
    this.led.nodes.forEach((entry, i) => {
      entry.node.classList.toggle('selected', i === index);
      entry.node.setAttribute('aria-pressed', String(i === index));
    });
  }
  capture(state) { return this.led.capture(state); }
  destroy() { this.led.destroy();this.ending.destroy(); }
}
