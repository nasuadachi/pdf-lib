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

  iframe.src = 'about:blank';

  if (!objectUrl) return;

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

function isLikelyIPadOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isLikelySafari() {
  return (
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
  );
}

function shouldAvoidInlinePdfIframePreview() {
  return isLikelyIPadOS() && isLikelySafari();
}

function createPdfObjectUrl(iframeOrId, pdfBytes) {
  const iframe = getIframe(iframeOrId);

  cleanupPdfIframe(iframe);

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const objectUrl = URL.createObjectURL(blob);
  pdfIframeObjectUrls.set(iframe, objectUrl);

  return objectUrl;
}

function renderPdfBytesWithInlinePreviewMitigation(
  iframeOrId,
  pdfBytes,
  options = {},
) {
  const iframe = getIframe(iframeOrId);
  const objectUrl = createPdfObjectUrl(iframe, pdfBytes);
  const avoidInlinePreview =
    options.avoidInlinePdfIframePreview ?? shouldAvoidInlinePdfIframePreview();

  if (avoidInlinePreview) {
    iframe.src = 'about:blank';
    iframe.hidden = true;
    return {
      mode: 'object-url-only',
      objectUrl,
      renderedInline: false,
      reason:
        options.reason || 'iPadOS Safari inline PDF iframe preview is disabled',
    };
  }

  iframe.hidden = false;
  iframe.src = objectUrl;
  return {
    mode: 'iframe',
    objectUrl,
    renderedInline: true,
    reason: 'inline PDF iframe preview is enabled',
  };
}

window.addEventListener('pagehide', cleanupAllPdfIframes);
