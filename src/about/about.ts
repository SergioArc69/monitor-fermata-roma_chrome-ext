const versionEl = document.getElementById("version") as HTMLParagraphElement;
const manifest = chrome.runtime.getManifest();
versionEl.textContent = `Versione ${manifest.version}`;
