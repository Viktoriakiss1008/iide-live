document.querySelector('#open-tracker').addEventListener('click', () => {
  const trackerUrl = new URL('tracker.html', window.location.href).href;
  if (globalThis.chrome?.tabs?.create) {
    chrome.tabs.create({ url: trackerUrl });
  } else {
    window.open(trackerUrl, '_blank', 'noopener');
  }
});
