import { subscribeState } from "../shared/api.js";
import { LEDScene } from './led-scene.js?v=20261006-exhibition';
import {EndingPresentation} from '../ending/session.js';

const controls = document.querySelector("#display-controls");
const errorLabel = document.querySelector("#display-error");
const presentationButton = document.querySelector("#presentation-button");
function report(message) {
  errorLabel.textContent = message;
  errorLabel.hidden = controls.hidden || !message;
}
// The dedicated exhibition screen explicitly enables the lighting effect.
// Operators can still request a static presentation with ?motion=off.
const scene = new LEDScene(document.querySelector('#stage'), {onError: report, animateMetal:new URLSearchParams(location.search).get('motion')!=='off'});
const endingHost=document.createElement('div');document.body.append(endingHost);
const endingScene=new EndingPresentation(endingHost,{display:true,onError:report});
const subscription = subscribeState(state => {
  endingScene.update(state);
  if(state.ending){
    const frozen={...state,pages:[{id:state.ending.page_id,cells:state.ending.cells}],drawings:state.ending.drawings,current_page_id:state.ending.page_id};
    scene.render(frozen);
  }else scene.render(state);
  scene.animateMetal=!state.ending&&new URLSearchParams(location.search).get('motion')!=='off';
  scene.resumeShine();
}, status => {
  document.querySelector("#connection-status").textContent = status.message;
});
function setControls(visible) {
  controls.hidden = !visible;
  errorLabel.hidden = !visible || !errorLabel.textContent;
  document.body.classList.toggle("tools-open", visible);
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { setControls(true); report("Trình duyệt chưa cho phép toàn màn hình. Hãy dùng chức năng toàn màn hình trong menu trình duyệt."); }
}
function keydown(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === "f") { event.preventDefault(); void fullscreen(); }
  if (event.key.toLowerCase() === "d") setControls(controls.hidden);
  if (event.key === "Escape") setControls(false);
}
function fullscreenChange() {
  document.querySelector("#fullscreen-button").textContent = document.fullscreenElement ? "Thoát toàn màn hình" : "Toàn màn hình";
  const label = document.fullscreenElement ? "Thoát toàn màn hình" : "Toàn màn hình";
  presentationButton.setAttribute("aria-label", label);
  presentationButton.title = `${label} (F)`;
  document.querySelector("#presentation-hint").childNodes[0].textContent = `${label} `;
  if (document.fullscreenElement) { setControls(false); presentationButton.blur(); }
}
presentationButton.addEventListener("click", fullscreen);
document.querySelector("#reload-button").addEventListener("click", () => { report(""); void subscription.refresh(); });
document.querySelector("#fullscreen-button").addEventListener("click", fullscreen);
document.querySelector("#hide-controls").addEventListener("click", () => setControls(false));
document.addEventListener("keydown", keydown);
document.addEventListener("fullscreenchange", fullscreenChange);
setControls(new URLSearchParams(location.search).get("debug") === "1");
window.addEventListener("pagehide", () => {
  subscription.close(); scene.destroy();endingScene.destroy();
  document.removeEventListener("keydown", keydown);
  document.removeEventListener("fullscreenchange", fullscreenChange);
}, { once: true });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
