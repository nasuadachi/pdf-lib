function startFpsTracker(id) {
  const element = document.getElementById(id);

  const moveTo = (xCoord) =>
    (element.style.transform = `translateX(${xCoord}px)`);

  let xCoord = 0;
  const delta = 7;

  const slideRight = (timestamp) => {
    moveTo(xCoord);
    xCoord += delta;

    if (xCoord > 100) {
      requestAnimationFrame(slideLeft);
    } else {
      requestAnimationFrame(slideRight);
    }
  };

  const slideLeft = (timestamp) => {
    moveTo(xCoord);
    xCoord -= delta;

    if (xCoord < -100) {
      requestAnimationFrame(slideRight);
    } else {
      requestAnimationFrame(slideLeft);
    }
  };

  requestAnimationFrame(slideRight);
}

const pdfIframeObjectUrls = new Map();

function getIframe(iframeOrId) {
  const iframe =
    typeof iframeOrId === 'string'
      ? document.getElementById(iframeOrId)
      : iframeOrId;

  if (!iframe) throw new Error(`No iframe found for ${iframeOrId}`);
  return iframe;
}

function revokeObjectUrlAfterDetach(url) {
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cleanupPdfIframe(iframeOrId) {
  const iframe = getIframe(iframeOrId);
  const objectUrl = pdfIframeObjectUrls.get(iframe);

  if (!objectUrl) return;

  iframe.src = 'about:blank';
  pdfIframeObjectUrls.delete(iframe);
  revokeObjectUrlAfterDetach(objectUrl);
}

function cleanupAllPdfIframes() {
  for (const iframe of Array.from(pdfIframeObjectUrls.keys())) {
    cleanupPdfIframe(iframe);
  }
}

function renderPdfBytesInIframe(iframeOrId, pdfBytes) {
  const iframe = getIframe(iframeOrId);

  cleanupPdfIframe(iframe);

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  pdfIframeObjectUrls.set(iframe, objectUrl);
  iframe.src = objectUrl;

  return objectUrl;
}

window.addEventListener('pagehide', cleanupAllPdfIframes);
