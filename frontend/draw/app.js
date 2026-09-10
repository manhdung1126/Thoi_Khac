const colorButtons = document.querySelectorAll(".color-button");
const selectedColorName = document.querySelector("#selected-color-name");
const canvas = document.querySelector("#drawing-canvas");
const context = canvas.getContext("2d");

let selectedColor = "#ffc76a";
let isDrawing = false;

context.lineWidth = 6;
context.lineCap = "butt";
context.lineJoin = "miter";

function selectColor(event) {
  const clickedButton = event.currentTarget;

  selectedColor = clickedButton.dataset.color;
  selectedColorName.textContent = clickedButton.dataset.colorName;

  colorButtons.forEach((button) => {
    const isSelected = button === clickedButton;

    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  console.log("Màu hiện tại:", selectedColor);
}

colorButtons.forEach((button) => {
  button.addEventListener("click", selectColor);
});

function getCanvasPoint(event) {
  const rectangle = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rectangle.width;
  const scaleY = canvas.height / rectangle.height;

  return {
    x: (event.clientX - rectangle.left) * scaleX,
    y: (event.clientY - rectangle.top) * scaleY,
  };
}

function startDrawing(event) {
  isDrawing = true;

  const point = getCanvasPoint(event);

  context.beginPath();
  context.moveTo(point.x, point.y);
  context.strokeStyle = selectedColor;

  canvas.setPointerCapture(event.pointerId);
}

function draw(event) {
  if (!isDrawing) {
    return;
  }

  const point = getCanvasPoint(event);

  context.lineTo(point.x, point.y);
  context.stroke();
}

function stopDrawing(event) {
  if (!isDrawing) {
    return;
  }

  isDrawing = false;
  context.closePath();

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", draw);
canvas.addEventListener("pointerup", stopDrawing);
canvas.addEventListener("pointercancel", stopDrawing);
